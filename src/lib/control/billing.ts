import { Prisma, type Tenant } from "@/generated/control";
import { isoDate } from "../format";
import { control, tenantDb } from "./db";
import { setSuspended } from "./provision";

/**
 * Korxona obunasi: to'langan muddat (Tenant.paidUntil), to'lovlar (TenantPayment), avtomatik ogohlantirish va to'xtatish.
 *
 * Bosqichlar (Toshkent sanasi bo'yicha, `paidUntil` kuni ham to'langan hisoblanadi):
 *   none    — muddat belgilanmagan (muddatsiz): avtomat hech narsa qilmaydi
 *   ok      — 3 kundan ko'p qoldi
 *   soon    — 0–3 kun qoldi: IT guruhiga Telegram, direktorga ERP'da banner
 *   grace   — muddat o'tgan, imtiyozli kunlar (graceDays) ichida: banner «… dan to'xtatiladi»
 *   overdue — imtiyoz ham tugagan: korxona avtomatik to'xtatiladi (suspendKind = "billing")
 * To'lov kiritilsa (yoki IT muddatni surib qo'ysa) — `billing` sababli to'xtatilgan korxona avtomatik yoqiladi.
 * Qo'lda to'xtatilganiga (suspendKind = "manual") avtomat tegmaydi.
 *
 * Sanalar `@db.Date` — UTC yarim tun sifatida saqlanadi; hisob faqat "YYYY-MM-DD" satrlarida (vaqt mintaqasi siljimasin).
 * Kunlik tekshiruv — insof-agent (`billingTick`, soatiga bir marta) yoki `npm run tenant -- billing`.
 */

export const SOON_DAYS = 3;
export const PAYMENT_METHODS: Record<string, string> = { otkazma: "Bank o'tkazmasi", naqd: "Naqd", karta: "Karta" };
export const PLAN_LABEL: Record<string, string> = { standard: "Standart", pro: "Pro", trial: "Sinov (trial)" };

/* ───────── Sana (faqat kun) ───────── */

export const todayIso = () => isoDate(new Date());
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const dbDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const addDays = (iso: string, n: number) => isoOf(new Date(dbDay(iso).getTime() + n * 86_400_000));
export const diffDays = (a: string, b: string) => Math.round((dbDay(a).getTime() - dbDay(b).getTime()) / 86_400_000);
/** Oy qo'shish: oy oxiri siqiladi (31-yanvar + 1 oy → 28/29-fevral). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoOf(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))));
}

/* ───────── Holat ───────── */

export type BillingStage = "none" | "ok" | "soon" | "grace" | "overdue";
export type BillingState = { stage: BillingStage; paidUntil: string | null; daysLeft: number | null; suspendOn: string | null };

export function billingState(t: Pick<Tenant, "paidUntil" | "graceDays">, today = todayIso()): BillingState {
  if (!t.paidUntil) return { stage: "none", paidUntil: null, daysLeft: null, suspendOn: null };
  const paidUntil = isoOf(t.paidUntil);
  const daysLeft = diffDays(paidUntil, today);
  const suspendOn = addDays(paidUntil, t.graceDays + 1);
  const stage: BillingStage = daysLeft > SOON_DAYS ? "ok" : daysLeft >= 0 ? "soon" : today < suspendOn ? "grace" : "overdue";
  return { stage, paidUntil, daysLeft, suspendOn };
}

export const STAGE_LABEL: Record<BillingStage, { label: string; color: "slate" | "green" | "amber" | "red" | "violet" }> = {
  none: { label: "Muddatsiz", color: "slate" },
  ok: { label: "To'langan", color: "green" },
  soon: { label: "Muddati yaqin", color: "amber" },
  grace: { label: "Imtiyozda", color: "red" },
  overdue: { label: "Muddati o'tgan", color: "red" },
};

/**
 * To'lov qaysi davrni qoplaydi. Uzluksizlik: muddat tugamagan yoki imtiyoz ichida bo'lsa — eski muddatdan keyingi kundan;
 * muddatsiz yoki imtiyoz ham o'tib ketgan bo'lsa — bugundan (to'xtab turgan kunlar uchun haq olinmaydi).
 */
export function paymentPeriod(t: Pick<Tenant, "paidUntil" | "graceDays">, months: number, today = todayIso()): { from: string; to: string } {
  const st = billingState(t, today);
  const from = st.paidUntil && st.stage !== "overdue" ? addDays(st.paidUntil, 1) : today;
  return { from, to: addDays(addMonths(from, months), -1) };
}

