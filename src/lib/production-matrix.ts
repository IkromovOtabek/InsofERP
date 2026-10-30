import { db } from "./db";
import { itemTasks } from "./production";
import { unitTotals, type UnitTotal } from "./unit";

/**
 * Ishlab chiqarish oynasidagi «Matritsa» (zavodning Excel jadvali o'rniga): qatorlar — dona mahsulot,
 * ustunlar — ochiq zayavkalar, oxirgi ustun — natija = skladdagi qoldiq − zayavkalarda band.
 * Manfiy natija = shuncha quyish kerak.
 *
 * Qoldiq = SUM(StockMove.qty) (barcha skladlar). Band — tasdiqlangan mijoz zayavkalarining hali jo'natilmagan qismi
 * (`ostatka.ts` bilan bir xil to'plam: kind SALE, CONFIRMED / IN_PRODUCTION; qoralama band qilmaydi).
 * Reys zayavka bo'yicha yoziladi (mahsulotsiz), shuning uchun jo'natilgani qatorlarga miqdoriga mutanosib bo'linadi.
 *
 * Matritsa katagi brigada holatini ko'rsatadi: tayinlanmagan / qisman (qatorning bir qismi brigadaga berilgan) / tayinlangan;
 * katak bosilsa shu qator «Brigada tayinlash» formasida ochiladi. Doska uchun holat: tayyor — hamma qatori brigadada
 * bajarilgan; quyilmoqda — topshiriq berilgan; navbatda — hali brigadaga berilmagan. Qoldiq zayavkalarga shu tartibda, keyin yetkazish sanasi bo'yicha taqsimlanadi —
 * katak «skladdan yopiladi / qisman / yetmaydi» shundan bilinadi.
 */

export type MatrixStatus = "ready" | "pour" | "queue";
/** Brigada tayinlash holati: tayinlanmagan / qisman / to'liq */
export type MatrixAssign = "none" | "part" | "full";
/** Matritsa katagi — zayavka qatori: tayinlashda shu qator ochiladi */
export type MatrixCell = { itemId: string; qty: number; given: number; brigades: string[] };
const PRI: Record<MatrixStatus, number> = { ready: 0, pour: 1, queue: 2 };

export type MatrixProduct = { id: string; code: string; name: string; unit: string; stock: number; band: number };
export type MatrixOrder = {
  id: string; customer: string; deliveryDate: string; dateUnknown: boolean; isUrgent: boolean; status: MatrixStatus; assign: MatrixAssign;
  /** mahsulot id → jo'natilmagan miqdor */
  items: Record<string, number>;
  /** mahsulot id → skladdan unga to'g'ri keladigan qism */
  alloc: Record<string, number>;
  /** mahsulot id → zayavka qatori va uning brigadalarga berilgani (qator miqdori, jo'natilganidan qat'i nazar) */
  cells: Record<string, MatrixCell>;
};
/**
 * Yuqoridagi kartalar — birlik bo'yicha (dona, m², m³ bir songa qo'shilmaydi). Beton (m³) matritsaga kirmaydi,
 * lekin bu yerda hisoblanadi: band = jo'natilmagani, quyish kerak = jo'natilmagani − zamesda quyilgani (beton saqlanmaydi).
 */
