import { db } from "./db";
import { audit } from "./audit";
import { balanceDropError, cashOutflowError } from "./payments";
import { isoDate } from "./format";

/**
 * Realizatsiya jurnali — avval Excel'dan yuklangan kunlik jo'natma jadvali (Kassa/bank → «Realizatsiya jurnali» tabi).
 * Yangi import yo'q (Kassa/bank'dagi Excel import endi Kassa jurnaliga yozadi, `lib/cash-import.ts`); bu yerda
 * jadvaldagi «Деньги» nomi va yuklangan partiyani qaytarish qoladi.
 */

/**
 * "Деньги" ustuni → pul qaysi hisobga tushadi:
 * н-к (наличка) — naqd kassa, п-р (перечисление) — bank hisobi. Tanib bo'lmasa null.
 */
export function payKind(v: string): "CASH" | "BANK" | null {
  // Bo'shliq, nuqta va o'zbekcha tutuq belgilarining barcha ko'rinishi (' ‘ ’ ʻ ʼ `) olib tashlanadi; "п/р" = "п-р"
  const s = v.toLowerCase().replace(/[\s.,'"‘’ʻʼ`]/g, "").replace(/\//g, "-");
  if (!s) return null;
  if (/^(н-?к|нал|naqd|nk|nal)/.test(s)) return "CASH";
  if (/^(п-?р|перечисл|безнал|б-?н|pr|otkazma|otkazish|pulotkaz|perechisl|bank|plastik|karta|terminal|click|payme|uzcard|humo)/.test(s)) return "BANK";
  return null;
}

/** Kassa/bank sahifasida ko'rsatiladigan nom. */
export const payKindLabel = (v: string | null) => {
  const k = payKind(v ?? "");
  return k === "CASH" ? "naqd" : k === "BANK" ? "o'tkazma" : v || "—";
};

class RegisterError extends Error {}

// ───────────────────────── Qatorni tahrirlash ─────────────────────────

type Dec = { toString(): string } | number;
type RegRow = {
  date: Date; customerId: string; vehicleNo: string | null; ttn: string | null; productName: string; unit: string; qty: Dec;
  fromWho: string | null; payType: string | null; deliveryFee: Dec; price: Dec; sum: Dec; nds: Dec; total: Dec;
  address: string | null; contractNo: string | null; invoiceNo: string | null; monthNo: string | null; note: string | null; cashAccountId: string | null;
};

/** Tahrir oynasi ochilgandagi holat: saqlashda bazadagisi boshqacha bo'lsa — boshqa joyda o'zgartirilgan. */
export const registerSig = (r: RegRow) => [
  isoDate(r.date), r.customerId, r.vehicleNo, r.ttn, r.productName, r.unit, Number(r.qty).toFixed(3), r.fromWho, r.payType,
  ...[r.deliveryFee, r.price, r.sum, r.nds, r.total].map((x) => Number(x).toFixed(2)),
  r.address, r.contractNo, r.invoiceNo, r.monthNo, r.note, r.cashAccountId,
].map((x) => x ?? "").join("|");

export type RegisterEdit = {
  date: Date; customerId: string; vehicleNo: string | null; ttn: string | null; productName: string; unit: string; qty: number;
  fromWho: string | null; payType: string | null; deliveryFee: number; price: number; sum: number; nds: number; total: number;
  address: string | null; contractNo: string | null; invoiceNo: string | null; monthNo: string | null; note: string | null;
  cashAccountId: string | null; sig: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Realizatsiya jurnali qatorini tuzatish — Excel'dagi barcha ustunlar (sana, mashina, mahsulot, TTN, miqdor, mijoz,
 * «Деньги», narx, summa, NDS, itogo, manzil…). Qatordan kassaga kirim yozilgan bo'lsa — o'sha to'lov ham shu bilan
 * birga o'zgaradi (summa = Itogo, mijoz, hisob, sana); hisob kamaysa minusga tushmasin. AuditLog'ga UPDATE.
 */
export async function updateRegisterRow(id: string, d: RegisterEdit, userId: string): Promise<{ error?: string }> {
  if (!Number.isFinite(d.date.getTime())) return { error: "Sana noto'g'ri" };
  if (d.date.getTime() > Date.now() + 86_400_000) return { error: "Sana kelajakda bo'lmasin" };
  if (!d.productName.trim()) return { error: "Mahsulot nomi kerak" };
  const total = r2(d.total);
  const cust = await db.customer.findUnique({ where: { id: d.customerId }, select: { isInternal: true } });
  if (!cust) return { error: "Mijoz topilmadi" };
  if (cust.isInternal) return { error: "Ichki (tizim) mijozi tanlanmaydi" };
  const r0 = await db.salesRegister.findUnique({ where: { id }, select: { customerId: true } });
  if (!r0) return { error: "Qator topilmadi" };
  return db.$transaction(async (tx) => {
    // To'lov yozish/storno bilan bir navbat — mijoz bo'yicha (ikkala mijoz, bir xil tartibda)
    for (const c of [...new Set([r0.customerId, d.customerId])].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c}))`;
    const cur = await tx.salesRegister.findUniqueOrThrow({ where: { id }, include: { payment: true } });
    if (registerSig(cur) !== d.sig) throw new RegisterError("Qator boshqa joyda o'zgartirildi — sahifani yangilang");
    let cashAccountId = d.cashAccountId || cur.cashAccountId;
    const p = cur.payment;
    if (p) {
      if (!(total > 0)) throw new RegisterError("Bu qatordan kassaga kirim yozilgan — Itogo 0 dan katta bo'lsin");
      cashAccountId = d.cashAccountId || p.cashAccountId;
      if (cashAccountId !== p.cashAccountId) {
        const acc = await tx.cashAccount.findFirst({ where: { id: cashAccountId, isActive: true }, select: { id: true } });
        if (!acc) throw new RegisterError("Kassa/hisob topilmadi yoki yopilgan");
      }
      const err = await balanceDropError(tx, [{ accountId: p.cashAccountId, delta: -Number(p.amount) }, { accountId: cashAccountId, delta: total }]);
      if (err) throw new RegisterError(err);
    }
    const data = {
      date: d.date, customerId: d.customerId, vehicleNo: d.vehicleNo, ttn: d.ttn, productName: d.productName.trim(), unit: d.unit.trim() || "m3",
      qty: Math.round(d.qty * 1000) / 1000, fromWho: d.fromWho, payType: d.payType, deliveryFee: r2(d.deliveryFee), price: r2(d.price), sum: r2(d.sum), nds: r2(d.nds), total,
      address: d.address, contractNo: d.contractNo, invoiceNo: d.invoiceNo, monthNo: d.monthNo, note: d.note, cashAccountId,
    };
    await tx.salesRegister.update({ where: { id }, data });
    await audit(tx, userId, "UPDATE", "SalesRegister", id, { ...cur, payment: undefined }, data);
    if (p) {
      const pay = { amount: total, customerId: d.customerId, cashAccountId: cashAccountId!, date: d.date };
      if (Math.abs(Number(p.amount) - total) > 0.005 || p.customerId !== pay.customerId || p.cashAccountId !== pay.cashAccountId || p.date.getTime() !== pay.date.getTime()) {
        await tx.payment.update({ where: { id: p.id }, data: pay });
        await audit(tx, userId, "UPDATE", "Payment", p.id, { amount: p.amount, customerId: p.customerId, cashAccountId: p.cashAccountId, date: p.date }, { ...pay, by: "register-edit" });
      }
    }
    return {};
  }).catch((e: Error) => { if (e instanceof RegisterError) return { error: e.message }; throw e; });
}

/** Import partiyasini butunlay qaytarish: qatorlar va ular yozgan kassa kirimlari o'chadi. */
export async function deleteRegisterBatch(batch: string, userId: string): Promise<{ rows: number; payments: number; error?: string }> {
  return db.$transaction(async (tx) => {
    const rows = await tx.salesRegister.findMany({ where: { batch }, select: { id: true, paymentId: true } });
    if (!rows.length) return { rows: 0, payments: 0 };
    await tx.salesRegister.deleteMany({ where: { batch } });
    const payIds = rows.map((r) => r.paymentId).filter((x): x is string => !!x);
    if (payIds.length) {
      // Partiya yozgan kassa kirimlari o'chadi — har hisob bo'yicha naqd kassa minusga tushmasin
      const byAcc = await tx.payment.groupBy({ by: ["cashAccountId"], where: { id: { in: payIds } }, _sum: { amount: true } });
      for (const a of byAcc) {
        const cashErr = await cashOutflowError(tx, a.cashAccountId, Number(a._sum.amount ?? 0));
        if (cashErr) throw new RegisterError(`Partiya qaytarilsa kassa minusga tushadi. ${cashErr}`);
      }
      await tx.payment.deleteMany({ where: { id: { in: payIds } } });
    }
    await audit(tx, userId, "DELETE", "SalesRegister", batch, { rows: rows.length, payments: payIds.length }, undefined);
    return { rows: rows.length, payments: payIds.length };
  }).catch((e: Error) => { if (e instanceof RegisterError) return { rows: 0, payments: 0, error: e.message }; throw e; });
}