/* ───────── Korxona bazasiga yozish ───────── */

/**
 * Korxona ERP'si o'qiydigan platforma ma'lumoti — CompanySettings.platform (lib/tenant.ts):
 *   billing    — obuna muddati (direktor banneri); muddatsiz — null
 *   modulesOff — tarifda o'chirilgan modullar (lib/platform-modules.ts)
 *   userLimit  — faol foydalanuvchilar chegarasi; null — cheklovsiz
 * Panel boshqa kalitlarga tegmaydi. O'zgarish bo'lmasa yozilmaydi.
 */
export async function syncTenantPlatform(t: Pick<Tenant, "dbName" | "paidUntil" | "graceDays" | "modulesOff" | "userLimit">) {
  const st = billingState(t);
  const next = {
    billing: st.paidUntil ? { paidUntil: st.paidUntil, suspendOn: st.suspendOn } : null,
    modulesOff: [...t.modulesOff].sort(),
    userLimit: t.userLimit ?? null,
  };
  const db = tenantDb(t.dbName);
  const cur = await db.companySettings.findUnique({ where: { id: "main" }, select: { platform: true } });
  const base = cur?.platform && typeof cur.platform === "object" && !Array.isArray(cur.platform) ? (cur.platform as Record<string, unknown>) : {};
  const same = (Object.keys(next) as (keyof typeof next)[]).every((k) => JSON.stringify(base[k] ?? null) === JSON.stringify(next[k]));
  if (same) return;
  const platform = { ...base, ...next } as Prisma.InputJsonValue;
  await db.companySettings.upsert({ where: { id: "main" }, update: { platform }, create: { id: "main", platform } });
}

/* ───────── To'lov va storno ───────── */

export type PaymentInput = { amount: number; months: number; paidAt: string; method: string; note: string | null };

/**
 * To'lovni yozish va muddatni surish — bitta tranzaksiyada, korxona qatori qulflangan holda (ikki parallel to'lov
 * bir xil eski muddatdan hisoblanib qolmasin). `billing` sababli to'xtatilgan bo'lsa — yoqiladi.
 */
export async function recordPayment(tenantId: string, input: PaymentInput, adminId: string | null) {
  const res = await control.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const p = paymentPeriod(t, input.months);
    const payment = await tx.tenantPayment.create({
      data: {
        tenantId, amount: new Prisma.Decimal(input.amount), months: input.months, paidAt: dbDay(input.paidAt), method: input.method,
        note: input.note, periodFrom: dbDay(p.from), periodTo: dbDay(p.to), prevPaidUntil: t.paidUntil, createdById: adminId,
      },
    });
    const updated = await tx.tenant.update({ where: { id: tenantId }, data: { paidUntil: dbDay(p.to), billingNotice: null } });
    return { payment, tenant: updated, prev: t.paidUntil ? isoOf(t.paidUntil) : null };
  });
  const resumed = await resumeIfBilling(res.tenant);
  await syncTenantPlatform(res.tenant).catch((e) => console.error("[billing] korxonaga yozilmadi:", (e as Error).message));
  return { ...res, resumed };
}

