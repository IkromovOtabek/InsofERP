import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { cashOutflowError } from "@/lib/payments";
import { BANK_FEE_CATEGORY, TRANSFER_CATEGORY, TRANSFER_REF } from "@/lib/cash-tx";

/**
 * Hisoblararo o'tkazma (kassa → bank inkassatsiya, bank → kassa naqdlashtirish, kassa → kassa).
 *
 * Ilgari bu chiqim + kirim bilan "taqlid" qilinardi — kirim/chiqim, P&L va kategoriya hisobotlari
 * ikki tomonlama shishib ketardi. Endi bitta hujjat (`CashTransfer`, OT-YYYY-00001) va ikki bog'langan yozuv:
 *   TRANSFER_OUT — manba hisobda (−), TRANSFER_IN — qabul qiluvchi hisobda (+), refType "CashTransfer".
 * Ular faqat hisob qoldig'iga kiradi. Bank komissiyasi (fee) — haqiqiy xarajat: oddiy EXPENSE "Bank xizmati"
 * (shu hujjatga bog'langan), u P&L ga kiradi.
 *
 * Storno (faqat direktor, sabab bilan): uchala yozuv o'chiriladi, hujjat `cancelledAt` bilan qoladi;
 * qabul qiluvchi hisob minusga tushsa — rad etiladi.
 */

type Tx = Prisma.TransactionClient;
export class TransferError extends Error {}

export type TransferInput = {
  date: Date;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  fee?: number | null;
  /** Komissiya qaysi hisobdan yechiladi (from yoki to). Berilmasa — bank tomoni (ikkalasi bank bo'lsa — manba). */
  feeAccountId?: string | null;
  note?: string | null;
  clientToken?: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ikki hisob bo'yicha qulf — har doim bir xil tartibda (A→B va B→A parallel o'tkazmalar bir-birini kutib qolmasin). */
async function lockAccounts(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cash:" + id}))`;
}

/** Komissiya hisobi standart qoidasi: bank tomoni (ikkalasi bank / ikkalasi naqd bo'lsa — manba). */
export function defaultFeeAccount(from: { id: string; type: string }, to: { id: string; type: string }): string {
  if (from.type === "BANK") return from.id;
  if (to.type === "BANK") return to.id;
  return from.id;
}

