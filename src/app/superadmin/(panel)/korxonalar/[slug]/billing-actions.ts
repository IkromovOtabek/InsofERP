"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/control";
import { requireAdmin, roleDenied } from "@/lib/control/auth";
import { control } from "@/lib/control/db";
import { logEvent } from "@/lib/control/events";
import { cancelPayment, dbDay, PAYMENT_METHODS, recordPayment, resumeIfBilling, syncTenantPlatform, todayIso } from "@/lib/control/billing";
import { parseForm, validDate, zDec, zOpt, type ActionState } from "@/lib/action";
import { PLATFORM_MODULES } from "@/lib/platform-modules";

/**
 * Korxona obunasi (faqat «Egasi»): to'lov qo'shish, oxirgi to'lovni storno, oylik narx / imtiyoz / muddatni sozlash.
 * Mantiq — lib/control/billing.ts; bu yerda: rol, forma tekshiruvi, jurnal.
 */

async function ownerTenant(slug: string) {
  const a = await requireAdmin();
  const deny = roleDenied(a, "OWNER");
  if (deny) return { error: deny } as const;
  const t = await control.tenant.findUnique({ where: { slug } });
  if (!t) return { error: "Korxona topilmadi" } as const;
  return { a, t } as const;
}

const day = z.string().trim().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && validDate(v), "Sana noto'g'ri");

const PAYMENT = z.object({
  amount: zDec(1),
  months: z.coerce.number().int().min(1, "Kamida 1 oy").max(24, "Ko'pi bilan 24 oy"),
  paidAt: day.refine((v) => v <= todayIso(), "To'lov sanasi kelajakda bo'lmaydi"),
  method: z.string().refine((v) => v in PAYMENT_METHODS, "To'lov usulini tanlang"),
  note: zOpt,
});

export async function addPaymentAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await ownerTenant(slug);
  if ("error" in r) return { error: r.error };
  const f = parseForm(PAYMENT, fd);
  if ("error" in f) return f;
  if (r.t.status === "ARCHIVED") return { error: "Arxivdagi korxonaga to'lov yozilmaydi" };
  const res = await recordPayment(r.t.id, f.data, r.a.id);
  await logEvent(r.a.id, "TENANT_PAYMENT", r.t.id, {
    paymentId: res.payment.id, amount: f.data.amount, months: f.data.months, method: f.data.method, paidAt: f.data.paidAt,
    from: res.payment.periodFrom.toISOString().slice(0, 10), to: res.payment.periodTo.toISOString().slice(0, 10), prevPaidUntil: res.prev, resumed: res.resumed,
  });
  revalidatePath(`/superadmin/korxonalar/${slug}`); revalidatePath("/superadmin");
  return { ok: true, note: `To'lov yozildi: ${res.payment.periodTo.toISOString().slice(0, 10)} gacha${res.resumed ? " · korxona qayta yoqildi" : ""}` };
}

const ID = z.string().regex(/^[a-z0-9]{10,40}$/i);

export async function cancelPaymentAction(slug: string, paymentId: string, reason: string): Promise<{ error?: string }> {
  const r = await ownerTenant(slug);
  if ("error" in r) return { error: r.error };
  if (!ID.safeParse(paymentId).success) return { error: "To'lov topilmadi" };
  const why = String(reason ?? "").trim();
  if (why.length < 3 || why.length > 500) return { error: "Storno sababini yozing (3–500 belgi)" };
  const p = await control.tenantPayment.findUnique({ where: { id: paymentId }, select: { tenantId: true, amount: true, months: true } });
  if (!p || p.tenantId !== r.t.id) return { error: "To'lov topilmadi" };
  const res = await cancelPayment(paymentId, why, r.a.id);
  if (res.error) return { error: res.error };
  await logEvent(r.a.id, "TENANT_PAYMENT_CANCEL", r.t.id, {
    paymentId, amount: p.amount.toString(), months: p.months, reason: why, paidUntil: res.tenant?.paidUntil?.toISOString().slice(0, 10) ?? null,
  });
  revalidatePath(`/superadmin/korxonalar/${slug}`); revalidatePath("/superadmin");
  return {};
}

