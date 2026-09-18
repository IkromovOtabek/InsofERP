import { db } from "@/lib/db";
import { type Range, addDays, startOfDay, sum, safeDiv, ACTIVE_ORDER, abc, bucketKey, bucketLabel, bucketsFor } from "./core";

export type Segment = "VIP" | "Loyal" | "Regular" | "New" | "At Risk" | "Lost" | "Yangi (xaridsiz)";
export type Risk = "Kritik" | "Yuqori" | "O'rta" | "Past" | "Xavfsiz";
export const SEGMENT_ORDER: Segment[] = ["VIP", "Loyal", "Regular", "New", "At Risk", "Lost", "Yangi (xaridsiz)"];
export const SEGMENT_COLOR: Record<Segment, string> = { VIP: "#f59e0b", Loyal: "#10b981", Regular: "#3b82f6", New: "#8b5cf6", "At Risk": "#f97316", Lost: "#ef4444", "Yangi (xaridsiz)": "#94a3b8" };

export type CustomerRow = {
  id: string; name: string; phone: string | null; creditLimit: number; createdAt: Date;
  recency: number | null; lastOrder: Date | null; firstOrder: Date | null; frequency: number; monetary: number; lifetime: number; orders: number;
  avgMonthly: number; debt: number; overdueDebt: number; oldestDebtDays: number | null;
  segment: Segment; risk: Risk; riskScore: number; expectedLoss: number; abc: "A" | "B" | "C"; action: string;
};

const DAY = 86400000;

export async function customerBase(): Promise<CustomerRow[]> {
  const today = startOfDay(new Date()), since180 = addDays(today, -180);
  const [customers, items, invoices] = await Promise.all([
    db.customer.findMany({ select: { id: true, name: true, phone: true, creditLimit: true, createdAt: true, isActive: true } }),
    db.orderItem.findMany({ where: { order: { status: { in: ACTIVE_ORDER } } }, select: { qtyM3: true, price: true, order: { select: { id: true, date: true, customerId: true } } } }),
    db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, select: { id: true, customerId: true, amount: true, date: true, payments: { select: { amount: true } } } }),
  ]);

  const byCust = new Map<string, { orders: Map<string, { date: Date; revenue: number }> }>();
  for (const i of items) {
    const c = byCust.get(i.order.customerId) ?? { orders: new Map() }; byCust.set(i.order.customerId, c);
    const o = c.orders.get(i.order.id) ?? { date: i.order.date, revenue: 0 }; o.revenue += Number(i.qtyM3) * Number(i.price); c.orders.set(i.order.id, o);
  }
  const debtBy = new Map<string, { debt: number; overdue: number; oldest: number | null }>();
  for (const inv of invoices) {
    const open = Number(inv.amount) - sum(inv.payments.map((p) => Number(p.amount)));
    if (open <= 0) continue;
    const age = Math.floor((today.getTime() - startOfDay(inv.date).getTime()) / DAY);
    const d = debtBy.get(inv.customerId) ?? { debt: 0, overdue: 0, oldest: null }; debtBy.set(inv.customerId, d);
    d.debt += open; if (age > 30) d.overdue += open; d.oldest = Math.max(d.oldest ?? 0, age);
  }

  const rows = customers.map((c) => {
    const orders = [...(byCust.get(c.id)?.orders.values() ?? [])].sort((a, b) => a.date.getTime() - b.date.getTime());
    const last = orders.at(-1)?.date ?? null, first = orders[0]?.date ?? null;
    const recency = last ? Math.floor((today.getTime() - startOfDay(last).getTime()) / DAY) : null;
    const recent = orders.filter((o) => o.date >= since180);
    const monetary = sum(recent.map((o) => o.revenue)), lifetime = sum(orders.map((o) => o.revenue));
    const lifeDays = first ? Math.max(30, (today.getTime() - first.getTime()) / DAY) : 30;
    const avgMonthly = lifetime / (lifeDays / 30);
    const d = debtBy.get(c.id) ?? { debt: 0, overdue: 0, oldest: null };
    return { id: c.id, name: c.name, phone: c.phone, creditLimit: Number(c.creditLimit), createdAt: c.createdAt, recency, lastOrder: last, firstOrder: first, frequency: recent.length, monetary, lifetime, orders: orders.length, avgMonthly, debt: d.debt, overdueDebt: d.overdue, oldestDebtDays: d.oldest };
  });

  const monetaryVals = rows.filter((x) => x.monetary > 0).map((x) => x.monetary).sort((a, b) => b - a);
  const vipCut = monetaryVals[Math.max(0, Math.floor(monetaryVals.length * 0.2) - 1)] ?? Infinity;
  const abcMap = abc(rows, (x) => x.lifetime);

  return rows.map((x) => {
    let segment: Segment;
    if (x.recency === null) segment = "Yangi (xaridsiz)";
    else if (x.recency >= 90) segment = "Lost";
    else if (x.recency >= 45) segment = "At Risk";
    else if (x.firstOrder && (today.getTime() - x.firstOrder.getTime()) / DAY <= 30) segment = "New";
    else if (x.monetary >= vipCut && x.frequency >= 2) segment = "VIP";
    else if (x.frequency >= 3) segment = "Loyal";
    else segment = "Regular";
    // Xavf bali: recency og'irligi + qarz + chastota pasayishi
    let score = 0;
    if (x.recency !== null) score += Math.min(60, (x.recency / 90) * 60);
    if (x.debt > 0) score += 15; if (x.overdueDebt > 0) score += 15;
    if (x.frequency <= 1 && x.orders > 1) score += 10;
    if (x.recency === null) score = 0;
    const risk: Risk = score >= 80 ? "Kritik" : score >= 60 ? "Yuqori" : score >= 35 ? "O'rta" : score > 10 ? "Past" : "Xavfsiz";
    const expectedLoss = x.avgMonthly * 12 * Math.min(1, score / 100);
    const action = segment === "Lost" ? (x.debt > 0 ? "Qarzni undirish — qo'ng'iroq qiling" : "Qayta jalb qilish taklifi") : segment === "At Risk" ? "Tezkor qo'ng'iroq — nega to'xtadi?" : x.overdueDebt > 0 ? "Muddati o'tgan qarz — eslatma" : segment === "VIP" ? "Shaxsiy xizmat, ustuvor yetkazish" : segment === "New" ? "Ikkinchi buyurtmaga undash" : segment === "Yangi (xaridsiz)" ? "Birinchi zayavkani rasmiylashtiring" : "Doimiy aloqa";
    return { ...x, segment, risk, riskScore: Math.round(score), expectedLoss, abc: abcMap.get(x) ?? "C", action };
  });
}

