import { db } from "./db";

/**
 * To'lanmagan kirimlar — sklad/snabjeniye yozgan, lekin hali kassadan pul chiqmagan kirim hujjatlari.
 *
 * Alohida holat ustuni yo'q: kirim to'langanini unga bog'langan chiqim (`CashTransaction`,
 * refType = "GoodsReceipt") ko'rsatadi. Ta'minot zanjiridan kelgan kirimning chiqimi moliya
 * pul ajratganda yozilgan va qabulda shu kirimga bog'lanadi — shuning uchun u bu ro'yxatga tushmaydi.
 */
export type UnpaidReceipt = { id: string; docNo: string; date: Date; supplier: string; supplierId: string; total: number; lines: number };

/**
 * Shu sanadan oldingi kirimlar ro'yxatga kirmaydi: ilgari kirim bilan birga chiqim darhol yozilardi,
 * chiqimsiz eski kirimlar (Excel import, dastlabki ma'lumot) esa to'lov kutmaydi.
 */
const PAYABLES_SINCE = new Date("2026-09-30T00:00:00+05:00");

export async function unpaidReceipts(): Promise<UnpaidReceipt[]> {
  const recs = await db.goodsReceipt.findMany({
    // Ta'minot zanjiridan kelgan kirim bu yerga tushmaydi — uning puli zanjirda ajratilgan
    where: { createdAt: { gte: PAYABLES_SINCE }, supply: { is: null } },
    orderBy: { date: "asc" },
    include: { supplier: { select: { name: true } }, items: { select: { qty: true, price: true } } },
  });
  if (!recs.length) return [];
  const paid = await db.cashTransaction.findMany({
    where: { refType: "GoodsReceipt", refId: { in: recs.map((r) => r.id) } },
    select: { refId: true },
  });
  const paidIds = new Set(paid.map((p) => p.refId));
  return recs
    .filter((r) => !paidIds.has(r.id))
    .map((r) => ({
      id: r.id, docNo: r.docNo, date: r.date, supplier: r.supplier.name, supplierId: r.supplierId,
      total: r.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0), lines: r.items.length,
    }))
    .filter((r) => r.total > 0.005);
}
