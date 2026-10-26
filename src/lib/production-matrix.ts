import { db } from "./db";

/**
 * Ishlab chiqarish oynasidagi «Matritsa» (zavodning Excel jadvali o'rniga): qatorlar — dona mahsulot,
 * ustunlar — ochiq zayavkalar, oxirgi ustun — natija = skladdagi qoldiq − zayavkalarda band.
 * Manfiy natija = shuncha quyish kerak.
 *
 * Qoldiq = SUM(StockMove.qty) (barcha skladlar). Band — tasdiqlangan mijoz zayavkalarining hali jo'natilmagan qismi
 * (`ostatka.ts` bilan bir xil to'plam: kind SALE, CONFIRMED / IN_PRODUCTION; qoralama band qilmaydi).
 * Reys zayavka bo'yicha yoziladi (mahsulotsiz), shuning uchun jo'natilgani qatorlarga miqdoriga mutanosib bo'linadi.
 *
 * Holat (Excel'dagi ranglar): tayyor — hamma qatori brigadada bajarilgan; quyilmoqda — topshiriq berilgan;
 * navbatda — hali brigadaga berilmagan. Qoldiq zayavkalarga shu tartibda, keyin yetkazish sanasi bo'yicha taqsimlanadi —
 * katak «skladdan yopiladi / qisman / yetmaydi» shundan bilinadi.
 */

export type MatrixStatus = "ready" | "pour" | "queue";
const PRI: Record<MatrixStatus, number> = { ready: 0, pour: 1, queue: 2 };

export type MatrixProduct = { id: string; code: string; name: string; unit: string; stock: number; band: number };
export type MatrixOrder = {
  id: string; customer: string; deliveryDate: string; dateUnknown: boolean; isUrgent: boolean; status: MatrixStatus;
  /** mahsulot id → jo'natilmagan miqdor */
  items: Record<string, number>;
  /** mahsulot id → skladdan unga to'g'ri keladigan qism */
  alloc: Record<string, number>;
};
export type ProductionMatrix = { products: MatrixProduct[]; orders: MatrixOrder[] };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function productionMatrix(): Promise<ProductionMatrix> {
  const [products, sums, orders] = await Promise.all([
    db.product.findMany({ where: { isActive: true, unit: { not: "m3" } }, select: { id: true, code: true, name: true, unit: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    db.order.findMany({
      where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, items: { some: { product: { unit: { not: "m3" } } } } },
      select: {
        id: true, deliveryDate: true, dateUnknown: true, isUrgent: true, customer: { select: { name: true } },
        items: { select: { productId: true, qtyM3: true, product: { select: { unit: true } }, task: { select: { status: true, qty: true, doneQty: true } } } },
        trips: { where: { status: { not: "CANCELLED" } }, select: { qtyM3: true } },
      },
      take: 300,
    }),
  ]);
  const stock = new Map(sums.map((s) => [s.productId!, Number(s._sum.qty ?? 0)]));

  const rows: MatrixOrder[] = [];
  for (const o of orders) {
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const shipped = o.trips.reduce((s, t) => s + Number(t.qtyM3), 0);
    const left = total > 0 ? Math.max(0, 1 - shipped / total) : 0;
    const dona = o.items.filter((i) => i.product.unit !== "m3");
    const items: Record<string, number> = {};
    for (const i of dona) {
      const q = round3(Number(i.qtyM3) * left);
      if (q > 0) items[i.productId] = (items[i.productId] ?? 0) + q;
    }
    if (!Object.keys(items).length) continue;
    const tasks = dona.map((i) => (i.task && i.task.status !== "CANCELLED" ? i.task : null));
    const status: MatrixStatus = tasks.every((t) => t && (t.status === "DONE" || Number(t.doneQty) >= Number(t.qty))) ? "ready" : tasks.some(Boolean) ? "pour" : "queue";
    rows.push({ id: o.id, customer: o.customer.name, deliveryDate: o.deliveryDate.toISOString(), dateUnknown: o.dateUnknown, isUrgent: o.isUrgent, status, items, alloc: {} });
  }
  rows.sort((a, b) => PRI[a.status] - PRI[b.status] || a.deliveryDate.localeCompare(b.deliveryDate));

  // Qoldiqni taqsimlash: tayyor → quyilmoqda → navbatda, ichida eski sana birinchi (rows shu tartibda)
  const left = new Map(stock);
  const band = new Map<string, number>();
  for (const o of rows) {
    for (const [pid, q] of Object.entries(o.items)) {
      const have = Math.max(0, left.get(pid) ?? 0);
      const g = Math.min(q, have);
      o.alloc[pid] = round3(g);
      left.set(pid, have - g);
      band.set(pid, (band.get(pid) ?? 0) + q);
    }
  }

  return {
    products: products
      .map((p) => ({ ...p, stock: round3(stock.get(p.id) ?? 0), band: round3(band.get(p.id) ?? 0) }))
      .sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true })),
    orders: rows,
  };
}
