import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { balanceDropError, cashOutflowError } from "@/lib/payments";
import { isoDate } from "@/lib/format";
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

/** Bir xil o'tkazma shu oraliqda qayta kelsa — ikki marta bosilgan deb hisoblanadi (to'lov va kirim/chiqimdagi kabi). */
const DUPLICATE_WINDOW_MS = 60_000;

/** Ichki: tranzaksiya ichidan "shu kalit bilan allaqachon saqlangan" natijasini chiqarish uchun. */
class TransferDuplicate extends Error {
  constructor(readonly doc: { id: string; docNo: string }) { super("duplicate"); }
}

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

/**
 * O'tkazma hujjati (OT-…) va uning ikki oyog'i — tranzaksiya ichida, qulf va qoldiq tekshiruvi chaqiruvchida.
 * «Kassa ⇄ bank» formasi ham, Kassa / bank Excel importidagi juft «perekit» qatorlari ham shu bilan yozadi.
 */
export async function insertTransfer(tx: Tx, d: {
  date: Date; from: { id: string; name: string }; to: { id: string; name: string }; amount: number;
  fee?: number; feeAccountId?: string | null; note: string | null; clientToken?: string | null;
}, userId: string) {
  const t = await tx.cashTransfer.create({
    data: { docNo: await nextNo(tx, "cashTransfer", "OT"), date: d.date, fromAccountId: d.from.id, toAccountId: d.to.id, amount: d.amount, fee: d.fee && d.fee > 0 ? d.fee : null, feeAccountId: d.feeAccountId ?? null, note: d.note, createdById: userId, clientToken: d.clientToken ?? null },
  });
  const base = { date: d.date, amount: d.amount, category: TRANSFER_CATEGORY, refType: TRANSFER_REF, refId: t.id, createdById: userId, note: [t.docNo, d.note].filter(Boolean).join(" · ") };
  const outTx = await tx.cashTransaction.create({ data: { ...base, type: "TRANSFER_OUT", cashAccountId: d.from.id, counterparty: `→ ${d.to.name}` } });
  const inTx = await tx.cashTransaction.create({ data: { ...base, type: "TRANSFER_IN", cashAccountId: d.to.id, counterparty: `← ${d.from.name}` } });
  return { t, outTx, inTx };
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
      // Dublikat tekshiruvi qulfdan keyin, shu tranzaksiyada — parallel so'rovlar navbat bilan o'tadi va ikkinchisi
      // birinchisining hujjatini ko'radi (ilgari mobil tekshiruv qulfdan tashqarida edi: 5 parallel → 5 hujjat).
      if (input.clientToken) {
        // Shu kalitli parallel so'rov bizdan oldin saqlagan bo'lsa — o'sha hujjat qaytadi (vebdagi "qayta bosildi")
        const same = await tx.cashTransfer.findUnique({ where: { clientToken: input.clientToken }, select: { id: true, docNo: true } });
        if (same) throw new TransferDuplicate(same);
      }
      const recent = await tx.cashTransfer.findFirst({
        where: { createdById: userId, fromAccountId: from.id, toAccountId: to.id, amount, cancelledAt: null, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
        select: { docNo: true },
      });
      if (recent) throw new TransferError(`${recent.docNo} hozirgina saqlandi — ikki marta bosilgan bo'lishi mumkin. Rostdan ikkinchisi bo'lsa, bir daqiqadan keyin qayta kiriting`);
      // Manba: o'tkazma (+ komissiya shu hisobdan bo'lsa) qoldiqdan oshmasin — naqd kassa hech qachon, bank overdraftsiz
      const outErr = await cashOutflowError(tx, from.id, amount + (feeAccountId === from.id ? fee : 0));
      if (outErr) throw new TransferError(outErr);
      const { t, outTx, inTx } = await insertTransfer(tx, { date: input.date, from, to, amount, fee, feeAccountId, note, clientToken: input.clientToken }, userId);
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
    if (e instanceof TransferDuplicate) return { ...e.doc, duplicate: true };
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
  return dropTransfer(id, reason, userId, false);
}

/**
 * O'tkazmani butunlay o'chirish (Kassa / bank → qator tafsiloti → «O'chirish»): ikkala yozuv (va komissiya) ham,
 * hujjatning o'zi ham qolmaydi — to'liq holati AuditLog'da. Bekor qilingan hujjat ham shu bilan o'chadi.
 */
export async function deleteTransfer(id: string, reason: string, userId: string): Promise<{ error?: string }> {
  return dropTransfer(id, reason, userId, true);
}

/** Storno (`purge = false` — hujjat «bekor qilingan» bo'lib qoladi) yoki o'chirish (`purge = true`). */
async function dropTransfer(id: string, reason: string, userId: string, purge: boolean): Promise<{ error?: string }> {
  const why = reason.trim();
  if (why.length < 3) return { error: purge ? "O'chirish sababini yozing" : "Bekor qilish sababini yozing" };
  try {
    return await db.$transaction(async (tx) => {
      const pre = await tx.cashTransfer.findUnique({ where: { id }, select: { fromAccountId: true, toAccountId: true } });
      if (!pre) throw new TransferError("O'tkazma topilmadi");
      await lockAccounts(tx, [pre.fromAccountId, pre.toAccountId]);
      // Qulfdan keyin qayta o'qiladi — ikki parallel storno ikkinchisi "allaqachon" ni ko'rsin
      const t = await tx.cashTransfer.findUnique({ where: { id }, include: { toAccount: { select: { name: true } } } });
      if (!t) throw new TransferError("O'tkazma allaqachon o'chirilgan");
      if (t.cancelledAt && !purge) throw new TransferError(`${t.docNo} allaqachon bekor qilingan`);
      // Bekor qilingan hujjatning oyoqlari allaqachon o'chgan — faqat hujjat qoladi
      if (!t.cancelledAt) {
        // O'tkazma oyoqlari alohida bekor qilinmaydi (`cashEntryLocked`) — `cancelledAt` filtri kerak emas
        const legs = await tx.cashTransaction.findMany({ where: { refType: TRANSFER_REF, refId: t.id } });
        // Qabul qiluvchi hisobdan pul qaytib chiqadi (u yerdan komissiya yechilgan bo'lsa — u qaytadi)
        const feeOnTo = legs.filter((l) => l.type === "EXPENSE" && l.cashAccountId === t.toAccountId).reduce((s, l) => s + Number(l.amount), 0);
        const inSum = legs.filter((l) => l.type === "TRANSFER_IN").reduce((s, l) => s + Number(l.amount), 0);
        const outflow = r2(inSum - feeOnTo);
        if (outflow > 0.005) {
          const err = await cashOutflowError(tx, t.toAccountId, outflow);
          if (err) throw new TransferError(`${purge ? "O'chirilsa" : "Bekor qilinsa"} ${t.toAccount.name} minusga tushadi (pul allaqachon sarflangan). ${err}`);
        }
        await tx.cashTransaction.deleteMany({ where: { id: { in: legs.map((l) => l.id) } } });
        for (const l of legs) await audit(tx, userId, "DELETE", "CashTransaction", l.id, l, { reversed: true, by: purge ? "transfer-delete" : "transfer-storno", transfer: t.docNo });
      }
      if (purge) {
        await tx.cashTransfer.delete({ where: { id: t.id } });
        await audit(tx, userId, "DELETE", "CashTransfer", t.id, { ...t, toAccount: undefined }, { deleted: true, reason: why.slice(0, 300) });
        return {};
      }
      const after = await tx.cashTransfer.update({ where: { id: t.id }, data: { cancelledAt: new Date(), cancelReason: why.slice(0, 300), cancelledById: userId } });
      await audit(tx, userId, "STATUS_CHANGE", "CashTransfer", t.id, { cancelledAt: null }, { cancelledAt: after.cancelledAt, reason: after.cancelReason });
      return {};
    });
  } catch (e) {
    if (e instanceof TransferError) return { error: e.message };
    throw e;
  }
}

/** Tahrir oynasi ochilgandagi holat: saqlashda bazadagisi boshqacha bo'lsa — boshqa joyda o'zgartirilgan. */
export const transferSig = (t: { amount: unknown; date: Date; fromAccountId: string; toAccountId: string; note: string | null }) =>
  [Number(t.amount).toFixed(2), isoDate(t.date), t.fromAccountId, t.toAccountId, t.note ?? ""].join("|");

export type TransferEdit = { date: Date; fromAccountId: string; toAccountId: string; amount: number; note?: string | null; sig: string };

/**
 * O'tkazmani (perekit) tuzatish — Kassa / bank → Kassa jurnalidagi oyoq qalami: sana, qayerdan, qayerga, summa, izoh.
 * Hujjat va ikkala oyog'i birga o'zgaradi (komissiya yozuvining sanasi ham). Komissiyali o'tkazmada hisoblar o'zgarmaydi
 * (komissiya shu hisoblardan biriga yechilgan). Tahrirdan keyin qaysi hisob kamaysa — minusga tushmasin. AuditLog'ga UPDATE.
 */
export async function updateTransfer(id: string, d: TransferEdit, userId: string): Promise<{ error?: string }> {
  const amount = r2(d.amount);
  if (!(amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  if (!Number.isFinite(d.date.getTime())) return { error: "Sana noto'g'ri" };
  if (d.date.getTime() > Date.now() + 86_400_000) return { error: "Sana kelajakda bo'lmasin" };
  if (d.fromAccountId === d.toAccountId) return { error: "Qayerdan va qayerga — bir xil hisob bo'lolmaydi" };
  const accs = await db.cashAccount.findMany({ where: { id: { in: [d.fromAccountId, d.toAccountId] } }, select: { id: true, name: true, isActive: true } });
  const from = accs.find((a) => a.id === d.fromAccountId), to = accs.find((a) => a.id === d.toAccountId);
  try {
    return await db.$transaction(async (tx) => {
      const pre = await tx.cashTransfer.findUnique({ where: { id }, select: { fromAccountId: true, toAccountId: true } });
      if (!pre) throw new TransferError("O'tkazma topilmadi");
      await lockAccounts(tx, [pre.fromAccountId, pre.toAccountId, d.fromAccountId, d.toAccountId]);
      const t = await tx.cashTransfer.findUniqueOrThrow({ where: { id } });
      if (t.cancelledAt) throw new TransferError(`${t.docNo} bekor qilingan — tahrirlanmaydi`);
      if (transferSig(t) !== d.sig) throw new TransferError(`${t.docNo} boshqa joyda o'zgartirildi — sahifani yangilang`);
      const moved = d.fromAccountId !== t.fromAccountId || d.toAccountId !== t.toAccountId;
      if (moved && Number(t.fee ?? 0) > 0) throw new TransferError(`${t.docNo} komissiyali — hisoblar o'zgarmaydi (bekor qilib, qayta kiriting)`);
      if (d.fromAccountId !== t.fromAccountId && !from?.isActive) throw new TransferError("Qayerdan: kassa/hisob topilmadi yoki yopilgan");
      if (d.toAccountId !== t.toAccountId && !to?.isActive) throw new TransferError("Qayerga: kassa/hisob topilmadi yoki yopilgan");
      const old = Number(t.amount);
      const err = await balanceDropError(tx, [
        { accountId: t.fromAccountId, delta: old }, { accountId: t.toAccountId, delta: -old },
        { accountId: d.fromAccountId, delta: -amount }, { accountId: d.toAccountId, delta: amount },
      ]);
      if (err) throw new TransferError(err);
      const note = d.note?.trim() || null;
      // Sana o'zgarmagan bo'lsa — asl vaqt (soat) qoladi
      const date = isoDate(d.date) === isoDate(t.date) ? t.date : d.date;
      const after = await tx.cashTransfer.update({ where: { id }, data: { date, fromAccountId: d.fromAccountId, toAccountId: d.toAccountId, amount, note } });
      const legNote = [t.docNo, note].filter(Boolean).join(" · ");
      await tx.cashTransaction.updateMany({ where: { refType: TRANSFER_REF, refId: id, type: "TRANSFER_OUT" }, data: { date, cashAccountId: d.fromAccountId, amount, counterparty: `→ ${to?.name ?? ""}`, note: legNote } });
      await tx.cashTransaction.updateMany({ where: { refType: TRANSFER_REF, refId: id, type: "TRANSFER_IN" }, data: { date, cashAccountId: d.toAccountId, amount, counterparty: `← ${from?.name ?? ""}`, note: legNote } });
      await tx.cashTransaction.updateMany({ where: { refType: TRANSFER_REF, refId: id, type: "EXPENSE" }, data: { date } });
      await audit(tx, userId, "UPDATE", "CashTransfer", id, { date: t.date, fromAccountId: t.fromAccountId, toAccountId: t.toAccountId, amount: t.amount, note: t.note }, { date: after.date, fromAccountId: after.fromAccountId, toAccountId: after.toAccountId, amount: after.amount, note: after.note });
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
    id: t.id, docNo: t.docNo, date: t.date, createdAt: t.createdAt, amount: Number(t.amount), fee: Number(t.fee ?? 0), note: t.note,
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