export type MatrixSummary = {
  stock: UnitTotal[]; stockKinds: number;
  band: UnitTotal[]; orders: number;
  need: UnitTotal[]; needKinds: number;
  /** Muddati o'tgan, hali to'liq ishlab chiqarilmagan zayavkalar; shundan beton qatori borlari */
  late: number; lateBeton: number;
};
/** Mahsulot bo'yicha «ishlab chiqarish kerak» (dona: band − qoldiq; beton: jo'natilmagani − quyilgani) — bosh sahifa ro'yxati. */
export type MatrixNeed = { id: string; code: string; name: string; unit: string; band: number; stock: number; need: number };
export type ProductionMatrix = { products: MatrixProduct[]; orders: MatrixOrder[]; summary: MatrixSummary; needList: MatrixNeed[] };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function productionMatrix(): Promise<ProductionMatrix> {
  const [products, sums, orders] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, unit: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    db.order.findMany({
      where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] } },
      select: {
        id: true, deliveryDate: true, dateUnknown: true, isUrgent: true, customer: { select: { name: true } },
        items: { select: { id: true, productId: true, qtyM3: true, product: { select: { unit: true } }, tasks: { select: { status: true, qty: true, doneQty: true, brigade: { select: { name: true } } } } } },
        trips: { where: { status: { not: "CANCELLED" } }, select: { qtyM3: true } },
        // Beton uchun: zamesda quyilgani (storno qilinmagan)
        batches: { where: { cancelledAt: null }, select: { productId: true, qtyM3: true } },
      },
      take: 300,
    }),
  ]);
  const stock = new Map(sums.map((s) => [s.productId!, Number(s._sum.qty ?? 0)]));

  const rows: MatrixOrder[] = [];
  const betonBand: { unit: string; qty: number }[] = [], betonNeed = new Map<string, number>(), betonBandBy = new Map<string, number>();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let late = 0, lateBeton = 0;
  for (const o of orders) {
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const shipped = o.trips.reduce((s, t) => s + Number(t.qtyM3), 0);
    const left = total > 0 ? Math.max(0, 1 - shipped / total) : 0;
    // Beton qatorlari: jo'natilmagani band, undan zamesda quyilgani (jo'natilgandan ortig'i) ayiriladi
    let betonShort = 0;
    for (const i of o.items.filter((x) => x.product.unit === "m3")) {
      const q = Number(i.qtyM3), sent = q * (1 - left);
      const poured = o.batches.filter((b) => b.productId === i.productId).reduce((s, b) => s + Number(b.qtyM3), 0);
      const need = Math.max(0, q - Math.max(sent, poured));
      betonBand.push({ unit: "m3", qty: q * left }); betonBandBy.set(i.productId, (betonBandBy.get(i.productId) ?? 0) + q * left); betonNeed.set(i.productId, (betonNeed.get(i.productId) ?? 0) + need);
      betonShort += need;
    }
    const dona = o.items.filter((i) => i.product.unit !== "m3");
    const donaOpen = dona.some((i) => !itemTasks(i.qtyM3, i.tasks).done);
    if (!o.dateUnknown && o.deliveryDate < today && left > 0 && (donaOpen || betonShort > 0.0005)) { late++; if (betonShort > 0.0005) lateBeton++; }
    const items: Record<string, number> = {};
    for (const i of dona) {
      const q = round3(Number(i.qtyM3) * left);
      if (q > 0) items[i.productId] = (items[i.productId] ?? 0) + q;
    }
    if (!Object.keys(items).length) continue;
    const st = dona.map((i) => itemTasks(i.qtyM3, i.tasks));
    const status: MatrixStatus = st.every((x) => x.done) ? "ready" : st.some((x) => x.any) ? "pour" : "queue";
    const assign: MatrixAssign = st.every((x) => x.full) ? "full" : st.some((x) => x.given > 0) ? "part" : "none";
    // Bir zayavkada bir mahsulot ikki qatorda bo'lsa — birinchisi ochiladi, miqdorlar qo'shiladi
    const cells: Record<string, MatrixCell> = {};
    dona.forEach((i, n) => {
      const c = (cells[i.productId] ??= { itemId: i.id, qty: 0, given: 0, brigades: [] });
      c.qty = round3(c.qty + Number(i.qtyM3)); c.given = round3(c.given + st[n]!.given);
      for (const t of i.tasks) if (t.status !== "CANCELLED" && !c.brigades.includes(t.brigade.name)) c.brigades.push(t.brigade.name);
    });
    rows.push({ id: o.id, customer: o.customer.name, deliveryDate: o.deliveryDate.toISOString(), dateUnknown: o.dateUnknown, isUrgent: o.isUrgent, status, assign, items, alloc: {}, cells });
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

  const list = products
    .filter((p) => p.unit !== "m3")
    .map((p) => ({ ...p, stock: round3(stock.get(p.id) ?? 0), band: round3(band.get(p.id) ?? 0) }))
    .sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true }));
  const round = (t: UnitTotal[]) => t.map((x) => ({ unit: x.unit, qty: round3(x.qty) })).filter((x) => x.qty > 0.0005);
  const needRows = list.map((p) => ({ unit: p.unit, qty: Math.max(0, p.band - Math.max(0, p.stock)) }));
  const summary: MatrixSummary = {
    stock: round(unitTotals(list.map((p) => ({ unit: p.unit, qty: Math.max(0, p.stock) })))),
    stockKinds: list.filter((p) => p.stock > 0).length,
    band: round(unitTotals([...list.map((p) => ({ unit: p.unit, qty: p.band })), ...betonBand])),
    orders: orders.filter((o) => o.trips.reduce((s, t) => s + Number(t.qtyM3), 0) < o.items.reduce((s, i) => s + Number(i.qtyM3), 0) - 0.0005).length,
    need: round(unitTotals([...needRows, ...[...betonNeed.values()].map((qty) => ({ unit: "m3", qty }))])),
    needKinds: needRows.filter((x) => x.qty > 0.0005).length + [...betonNeed.values()].filter((q) => q > 0.0005).length,
    late, lateBeton,
  };
  const byId = new Map(products.map((p) => [p.id, p]));
  const needList: MatrixNeed[] = [
    ...list.map((p) => ({ ...p, need: round3(Math.max(0, p.band - Math.max(0, p.stock))) })),
    ...[...betonNeed].flatMap(([id, need]) => { const p = byId.get(id); return p ? [{ ...p, band: round3(betonBandBy.get(id) ?? 0), stock: 0, need: round3(need) }] : []; }),
  ].filter((x) => x.need > 0.0005).sort((a, b) => (a.unit === "m3" ? 0 : 1) - (b.unit === "m3" ? 0 : 1) || b.need - a.need);
  return { products: list, orders: rows, summary, needList };
}