const SETTINGS = z.object({
  monthlyFee: z.string().trim().transform((v) => (v ? Number(v.replace(/\s/g, "")) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1e13), "Oylik to'lov noto'g'ri"),
  graceDays: z.coerce.number().int().min(0, "0–60 kun").max(60, "0–60 kun"),
  paidUntil: z.string().trim().transform((v) => v || null).refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && validDate(v)), "Sana noto'g'ri"),
});

/** Narx, imtiyoz va muddatni qo'lda o'rnatish (boshlang'ich holat, sinov davri, kelishuv). Muddat o'zgarishi jurnalda. */
export async function saveBillingSettingsAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await ownerTenant(slug);
  if ("error" in r) return { error: r.error };
  const f = parseForm(SETTINGS, fd);
  if ("error" in f) return f;
  const before = { monthlyFee: r.t.monthlyFee?.toString() ?? null, graceDays: r.t.graceDays, paidUntil: r.t.paidUntil?.toISOString().slice(0, 10) ?? null };
  const after = { monthlyFee: f.data.monthlyFee === null ? null : String(f.data.monthlyFee), graceDays: f.data.graceDays, paidUntil: f.data.paidUntil };
  if (JSON.stringify(before) === JSON.stringify(after)) return { ok: true, note: "O'zgarish yo'q" };
  const t = await control.tenant.update({
    where: { id: r.t.id },
    data: {
      monthlyFee: f.data.monthlyFee === null ? null : new Prisma.Decimal(f.data.monthlyFee), graceDays: f.data.graceDays,
      paidUntil: f.data.paidUntil ? dbDay(f.data.paidUntil) : null,
      ...(before.paidUntil !== after.paidUntil ? { billingNotice: null } : {}),
    },
  });
  await logEvent(r.a.id, "TENANT_BILLING", r.t.id, { before, after });
  // Muddat surilgan bo'lsa — billing sababli to'xtatilgani darhol yoqiladi, korxona banneri yangilanadi
  const resumed = await resumeIfBilling(t);
  await syncTenantPlatform(t).catch((e) => console.error("[billing] korxonaga yozilmadi:", (e as Error).message));
  revalidatePath(`/superadmin/korxonalar/${slug}`); revalidatePath("/superadmin");
  return { ok: true, note: resumed ? "Saqlandi · korxona qayta yoqildi" : "Saqlandi" };
}

/**
 * Tarif tarkibi: qaysi qo'shimcha modullar yoqiq va faol foydalanuvchilar chegarasi. Forma yoqiq modullarni yuboradi
 * (`on` — bir nechta), o'chiqlari saqlanadi. Korxona bazasiga darhol yoziladi — keyingi so'rovdanoq amal qiladi.
 */
export async function saveTariffAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await ownerTenant(slug);
  if ("error" in r) return { error: r.error };
  const on = new Set(fd.getAll("on").map(String));
  const modulesOff = PLATFORM_MODULES.filter((m) => !on.has(m));
  const raw = String(fd.get("userLimit") ?? "").trim();
  const userLimit = raw ? Number(raw) : null;
  if (userLimit !== null && (!Number.isInteger(userLimit) || userLimit < 1 || userLimit > 100_000)) return { error: "Foydalanuvchi chegarasi: 1 dan katta butun son yoki bo'sh" };
  const before = { modulesOff: [...r.t.modulesOff].sort(), userLimit: r.t.userLimit };
  const after = { modulesOff: [...modulesOff].sort(), userLimit };
  if (JSON.stringify(before) === JSON.stringify(after)) return { ok: true, note: "O'zgarish yo'q" };
  const t = await control.tenant.update({ where: { id: r.t.id }, data: { modulesOff, userLimit } });
  await logEvent(r.a.id, "TENANT_TARIFF", r.t.id, { before, after });
  try {
    await syncTenantPlatform(t);
  } catch (e) {
    revalidatePath(`/superadmin/korxonalar/${slug}`);
    return { error: `Panelda saqlandi, lekin korxona bazasiga yozilmadi (soatlik tekshiruv qayta urinadi): ${(e as Error).message.split("\n")[0].slice(0, 200)}` };
  }
  revalidatePath(`/superadmin/korxonalar/${slug}`);
  return { ok: true, note: "Saqlandi — korxonada darhol amal qiladi" };
}
