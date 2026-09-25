import { db } from "@/lib/db";
import { type Range, type Gran, loadSales, series, kpi, sum, abc, safeDiv, addDays, startOfDay, WEEKDAYS, type SaleRow } from "./core";

function groupBy<T, K>(rows: T[], key: (r: T) => K) {
  const m = new Map<K, T[]>();
  for (const r of rows) { const k = key(r); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); }
  return m;
}

export async function salesTab(r: Range, gran: Gran, page: number, size: number, filter: { customer?: string; product?: string }) {
  const [cur, prev, blocked, cancelled] = await Promise.all([
    loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo),
    loadSales(r.from, r.to, ["BLOCKED"]), loadSales(r.from, r.to, ["CANCELLED"]),
  ]);

  const revenue = sum(cur.map((x) => x.revenue)), prevRevenue = sum(prev.map((x) => x.revenue));
  const orders = new Set(cur.map((x) => x.orderId)).size, prevOrders = new Set(prev.map((x) => x.orderId)).size;
  const customers = new Set(cur.map((x) => x.customerId)).size, prevCustomers = new Set(prev.map((x) => x.customerId)).size;
  const gross = sum(cur.map((x) => x.revenue - x.cost)), prevGross = sum(prev.map((x) => x.revenue - x.cost));
  const volume = sum(cur.filter((x) => x.unit === "m3").map((x) => x.qty)), prevVolume = sum(prev.filter((x) => x.unit === "m3").map((x) => x.qty));

  // Temp / prognoz: joriy oy uchun kunlik o'rtacha × qolgan kunlar
  const today = startOfDay(new Date());
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1), monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const monthRows = r.period === "month" ? cur : await loadSales(monthStart, addDays(today, 1));
  const monthRevenue = sum(monthRows.map((x) => x.revenue));
  const daysPassed = Math.max(1, Math.round((today.getTime() - monthStart.getTime()) / 86400000) + 1);
  const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86400000);
  const pulse = { monthRevenue, perDay: monthRevenue / daysPassed, forecast: (monthRevenue / daysPassed) * daysInMonth, daysPassed, daysLeft: daysInMonth - daysPassed, today: sum(monthRows.filter((x) => x.date >= today).map((x) => x.revenue)) };

  const dyn = series(cur, r.from, r.to, gran, (x) => x.date, (x) => x.revenue);
  const dynPrev = series(prev, r.prevFrom, r.prevTo, gran, (x) => x.date, (x) => x.revenue);
  const dynVol = series(cur, r.from, r.to, gran, (x) => x.date, (x) => (x.unit === "m3" ? x.qty : 0));

  // Mahsulot bo'yicha
  const byProduct = [...groupBy(cur, (x) => x.productId).entries()].map(([id, rows]) => ({
    id, name: rows[0].product, code: rows[0].code, unit: rows[0].unit, revenue: sum(rows.map((x) => x.revenue)), qty: sum(rows.map((x) => x.qty)), gross: sum(rows.map((x) => x.revenue - x.cost)), orders: new Set(rows.map((x) => x.orderId)).size,
  })).sort((a, b) => b.revenue - a.revenue);
  const abcMap = abc(byProduct, (p) => p.revenue);
  const productRows = byProduct.map((p) => ({ ...p, abc: abcMap.get(p) ?? "C", share: safeDiv(p.revenue, revenue) * 100, margin: safeDiv(p.gross, p.revenue) * 100 }));
  let acc = 0;
  const pareto = productRows.map((p) => { acc += p.revenue; return { label: p.code, value: acc / (revenue || 1) * 100, share: p.share }; });
  const paretoCount = pareto.findIndex((p) => p.value >= 80) + 1;

  // Mijoz bo'yicha
  const byCustomer = [...groupBy(cur, (x) => x.customerId).entries()].map(([id, rows]) => ({ id, name: rows[0].customer, revenue: sum(rows.map((x) => x.revenue)), qty: sum(rows.map((x) => x.qty)), orders: new Set(rows.map((x) => x.orderId)).size })).sort((a, b) => b.revenue - a.revenue);

  // Nima o'sdi / pasaydi (mahsulot va mijoz kesimida)
  const prevProd = new Map([...groupBy(prev, (x) => x.productId).entries()].map(([id, rows]) => [id, sum(rows.map((x) => x.revenue))]));
  const prevCust = new Map([...groupBy(prev, (x) => x.customerId).entries()].map(([id, rows]) => [id, sum(rows.map((x) => x.revenue))]));
  const prodNames = new Map([...cur, ...prev].map((x) => [x.productId, x.code]));
  const custNames = new Map([...cur, ...prev].map((x) => [x.customerId, x.customer]));
  const curProd = new Map(byProduct.map((p) => [p.id, p.revenue])), curCust = new Map(byCustomer.map((c) => [c.id, c.revenue]));
  const movers = (curM: Map<string, number>, prevM: Map<string, number>, names: Map<string, string>) =>
    [...new Set([...curM.keys(), ...prevM.keys()])].map((id) => ({ id, name: names.get(id) ?? "?", cur: curM.get(id) ?? 0, prev: prevM.get(id) ?? 0, diff: (curM.get(id) ?? 0) - (prevM.get(id) ?? 0) }));
  const prodMovers = movers(curProd, prevProd, prodNames).sort((a, b) => b.diff - a.diff);
  const custMovers = movers(curCust, prevCust, custNames).sort((a, b) => b.diff - a.diff);

  // Yo'qotilgan tushum: bloklangan + bekor qilingan
  const lost = {
    blocked: sum(blocked.map((x) => x.revenue)), blockedOrders: new Set(blocked.map((x) => x.orderId)).size,
    cancelled: sum(cancelled.map((x) => x.revenue)), cancelledOrders: new Set(cancelled.map((x) => x.orderId)).size,
    blockedRows: [...groupBy(blocked, (x) => x.orderId).values()].map((rows) => ({ orderId: rows[0].orderId, orderNo: rows[0].orderNo, customer: rows[0].customer, revenue: sum(rows.map((x) => x.revenue)) })).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
  };

  // Sotuv imkoniyati: yuqori marjali va o'sayotgan mahsulotlar
  const opportunity = productRows.filter((p) => p.gross > 0).map((p) => ({ ...p, growth: safeDiv(p.revenue - (prevProd.get(p.id) ?? 0), (prevProd.get(p.id) ?? p.revenue) || 1) * 100 })).sort((a, b) => b.margin * b.revenue - a.margin * a.revenue).slice(0, 5);

  // Hafta kuni × soat intensivligi
  const weekday = WEEKDAYS.map((d) => ({ label: d, value: 0 }));
  for (const x of cur) weekday[x.date.getDay()].value += x.revenue;

  // Chegirma: bazaviy narxdan past sotilgan
  const discountRows = cur.filter((x) => x.basePrice > 0 && x.price < x.basePrice);
  const discount = sum(discountRows.map((x) => (x.basePrice - x.price) * x.qty));

  // Batafsil tranzaksiyalar
  let detail: SaleRow[] = cur;
  if (filter.customer) detail = detail.filter((x) => x.customerId === filter.customer);
  if (filter.product) detail = detail.filter((x) => x.productId === filter.product);
  detail = [...detail].sort((a, b) => b.date.getTime() - a.date.getTime());
  const total = detail.length;
  const pageRows = detail.slice((page - 1) * size, page * size);

  const customerOptions = byCustomer.map((c) => ({ id: c.id, name: c.name }));
  const productOptions = byProduct.map((p) => ({ id: p.id, name: p.code }));

  return {
    kpis: { revenue: kpi(revenue, prevRevenue), avgCheck: kpi(safeDiv(revenue, orders), safeDiv(prevRevenue, prevOrders)), orders: kpi(orders, prevOrders), customers: kpi(customers, prevCustomers), gross: kpi(gross, prevGross), margin: kpi(safeDiv(gross, revenue) * 100, safeDiv(prevGross, prevRevenue) * 100), volume: kpi(volume, prevVolume) },
    pulse, dyn, dynPrev, dynVol, productRows, pareto, paretoCount, byCustomer, prodMovers, custMovers, lost, opportunity, weekday, discount, discountCount: discountRows.length,
    detail: { rows: pageRows, total, page, size }, customerOptions, productOptions,
  };
}

/** CSV eksport uchun to'liq ro'yxat. */
export async function salesExport(r: Range) {
  const rows = await loadSales(r.from, r.to);
  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function orderStatusMix(r: Range) {
  const rows = await db.order.groupBy({ by: ["status"], where: { kind: "SALE", date: { gte: r.from, lt: r.to } }, _count: true });
  return rows.map((x) => ({ status: x.status, count: x._count }));
}