export async function customersTab(r: Range, filter: { segment?: string; risk?: string; debt?: string; q?: string; page: number; size: number }) {
  const base = await customerBase();
  const today = startOfDay(new Date());
  const active = base.filter((x) => x.recency !== null && x.recency < 30);
  const cur = await db.orderItem.findMany({ where: { order: { date: { gte: r.from, lt: r.to }, status: { in: ACTIVE_ORDER } } }, select: { qtyM3: true, price: true, orderId: true, order: { select: { customerId: true, date: true } } } });
  const revenue = sum(cur.map((x) => Number(x.qtyM3) * Number(x.price)));
  const orderIds = new Set(cur.map((x) => x.orderId)).size;

  const seg = (s: Segment) => base.filter((x) => x.segment === s);
  const segments = SEGMENT_ORDER.map((s) => ({ segment: s, count: seg(s).length, revenue: sum(seg(s).map((x) => x.monetary)), debt: sum(seg(s).map((x) => x.debt)), color: SEGMENT_COLOR[s] }));
  const cards = {
    total: base.length, active: active.length, vip: seg("VIP").length, atRisk: seg("At Risk").length + seg("Lost").length,
    avgCheck: safeDiv(revenue, orderIds), debt: sum(base.map((x) => x.debt)), debtors: base.filter((x) => x.debt > 0).length,
    silent: base.filter((x) => x.recency !== null && x.recency >= 14 && x.recency < 50).length,
    stopped: base.filter((x) => x.recency !== null && x.recency >= 50).length,
    newCount: base.filter((x) => x.firstOrder && (today.getTime() - x.firstOrder.getTime()) / DAY <= 30).length,
    activityRate: safeDiv(active.length, base.length) * 100,
  };

  // RFM matritsa: Recency × Frequency
  const rBuckets = ["0–14", "15–44", "45–89", "90+"], fBuckets = ["1", "2–3", "4–6", "7+"];
  const cells = rBuckets.map(() => fBuckets.map(() => 0)); const cellMoney = rBuckets.map(() => fBuckets.map(() => 0));
  for (const x of base) {
    if (x.recency === null) continue;
    const ri = x.recency < 15 ? 0 : x.recency < 45 ? 1 : x.recency < 90 ? 2 : 3;
    const fi = x.frequency <= 1 ? 0 : x.frequency <= 3 ? 1 : x.frequency <= 6 ? 2 : 3;
    cells[ri][fi]++; cellMoney[ri][fi] += x.monetary;
  }

  // Qarz aging
  const invoices = await db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, select: { date: true, amount: true, customerId: true, customer: { select: { name: true } }, payments: { select: { amount: true } } } });
  const aging = { "0–30": 0, "31–60": 0, "61–90": 0, "90+": 0 } as Record<string, number>;
  const agingByCust = new Map<string, { name: string; b: number[] }>();
  for (const inv of invoices) {
    const open = Number(inv.amount) - sum(inv.payments.map((p) => Number(p.amount))); if (open <= 0) continue;
    const age = (today.getTime() - startOfDay(inv.date).getTime()) / DAY;
    const bi = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
    aging[Object.keys(aging)[bi]] += open;
    const c = agingByCust.get(inv.customerId) ?? { name: inv.customer.name, b: [0, 0, 0, 0] }; c.b[bi] += open; agingByCust.set(inv.customerId, c);
  }
  const agingTop = [...agingByCust.entries()].map(([id, c]) => ({ id, name: c.name, b: c.b, total: sum(c.b) })).sort((a, b) => b.total - a.total).slice(0, 10);

  // Mijoz oqimi: oy bo'yicha yangi / yo'qotilgan (oxirgi 6 oy)
  const from6 = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  const keys = bucketsFor(from6, addDays(today, 1), "month");
  const flow = keys.map((k) => ({ label: bucketLabel(k, "month"), newC: 0, lost: 0 }));
  for (const x of base) {
    if (x.firstOrder && x.firstOrder >= from6) { const i = keys.indexOf(bucketKey(x.firstOrder, "month")); if (i >= 0) flow[i].newC++; }
    if (x.segment === "Lost" && x.lastOrder) { const lostAt = addDays(x.lastOrder, 90); if (lostAt >= from6 && lostAt <= today) { const i = keys.indexOf(bucketKey(lostAt, "month")); if (i >= 0) flow[i].lost++; } }
  }

  // CLV scatter: lifetime × monetary(180d), r = frequency
  const clv = base.filter((x) => x.lifetime > 0).sort((a, b) => b.lifetime - a.lifetime).slice(0, 60).map((x) => ({ x: x.lifetime, y: x.monetary, r: x.frequency + 1, label: x.name, color: SEGMENT_COLOR[x.segment] }));

  // Next Best Action: pul bo'yicha eng muhim 8 mijoz
  const nba = base.filter((x) => x.segment !== "Yangi (xaridsiz)").map((x) => ({ ...x, priority: x.overdueDebt * 1.5 + x.expectedLoss })).sort((a, b) => b.priority - a.priority).slice(0, 8);

  // Jadval filtrlari
  let list = base;
  if (filter.segment) list = list.filter((x) => x.segment === filter.segment);
  if (filter.risk) list = list.filter((x) => x.risk === filter.risk);
  if (filter.debt === "yes") list = list.filter((x) => x.debt > 0); if (filter.debt === "no") list = list.filter((x) => x.debt <= 0);
  if (filter.q) { const q = filter.q.toLowerCase(); list = list.filter((x) => x.name.toLowerCase().includes(q)); }
  list = [...list].sort((a, b) => b.expectedLoss + b.debt - (a.expectedLoss + a.debt));
  const total = list.length, rows = list.slice((filter.page - 1) * filter.size, filter.page * filter.size);

  const churn = {
    atRisk: base.filter((x) => ["Kritik", "Yuqori", "O'rta"].includes(x.risk)).length,
    expectedLoss: sum(base.filter((x) => ["Kritik", "Yuqori", "O'rta"].includes(x.risk)).map((x) => x.expectedLoss)),
    recoverable: sum(base.filter((x) => x.segment === "At Risk").map((x) => x.avgMonthly * 12)),
    avgScore: safeDiv(sum(base.filter((x) => x.recency !== null).map((x) => x.riskScore)), base.filter((x) => x.recency !== null).length),
    zones: (["Kritik", "Yuqori", "O'rta", "Past", "Xavfsiz"] as Risk[]).map((z) => ({ label: z, value: base.filter((x) => x.risk === z).length, loss: sum(base.filter((x) => x.risk === z).map((x) => x.expectedLoss)) })),
    factors: [
      { label: "Uzoq vaqt buyurtma yo'q (45+ kun)", value: base.filter((x) => x.recency !== null && x.recency >= 45).length },
      { label: "Muddati o'tgan qarz", value: base.filter((x) => x.overdueDebt > 0).length },
      { label: "Chastota pasaygan (180 kunda ≤1)", value: base.filter((x) => x.frequency <= 1 && x.orders > 1).length },
      { label: "Kredit limiti tugagan", value: base.filter((x) => x.creditLimit > 0 && x.debt >= x.creditLimit).length },
    ],
  };

  return { cards, segments, rfm: { rows: rBuckets, cols: fBuckets, cells, cellMoney }, aging, agingTop, flow, clv, nba, churn, list: { rows, total, page: filter.page, size: filter.size } };
}
