import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zOpt, zStr, MAX_AMOUNT } from "@/lib/action";
import { validDay, validMonth } from "@/lib/davomat";
import { saveLateFine } from "@/lib/hr/late-fine";
import type { KadrResult } from "@/lib/kadr-employee";

/**
 * Otdel kadr kundalik amallari — veb server action'lari (`otdel-kadr/hr-actions.ts`, `settings/davomat/actions.ts`)
 * va mobil ilova (`lib/mobile/kadr-extra.ts`) uchun bitta qoida. Ruxsat chaqiruvchida (`requireAction` / `canDo`).
 */

// ───────────────────────── Qo'lda jarima / bonus ─────────────────────────

const adjSchema = z.object({
  employeeId: zStr("Xodimni tanlang"),
  month: zStr("Oyni tanlang"),
  kind: z.enum(["BONUS", "PENALTY"], { message: "Turini tanlang" }),
  amount: zDec(0),
  reason: zStr("Sababini yozing").pipe(z.string().max(300, "Sabab 300 belgidan oshmasin")),
  date: zOpt,
});

/** Qo'lda jarima / bonus — shu oyning yakuniy hisobida. */
export async function addPayAdjustmentCore(userId: string, fd: FormData): Promise<KadrResult> {
  const r = parseForm(adjSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (!validMonth(d.month)) return { error: "Oy noto'g'ri" };
  if (d.amount <= 0) return { error: "Summani kiriting" };
  const closed = await db.payrollRun.findFirst({ where: { month: d.month, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { docNo: true } });
  if (closed) return { error: `${d.month} oyining yakuniy vedomosti (${closed.docNo}) allaqachon tasdiqqa yuborilgan — keyingi oyga yozing` };
  const emp = await db.employee.findUnique({ where: { id: d.employeeId }, select: { id: true } });
  if (!emp) return { error: "Xodim topilmadi" };
  const date = d.date && validDay(d.date) ? new Date(`${d.date}T00:00:00.000Z`) : null;
  const id = await db.$transaction(async (tx) => {
    const x = await tx.payAdjustment.create({ data: { employeeId: d.employeeId, month: d.month, kind: d.kind, amount: Math.round(d.amount), reason: d.reason, date, createdById: userId } });
    await audit(tx, userId, "CREATE", "PayAdjustment", x.id, undefined, x);
    return x.id;
  });
  return { ok: true, id, note: `${d.kind === "BONUS" ? "Bonus" : "Jarima"} yozildi` };
}

/** Bekor qilish (o'chirilmaydi) — sababi bilan. */
export async function cancelPayAdjustmentCore(userId: string, id: string, fd: FormData): Promise<KadrResult> {
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Bekor qilish sababini yozing" };
  const cur = await db.payAdjustment.findUnique({ where: { id } });
  if (!cur) return { error: "Yozuv topilmadi" };
  const closed = await db.payrollRun.findFirst({ where: { month: cur.month, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { docNo: true } });
  if (closed) return { error: `${closed.docNo} tasdiqqa yuborilgan — bu yozuv endi o'zgarmaydi` };
  const n = await db.$transaction(async (tx) => {
    const x = await tx.payAdjustment.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelReason: reason, cancelledById: userId } });
    if (x.count) await audit(tx, userId, "UPDATE", "PayAdjustment", id, { cancelledAt: null }, { cancelledAt: new Date(), cancelReason: reason });
    return x.count;
  });
  if (!n) return { error: "Yozuv allaqachon bekor qilingan" };
  return { ok: true, note: "Bekor qilindi" };
}

// ───────────────────────── Kechikish jarimasi (Sozlamalar → Davomat) ─────────────────────────

const lateFineSchema = z.object({
  mode: z.enum(["day", "minute"], { message: "Hisoblash usulini tanlang" }),
  amount: zDec(0),
  graceMinutes: z.coerce.number({ message: "Imtiyoz daqiqasi raqam bo'lsin" }).int("Imtiyoz butun son bo'lsin").min(0, "Imtiyoz manfiy bo'lmasin").max(240, "Imtiyoz ko'pi bilan 240 daqiqa"),
  maxPerMonth: z.preprocess((v) => (v == null || String(v).trim() === "" ? null : v),
    z.coerce.number({ message: "Oylik chegara raqam bo'lsin" }).min(0, "Oylik chegara manfiy bo'lmasin").max(MAX_AMOUNT, "Oylik chegara juda katta").nullable()),
  note: zOpt,
  isActive: z.string().optional().transform((v) => v === "on"),
});

/** Kechikish jarimasi qoidasi (veb forma maydonlari: mode, amount, graceMinutes, maxPerMonth, note, isActive="on"). */
export async function saveLateFineCore(userId: string, fd: FormData): Promise<KadrResult> {
  const r = parseForm(lateFineSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (d.isActive && d.amount <= 0) return { error: "Jarima summasini kiriting yoki qoidani o'chirib qo'ying" };
  const res = await saveLateFine(userId, {
    amount: Math.round(d.amount * 100) / 100, perMinute: d.mode === "minute", graceMinutes: d.graceMinutes,
    maxPerMonth: d.maxPerMonth == null ? null : Math.round(d.maxPerMonth * 100) / 100, isActive: d.isActive, note: d.note,
  });
  if ("error" in res) return { error: res.error };
  return { ok: true, note: res.changed ? "Saqlandi" : "O'zgarish yo'q" };
}