export async function createTransfer(input: TransferInput, userId: string): Promise<{ id?: string; docNo?: string; duplicate?: boolean; error?: string }> {
  const amount = r2(input.amount), fee = input.fee && input.fee > 0 ? r2(input.fee) : 0;
  if (!(amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  if (input.fromAccountId === input.toAccountId) return { error: "Qayerdan va qayerga — bir xil hisob bo'lolmaydi" };
  // Idempotentlik: shu kalit bilan o'tkazma allaqachon bor bo'lsa — o'shani qaytaramiz (ikki marta bosilgan "Saqlash")
  if (input.clientToken) {
    const dup = await db.cashTransfer.findUnique({ where: { clientToken: input.clientToken }, select: { id: true, docNo: true } });
    if (dup) return { ...dup, duplicate: true };
  }
  const accs = await db.cashAccount.findMany({ where: { id: { in: [input.fromAccountId, input.toAccountId] } } });
  const from = accs.find((a) => a.id === input.fromAccountId), to = accs.find((a) => a.id === input.toAccountId);
  if (!from || !from.isActive) return { error: "Qayerdan: kassa/hisob topilmadi yoki yopilgan" };
  if (!to || !to.isActive) return { error: "Qayerga: kassa/hisob topilmadi yoki yopilgan" };
  const feeAccountId = fee > 0 ? (input.feeAccountId || defaultFeeAccount(from, to)) : null;
  if (feeAccountId && feeAccountId !== from.id && feeAccountId !== to.id) return { error: "Komissiya faqat o'tkazma hisoblaridan biridan yechiladi" };
  const note = input.note?.trim() || null;

  try {
    return await db.$transaction(async (tx) => {
      await lockAccounts(tx, [from.id, to.id]);
      // Manba: o'tkazma (+ komissiya shu hisobdan bo'lsa) qoldiqdan oshmasin — naqd kassa hech qachon, bank overdraftsiz
      const outErr = await cashOutflowError(tx, from.id, amount + (feeAccountId === from.id ? fee : 0));
      if (outErr) throw new TransferError(outErr);
      const t = await tx.cashTransfer.create({
        data: { docNo: await nextNo(tx, "cashTransfer", "OT"), date: input.date, fromAccountId: from.id, toAccountId: to.id, amount, fee: fee > 0 ? fee : null, feeAccountId, note, createdById: userId, clientToken: input.clientToken ?? null },
      });
      const base = { date: input.date, amount, category: TRANSFER_CATEGORY, refType: TRANSFER_REF, refId: t.id, createdById: userId, note: [t.docNo, note].filter(Boolean).join(" · ") };
      const outTx = await tx.cashTransaction.create({ data: { ...base, type: "TRANSFER_OUT", cashAccountId: from.id, counterparty: `→ ${to.name}` } });
      const inTx = await tx.cashTransaction.create({ data: { ...base, type: "TRANSFER_IN", cashAccountId: to.id, counterparty: `← ${from.name}` } });
      let feeTx = null;
      if (fee > 0 && feeAccountId) {
        // Qabul qiluvchidan yechiladigan komissiya: o'tkazma tushgandan keyingi qoldiqdan oshmasin
        if (feeAccountId === to.id) {
          const feeErr = await cashOutflowError(tx, to.id, fee);
          if (feeErr) throw new TransferError(`Komissiya: ${feeErr}`);
        }
        feeTx = await tx.cashTransaction.create({
          data: { type: "EXPENSE", date: input.date, cashAccountId: feeAccountId, amount: fee, category: BANK_FEE_CATEGORY, counterparty: "Bank", refType: TRANSFER_REF, refId: t.id, createdById: userId, note: `${t.docNo} · o'tkazma komissiyasi` },
        });
      }
      await audit(tx, userId, "CREATE", "CashTransfer", t.id, undefined, { ...t, legs: [outTx.id, inTx.id], feeTx: feeTx?.id ?? null });
      return { id: t.id, docNo: t.docNo };
    });
  } catch (e) {
    if (e instanceof TransferError) return { error: e.message };
    // Poyga: ikkita bir xil kalitli so'rov birga kelsa — ikkinchisi unique xatosini oladi, birinchisini qaytaramiz
    if (input.clientToken && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await db.cashTransfer.findUnique({ where: { clientToken: input.clientToken }, select: { id: true, docNo: true } });
      if (dup) return { ...dup, duplicate: true };
    }
    throw e;
  }
}

export async function cancelTransfer(id: string, reason: string, userId: string): Promise<{ error?: string }> {
  const why = reason.trim();
  if (why.length < 3) return { error: "Storno sababini yozing" };
  try {
    return await db.$transaction(async (tx) => {
      const pre = await tx.cashTransfer.findUnique({ where: { id }, select: { fromAccountId: true, toAccountId: true } });
      if (!pre) throw new TransferError("O'tkazma topilmadi");
      await lockAccounts(tx, [pre.fromAccountId, pre.toAccountId]);
      // Qulfdan keyin qayta o'qiladi — ikki parallel storno ikkinchisi "allaqachon" ni ko'rsin
      const t = await tx.cashTransfer.findUniqueOrThrow({ where: { id }, include: { toAccount: { select: { name: true } } } });
      if (t.cancelledAt) throw new TransferError(`${t.docNo} allaqachon storno qilingan`);
      const legs = await tx.cashTransaction.findMany({ where: { refType: TRANSFER_REF, refId: t.id } });
      // Qabul qiluvchi hisobdan pul qaytib chiqadi (u yerdan komissiya yechilgan bo'lsa — u qaytadi)
      const feeOnTo = legs.filter((l) => l.type === "EXPENSE" && l.cashAccountId === t.toAccountId).reduce((s, l) => s + Number(l.amount), 0);
      const inSum = legs.filter((l) => l.type === "TRANSFER_IN").reduce((s, l) => s + Number(l.amount), 0);
      const outflow = r2(inSum - feeOnTo);
      if (outflow > 0.005) {
        const err = await cashOutflowError(tx, t.toAccountId, outflow);
        if (err) throw new TransferError(`Storno qilinsa ${t.toAccount.name} minusga tushadi (pul allaqachon sarflangan). ${err}`);
      }
      await tx.cashTransaction.deleteMany({ where: { id: { in: legs.map((l) => l.id) } } });
      for (const l of legs) await audit(tx, userId, "DELETE", "CashTransaction", l.id, l, { reversed: true, by: "transfer-storno", transfer: t.docNo });
      const after = await tx.cashTransfer.update({ where: { id: t.id }, data: { cancelledAt: new Date(), cancelReason: why.slice(0, 300), cancelledById: userId } });
      await audit(tx, userId, "STATUS_CHANGE", "CashTransfer", t.id, { cancelledAt: null }, { cancelledAt: after.cancelledAt, reason: after.cancelReason });
      return {};
    });
  } catch (e) {
    if (e instanceof TransferError) return { error: e.message };
    throw e;
  }
}

/** O'tkazmalar ro'yxati (Kirim-Chiqim sahifasi, mobil): davr va ixtiyoriy hisob bo'yicha. */
export async function listTransfers(where: { from: Date; to: Date; accountId?: string; take?: number }) {
  const rows = await db.cashTransfer.findMany({
    where: { date: { gte: where.from, lte: where.to }, ...(where.accountId ? { OR: [{ fromAccountId: where.accountId }, { toAccountId: where.accountId }] } : {}) },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: where.take ?? 200,
    include: { fromAccount: { select: { name: true, type: true } }, toAccount: { select: { name: true, type: true } }, createdBy: { select: { fullName: true } }, cancelledBy: { select: { fullName: true } } },
  });
  return rows.map((t) => ({
    id: t.id, docNo: t.docNo, date: t.date, amount: Number(t.amount), fee: Number(t.fee ?? 0), note: t.note,
    from: t.fromAccount.name, fromType: t.fromAccount.type, to: t.toAccount.name, toType: t.toAccount.type,
    by: t.createdBy.fullName, cancelledAt: t.cancelledAt, cancelReason: t.cancelReason, cancelledBy: t.cancelledBy?.fullName ?? null,
  }));
}

/** Matn: "Asosiy kassa → Bank" (yo'nalish nomi bilan). */
export function transferKind(fromType: string, toType: string): string {
  if (fromType === "CASH" && toType === "BANK") return "Inkassatsiya";
  if (fromType === "BANK" && toType === "CASH") return "Naqdlashtirish";
  if (fromType === "CASH" && toType === "CASH") return "Kassadan kassaga";
  return "Hisobdan hisobga";
}
