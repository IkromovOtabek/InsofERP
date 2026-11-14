import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { MAX_AMOUNT } from "./action";
import { money } from "./format";
import { cancelOpeningTx, createOpeningTx, lockOpening, OpeningError, updateOpeningTx } from "./opening-balances";
import { customerBalance } from "./receivables";
import { supplierPositions } from "./fin-report/balance";

/**
 * Qarz varag'idagi qo'lda amallar (Tahlil → Mijozlar):
 *  · «Qarzni boshqa mijoz to'ladi» (`CustomerDebtTransfer`, QO-…): qarzdor mijoz qarzidan summa ayiriladi, to'lovchi mijozga
 *    yoziladi. To'lovchi puli kassaga o'z nomi bilan tushadi (yoki uning avansi ishlatiladi) — bu hujjat kassaga tegmaydi.
 *    Tahrir va bekor qilish — sabab bilan, AuditLog'da; o'chirilmaydi.
 *  · «Qoldiqni tuzatish»: tanlangan kun oxiridagi qarzni berilgan summaga tenglash — o'sha kunga boshlang'ich qoldiq
 *    yozuvi (Excel importidagi qoida, `import-openings.ts`): yozuv = kerakli qoldiq − tizimdagi boshqa harakat.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
export type DebtTransferInput = { date: Date; debtorId: string; payerId: string; amount: number; note: string | null };
type Result = { error?: string; id?: string; docNo?: string };

async function check(d: DebtTransferInput): Promise<string | null> {
  if (!(d.amount > 0)) return "Summa 0 dan katta bo'lsin";
  if (d.amount > MAX_AMOUNT) return "Summa juda katta";
  if (d.debtorId === d.payerId) return "Qarzdor va to'lovchi bitta mijoz bo'lolmaydi";
  if (d.date.getTime() > Date.now() + 86_400_000) return "Kelajak sanasi bo'lmaydi";
  const list = await db.customer.findMany({ where: { id: { in: [d.debtorId, d.payerId] } }, select: { id: true, isInternal: true } });
  if (list.length !== 2 || list.some((c) => c.isInternal)) return "Mijoz topilmadi";
  return null;
}

export async function createDebtTransfer(d: DebtTransferInput, userId: string): Promise<Result> {
  const err = await check(d);
  if (err) return { error: err };
  return db.$transaction(async (tx) => {
    const t = await tx.customerDebtTransfer.create({
      data: { docNo: await nextNo(tx, "customerDebtTransfer", "QO"), date: d.date, debtorId: d.debtorId, payerId: d.payerId, amount: r2(d.amount), note: d.note, createdById: userId },
    });
    await audit(tx, userId, "CREATE", "CustomerDebtTransfer", t.id, undefined, t);
    return { id: t.id, docNo: t.docNo };
  });
}

export async function updateDebtTransfer(id: string, d: DebtTransferInput, userId: string): Promise<Result> {
  const err = await check(d);
  if (err) return { error: err };
  const before = await db.customerDebtTransfer.findUnique({ where: { id } });
  if (!before || before.cancelledAt) return { error: "Hujjat topilmadi yoki bekor qilingan" };
  // Shartli yozish: shu payt bekor qilingan bo'lsa o'zgarmaydi
  const r = await db.customerDebtTransfer.updateMany({ where: { id, cancelledAt: null }, data: { date: d.date, debtorId: d.debtorId, payerId: d.payerId, amount: r2(d.amount), note: d.note } });
  if (!r.count) return { error: "Hujjat shu payt bekor qilindi" };
  const after = await db.customerDebtTransfer.findUniqueOrThrow({ where: { id } });
  await audit(db, userId, "UPDATE", "CustomerDebtTransfer", id, before, after);
  return { id, docNo: after.docNo };
}

export async function cancelDebtTransfer(id: string, reason: string, userId: string): Promise<Result> {
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { error: "Sababini yozing (kamida 3 belgi)" };
  const r = await db.customerDebtTransfer.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: why } });
  if (!r.count) return { error: "Hujjat topilmadi yoki allaqachon bekor qilingan" };
  await audit(db, userId, "STATUS_CHANGE", "CustomerDebtTransfer", id, { cancelled: false }, { cancelled: true, reason: why });
  return { id };
}

// ───────────────────────── Qoldiqni tuzatish ─────────────────────────

const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + 1); return x; };
/** Boshlang'ich qoldiq yozuvi sanasi — kunning o'zi (Excel importidagidek, `new Date("YYYY-MM-DD")`). */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * `day` kuni oxiridagi qarzni `target` ga tenglaydi (mijozda musbat — mijoz qarzi, ta'minotchida musbat — bizning qarzimiz).
 * O'sha kunga yozuv bo'lsa — summasi o'zgaradi (kerak bo'lmasa bekor qilinadi), bo'lmasa yangisi ochiladi.
 */
export async function setDebtBalance(kind: "CUSTOMER" | "SUPPLIER", id: string, day: Date, target: number, note: string | null, userId: string): Promise<{ error?: string; changed?: number }> {
  if (Math.abs(target) > MAX_AMOUNT) return { error: "Summa juda katta" };
  const today = new Date(); today.setHours(23, 59, 59, 999);
  if (day > today) return { error: "Kelajak sanasi bo'lmaydi" };
  const iso = isoDay(day), at = new Date(iso), end = endOfDay(day);
  const ref = kind === "CUSTOMER" ? { kind, customerId: id } : { kind, supplierId: id };
  const now = kind === "CUSTOMER" ? (await customerBalance(id, { asOf: end })).balance : (await supplierPositions(end)).get(id) ?? 0;
  const diff = r2(target - now);
  if (Math.abs(diff) < 0.005) return { changed: 0 };
  try {
    await db.$transaction(async (tx) => {
      await lockOpening(tx, ref);
      // Shu kundagi faol yozuv (eski kalitli yozuv ham sanasi bo'yicha) — `opening-balances.ts → sameDayDebt` qoidasi
      const mine = await tx.openingBalance.findFirst({
        where: { ...ref, cancelledAt: null, date: { gte: at, lt: new Date(at.getTime() + 86_400_000) } },
        select: { id: true, amount: true },
      });
      const text = [`Qoldiq tuzatish: ${iso} kun oxiri ${money(target)}`, note].filter(Boolean).join(" · ");
      if (mine) {
        const need = r2(Number(mine.amount) + diff);
        if (Math.abs(need) < 0.005) await cancelOpeningTx(tx, mine.id, `Qoldiq tuzatish: ${iso} — yozuv kerak emas`, userId);
        else await updateOpeningTx(tx, mine.id, { date: at, amount: need, note: text, reason: note }, userId);
      } else {
        await createOpeningTx(tx, { ...ref, date: at, amount: diff, note: text }, userId);
      }
    });
  } catch (e) {
    if (e instanceof OpeningError) return { error: e.message };
    throw e;
  }
  return { changed: diff };
}

