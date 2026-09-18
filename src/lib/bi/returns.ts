import { db } from "@/lib/db";
import { type Range, type Gran, loadSales, productCosts, sum, safeDiv, kpi, series } from "./core";

/**
 * Bekor qilingan zayavkalar — Team24 "Qaytgan mahsulotlar" sahifasining beton zavodi ekvivalenti.
 * Beton qaytarilmaydi; yo'qotish = bekor qilingan zayavkalar (tushum va marja).
 */
export async function returnsTab(r: Range, gran: Gran, filter: { product?: string; reason?: string; seller?: string; page: number; size: number }) {
  const [cur, prev, active, prevActive, orders, costs] = await Promise.all([
    loadSales(r.from, r.to, ["CANCELLED"]), loadSales(r.prevFrom, r.prevTo, ["CANCELLED"]), loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo),
    db.order.findMany({ where: { status: "CANCELLED", date: { gte: r.from, lt: r.to } }, select: { id: true, note: true, deliveryAddress: true, updatedAt: true } }),
    productCosts(),
  ]);
  const reasonOf = new Map(orders.map((o) => [o.id, (o.note ?? "").trim() || "Ko'rsatilmagan"]));
  const rows = cur.map((x) => ({ ...x, reason: reasonOf.get(x.orderId) ?? "Ko'rsatilmagan", margin: x.revenue - x.cost }));

  const total = sum(rows.map((x) => x.revenue)), prevTotal = sum(prev.map((x) => x.revenue));
  const activeRev = sum(active.map((x) => x.revenue)), prevActiveRev = sum(prevActive.map((x) => x.revenue));
  const rate = safeDiv(total, total + activeRev) * 100, prevRate = safeDiv(prevTotal, prevTotal + prevActiveRev) * 100;
  const count = new Set(rows.map((x) => x.orderId)).size, prevCount = new Set(prev.map((x) => x.orderId)).size;
  const lostMargin = sum(rows.map((x) => x.margin)), prevLostMargin = sum(prev.map((x) => x.revenue - x.cost));
  const customers = new Set(rows.map((x) => x.customerId)).size;
  const volume = sum(rows.filter((x) => x.unit === "m3").map((x) => x.qty));

  const dyn = series(rows, r.from, r.to, gran, (x) => x.date, (x) => x.revenue);
  const dynCount = series([...new Map(rows.map((x) => [x.orderId, x])).values()], r.from, r.to, gran, (x) => x.date, () => 1);
  const daily = series(rows, r.from, r.to, "day", (x) => x.date, (x) => x.revenue);
  const worst = [...daily].sort((a, b) => b.value - a.value)[0];
  const daysWith = daily.filter((d) => d.value > 0).length;

  const group = <K,>(key: (x: typeof rows[number]) => K, name: (x: typeof rows[number]) => string) => {
    const m = new Map<K, typeof rows>(); for (const x of rows) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
    return [...m.entries()].map(([k, list]) => ({ key: String(k), name: name(list[0]), value: sum(list.map((x) => x.revenue)), qty: sum(list.map((x) => x.qty)), unit: list[0].unit, count: new Set(list.map((x) => x.orderId)).size, customers: new Set(list.map((x) => x.customerId)).size, margin: sum(list.map((x) => x.margin)), share: safeDiv(sum(list.map((x) => x.revenue)), total) * 100 })).sort((a, b) => b.value - a.value);
  };
  const byProduct = group((x) => x.productId, (x) => `${x.code} — ${x.product}`);
  const byReason = group((x) => x.reason, (x) => x.reason);
  const bySeller = group((x) => x.sellerId, (x) => x.seller);
  const byCustomer = group((x) => x.customerId, (x) => x.customer);

  let list = rows;
  if (filter.product) list = list.filter((x) => x.productId === filter.product);
  if (filter.reason) list = list.filter((x) => x.reason === filter.reason);
  if (filter.seller) list = list.filter((x) => x.sellerId === filter.seller);
  list = [...list].sort((a, b) => b.date.getTime() - a.date.getTime());
  const pageRows = list.slice((filter.page - 1) * filter.size, filter.page * filter.size);

  return {
    kpis: { total: kpi(total, prevTotal), rate: kpi(rate, prevRate), lostMargin: kpi(lostMargin, prevLostMargin), count: kpi(count, prevCount), avg: kpi(safeDiv(total, count), safeDiv(prevTotal, prevCount)), customers, volume, lines: rows.length, products: byProduct.length, rateDelta: rate - prevRate },
    dyn, dynCount, worst, avgDaily: safeDiv(total, r.days), daysWith, byProduct, byReason, bySeller, byCustomer,
    list: { rows: pageRows, total: list.length, page: filter.page, size: filter.size },
    productOptions: byProduct.map((p) => ({ id: p.key, name: p.name })), reasonOptions: byReason.map((x) => x.key), sellerOptions: bySeller.map((x) => ({ id: x.key, name: x.name })),
    costsKnown: [...costs.values()].filter((c) => c.cost !== null).length,
  };
}