/** Faqat OXIRGI faol to'lov storno qilinadi: muddat to'lovdan oldingi qiymatiga qaytadi. */
export async function cancelPayment(paymentId: string, reason: string, adminId: string | null): Promise<{ error?: string; tenant?: Tenant }> {
  const res = await control.$transaction(async (tx) => {
    const p = await tx.tenantPayment.findUnique({ where: { id: paymentId } });
    if (!p) return { error: "To'lov topilmadi" };
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${p.tenantId} FOR UPDATE`;
    if (p.cancelledAt) return { error: "To'lov allaqachon storno qilingan" };
    const last = await tx.tenantPayment.findFirst({ where: { tenantId: p.tenantId, cancelledAt: null }, orderBy: { createdAt: "desc" } });
    if (last?.id !== p.id) return { error: "Faqat oxirgi to'lovni storno qilish mumkin — avval undan keyingilarini" };
    await tx.tenantPayment.update({ where: { id: p.id }, data: { cancelledAt: new Date(), cancelledById: adminId, cancelReason: reason } });
    const tenant = await tx.tenant.update({ where: { id: p.tenantId }, data: { paidUntil: p.prevPaidUntil, billingNotice: null } });
    return { tenant };
  });
  if (res.tenant) await syncTenantPlatform(res.tenant).catch((e) => console.error("[billing] korxonaga yozilmadi:", (e as Error).message));
  return res;
}

/** `billing` sababli to'xtatilgan va endi muddati o'tmagan korxonani yoqish (shartli — qo'lda to'xtatilganiga tegmaydi). */
export async function resumeIfBilling(t: Tenant): Promise<boolean> {
  if (t.status !== "SUSPENDED" || t.suspendKind !== "billing" || billingState(t).stage === "overdue") return false;
  const r = await control.tenant.updateMany({
    where: { id: t.id, status: "SUSPENDED", suspendKind: "billing" },
    data: { status: "ACTIVE", suspendedAt: null, suspendReason: null, suspendKind: null },
  });
  if (r.count !== 1) return false;
  await setSuspended(t.dbName, false);
  await control.controlEvent.create({ data: { tenantId: t.id, action: "TENANT_RESUME", detail: { auto: true, reason: "to'lov kelib tushdi" } } });
  return true;
}

/* ───────── Kunlik tekshiruv ───────── */

export const BILLING_SUSPEND_REASON = "To'lov muddati o'tdi (avtomatik)";
/** IT muddati o'tgan korxonani qo'lda yoqsa — shu muddat uchun avtomat qayta to'xtatmaydi. */
export const resumedMark = (paidUntil: string) => `resumed:${paidUntil}`;

type TickOpts = { notify?: (text: string) => Promise<unknown>; log?: (msg: string) => void };

/**
 * Hamma korxona: ogohlantirish (bir bosqichda bir marta), muddati o'tganini to'xtatish, to'langanini yoqish,
 * korxona bazasiga holatni yozish. Idempotent — istalgancha qayta ishga tushirish xavfsiz.
 */
export async function billingTick(opts: TickOpts = {}): Promise<string> {
  const notify = opts.notify ?? (async () => {});
  const tenants = await control.tenant.findMany({ where: { status: { in: ["ACTIVE", "SUSPENDED"] } } });
  let suspended = 0, resumed = 0, warned = 0;
  for (const t of tenants) {
    try {
      const st = billingState(t);
      if (st.stage === "overdue" && t.status === "ACTIVE" && t.billingNotice !== resumedMark(st.paidUntil!)) {
        // Shartli: shu orada to'lov kelgan (paidUntil o'zgargan) bo'lsa — to'xtatilmaydi
        const r = await control.tenant.updateMany({
          where: { id: t.id, status: "ACTIVE", paidUntil: t.paidUntil },
          data: { status: "SUSPENDED", suspendedAt: new Date(), suspendReason: BILLING_SUSPEND_REASON, suspendKind: "billing", billingNotice: `overdue:${st.paidUntil}` },
        });
        if (r.count === 1) {
          await setSuspended(t.dbName, true, BILLING_SUSPEND_REASON);
          await control.controlEvent.create({ data: { tenantId: t.id, action: "TENANT_SUSPEND", detail: { auto: true, reason: BILLING_SUSPEND_REASON, paidUntil: st.paidUntil } } });
          await notify(`[OBUNA] ${t.name}: to'lov muddati (${st.paidUntil}) va ${t.graceDays} kunlik imtiyoz o'tdi — korxona avtomatik to'xtatildi. To'lov kiritilsa o'zi yoqiladi.`);
          suspended++;
        }
      } else if (await resumeIfBilling(t)) {
        resumed++;
        await notify(`[OBUNA] ${t.name}: muddat surildi — korxona qayta yoqildi.`);
      } else if ((st.stage === "soon" || st.stage === "grace") && t.billingNotice !== `${st.stage}:${st.paidUntil}` && t.billingNotice !== resumedMark(st.paidUntil!)) {
        const r = await control.tenant.updateMany({ where: { id: t.id, paidUntil: t.paidUntil }, data: { billingNotice: `${st.stage}:${st.paidUntil}` } });
        if (r.count === 1) {
          await notify(st.stage === "soon"
            ? `[OBUNA] ${t.name}: obuna ${st.paidUntil} da tugaydi (${st.daysLeft} kun qoldi).`
            : `[OBUNA] ${t.name}: obuna ${st.paidUntil} da tugagan — to'lov bo'lmasa ${st.suspendOn} da avtomatik to'xtatiladi.`);
          warned++;
        }
      }
      await syncTenantPlatform(t);
    } catch (e) {
      opts.log?.(`[billing] ${t.slug}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  return `obuna: ${tenants.length} korxona, ${warned} ogohlantirish, ${suspended} to'xtatildi, ${resumed} yoqildi`;
}
