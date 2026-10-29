import { db } from "./db";
import { avtoReport, type AvtoRow } from "./fin-report/avto";
import { EXPENSE_KIND, FUEL_TYPE } from "./logistics";
import { tripPayKm } from "./trip-summary";
import { itemTons } from "./trip-plan";
import { fmtUnitTotals, type UnitRow } from "./unit";
import { fmtNum } from "./format";

/**
 * Transport faoliyati tanlangan davrda (Transport ro'yxati, transport kartasi, Mexanik bosh sahifasi):
 * necha reys, nechta zayavka, qancha yuk (m³ / dona / tonna), qayerga, kimga; xarajat, daromad, foyda.
 *
 * Pul ko'rsatkichlari — `avtoReport` (Tahlil → Avtotransport) bilan bitta manba: jami xarajat = yoqilg'i + ish haqi
 * + ta'mir/zapchast + boshqa transport xarajati; daromad — zayavka dastavka haqi reyslarga hajm ulushida.
 * Reys davrga yetkazilgan sanasi (bo'lmasa ochilgan sanasi) bo'yicha tushadi — xuddi `avtoReport` dagidek.
 * Reysda mahsulot ko'rsatilmaydi: miqdori zayavka qatorlariga ulush bo'yicha bo'linadi (`sklad-logistika.ts` dagidek).
 */

export type LoadSum = { m3: number; dona: number; t: number; tApprox: boolean; other: UnitRow[] };
const emptyLoad = (): LoadSum => ({ m3: 0, dona: 0, t: 0, tApprox: false, other: [] });

/** "12,5 m³ · 300 dona · ≈ 15,4 t" — bo'sh bo'lsa "—". */
export function fmtLoad(l: LoadSum): string {
  const p: string[] = [];
  if (l.m3 > 0.001) p.push(`${fmtNum(l.m3, 2)} m³`);
  if (l.dona > 0.001) p.push(`${fmtNum(l.dona, 0)} dona`);
  if (l.other.length) p.push(fmtUnitTotals(l.other));
  if (l.t > 0.001) p.push(`${l.tApprox ? "≈ " : ""}${fmtNum(l.t, 2)} t`);
  return p.length ? p.join(" · ") : "—";
}

function addLoad(to: LoadSum, l: LoadSum) {
  to.m3 += l.m3; to.dona += l.dona; to.t += l.t; to.tApprox ||= l.tApprox; to.other.push(...l.other);
}

type LoadItem = { qtyM3: unknown; product: { code: string; name: string; unit: string; weightKg: unknown } };

/** Bitta reys yuki: reys miqdori zayavka qatorlariga ulushida bo'linadi. */
function tripLoad(qty: number, items: LoadItem[]): LoadSum {
  const l = emptyLoad();
  const total = items.reduce((s, i) => s + Number(i.qtyM3), 0);
  if (!(total > 0)) return l;
  for (const i of items) {
    const share = (qty * Number(i.qtyM3)) / total;
    const u = i.product.unit;
    if (u === "m3") l.m3 += share;
    else if (u === "dona") l.dona += share;
    else if (u !== "t") l.other.push({ unit: u, qty: share });
    const w = itemTons(i.product, share);
    if (w) { l.t += w.t; l.tApprox ||= w.approx; }
  }
  return l;
}

const tripWhere = (from: Date, to: Date, vehicleId?: string) => ({
  status: { not: "CANCELLED" as const }, ...(vehicleId ? { vehicleId } : {}),
  OR: [{ deliveredAt: { gte: from, lt: to } }, { deliveredAt: null, createdAt: { gte: from, lt: to } }],
});
const orderItems = { select: { qtyM3: true, product: { select: { code: true, name: true, unit: true, weightKg: true } } } } as const;

// ───────────────────────── Hamma transport (ro'yxat) ─────────────────────────

export type FleetPeriodRow = {
  trips: number; orders: number; load: LoadSum; days: number;
  km: number; total: number; revenue: number; profit: number;
};

/** Har transport bo'yicha davr yig'indisi (vehicleId → qator). Harakati yo'q transport — Map'da yo'q yoki nollar bilan. */
export async function fleetPeriod(from: Date, to: Date): Promise<Map<string, FleetPeriodRow>> {
  const [avto, trips] = await Promise.all([
    avtoReport(from, to),
    db.trip.findMany({ where: tripWhere(from, to), select: { vehicleId: true, orderId: true, qtyM3: true, deliveredAt: true, createdAt: true, order: { select: { items: orderItems } } } }),
  ]);
  const out = new Map<string, FleetPeriodRow & { _orders: Set<string>; _days: Set<string> }>();
  const row = (id: string) => {
    let r = out.get(id);
    if (!r) { r = { trips: 0, orders: 0, load: emptyLoad(), days: 0, km: 0, total: 0, revenue: 0, profit: 0, _orders: new Set(), _days: new Set() }; out.set(id, r); }
    return r;
  };
  for (const t of trips) {
    const r = row(t.vehicleId);
    r.trips++; r._orders.add(t.orderId); r._days.add(dayKey(t.deliveredAt ?? t.createdAt));
    addLoad(r.load, tripLoad(Number(t.qtyM3), t.order.items));
  }
  for (const a of avto.rows) {
    const r = row(a.id);
    r.km = a.km; r.total = a.total; r.revenue = a.revenue; r.profit = a.profit;
  }
  for (const r of out.values()) { r.orders = r._orders.size; r.days = r._days.size; }
  return out;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// ───────────────────────── Bitta transport (karta) ─────────────────────────

export type VehicleTripRow = {
  id: string; noteNo: string; date: Date; status: string; orderId: string; orderNo: string;
  customer: string; place: string; driver: string; qty: number; load: LoadSum; km: number; revenue: number;
};
export type VehiclePlace = { key: string; name: string; address: string; siteId: string | null; customer: string; trips: number; orders: number; load: LoadSum; km: number; revenue: number };
export type VehicleCustomer = { id: string; name: string; trips: number; orders: number; load: LoadSum; revenue: number };
export type VehicleLedger = { id: string; date: Date; kind: "fuel" | "expense" | "service"; label: string; note: string | null; amount: number; counted: boolean };
export type VehicleReport = {
  row: AvtoRow;
  trips: VehicleTripRow[]; orders: number; days: number; load: LoadSum;
  places: VehiclePlace[]; customers: VehicleCustomer[]; drivers: { name: string; trips: number }[];
  /** Xarajat turlari bo'yicha (jami xarajatga kiradiganlar). */
  costs: { label: string; count: number; sum: number }[];
  /** Hamma yozuv sanasi bo'yicha: zapravka, transport xarajati, texnik xizmat narxi (oxirgisi — ma'lumot uchun, jamiga kirmaydi). */
  ledger: VehicleLedger[];
  service: { count: number; sum: number };
};

export async function vehicleReport(vehicleId: string, from: Date, to: Date): Promise<VehicleReport> {
  const inRange = { gte: from, lt: to };
  const [avto, trips, fuel, expenses, services] = await Promise.all([
    avtoReport(from, to, { vehicleId }),
    db.trip.findMany({
      where: tripWhere(from, to, vehicleId), orderBy: [{ createdAt: "desc" }],
      select: {
        id: true, deliveryNoteNo: true, status: true, orderId: true, qtyM3: true, deliveredAt: true, createdAt: true, distanceKm: true, summaryAt: true,
        driver: { select: { fullName: true } },
        order: { select: { orderNo: true, deliveryAddress: true, distanceKm: true, deliveryFee: true, siteId: true, site: { select: { name: true } }, customer: { select: { id: true, name: true } }, items: orderItems } },
      },
    }),
    db.fuelLog.findMany({ where: { vehicleId, cancelledAt: null, date: inRange }, orderBy: { date: "desc" }, select: { id: true, date: true, fuelType: true, liters: true, amount: true, station: true, driver: { select: { fullName: true } } } }),
    db.transportExpense.findMany({ where: { vehicleId, cancelledAt: null, date: inRange }, orderBy: { date: "desc" }, select: { id: true, date: true, kind: true, amount: true, note: true } }),
    db.vehicleService.findMany({ where: { vehicleId, cancelledAt: null, date: inRange }, orderBy: { date: "desc" }, select: { id: true, date: true, kind: true, cost: true, note: true } }),
  ]);
  const row = avto.rows[0] ?? avto.total;

  // Daromad reysga: zayavka dastavka haqi — shu zayavkaning barcha reyslariga hajm ulushida (avtoReport bilan bir xil)
  const orderIds = [...new Set(trips.map((t) => t.orderId))];
  const orderQty = new Map((orderIds.length
    ? await db.trip.groupBy({ by: ["orderId"], where: { orderId: { in: orderIds }, status: { not: "CANCELLED" } }, _sum: { qtyM3: true }, _count: true })
    : []).map((g) => [g.orderId, { qty: Number(g._sum.qtyM3 ?? 0), n: g._count }]));
  const kmOf = await tripPayKm(trips);

  const tripRows: VehicleTripRow[] = trips.map((t) => {
    const qty = Number(t.qtyM3), fee = Number(t.order.deliveryFee ?? 0), oq = orderQty.get(t.orderId);
    return {
      id: t.id, noteNo: t.deliveryNoteNo, date: t.deliveredAt ?? t.createdAt, status: t.status, orderId: t.orderId, orderNo: t.order.orderNo,
      customer: t.order.customer.name, place: t.order.site?.name || t.order.deliveryAddress, driver: t.driver.fullName,
      qty, load: tripLoad(qty, t.order.items), km: kmOf.get(t.id) ?? 0,
      revenue: fee > 0 && oq ? (oq.qty > 0 ? (fee * qty) / oq.qty : fee / oq.n) : 0,
    };
  });
  // Ko'rsatiladigan sana (yetkazilgan, bo'lmasa ochilgan) bo'yicha — yangisi tepada
  const order = tripRows.map((r, i) => ({ r, t: trips[i]! })).sort((a, b) => b.r.date.getTime() - a.r.date.getTime());
  tripRows.splice(0, tripRows.length, ...order.map((x) => x.r));
  trips.splice(0, trips.length, ...order.map((x) => x.t));

  const load = emptyLoad();
  const places = new Map<string, VehiclePlace & { _o: Set<string> }>();
  const customers = new Map<string, VehicleCustomer & { _o: Set<string> }>();
  const drivers = new Map<string, number>();
  const days = new Set<string>();
  for (const [i, r] of tripRows.entries()) {
    const t = trips[i]!;
    addLoad(load, r.load);
    days.add(dayKey(r.date));
    drivers.set(r.driver, (drivers.get(r.driver) ?? 0) + 1);
    const key = t.order.siteId ?? `a:${t.order.deliveryAddress.trim().toLowerCase()}`;
    let p = places.get(key);
    if (!p) { p = { key, name: t.order.site?.name || t.order.deliveryAddress, address: t.order.deliveryAddress, siteId: t.order.siteId, customer: r.customer, trips: 0, orders: 0, load: emptyLoad(), km: 0, revenue: 0, _o: new Set() }; places.set(key, p); }
    p.trips++; p._o.add(r.orderId); addLoad(p.load, r.load); p.km += r.km; p.revenue += r.revenue;
    const cid = t.order.customer.id;
    let c = customers.get(cid);
    if (!c) { c = { id: cid, name: r.customer, trips: 0, orders: 0, load: emptyLoad(), revenue: 0, _o: new Set() }; customers.set(cid, c); }
    c.trips++; c._o.add(r.orderId); addLoad(c.load, r.load); c.revenue += r.revenue;
  }
  const done = <T extends { _o: Set<string>; orders: number; trips: number }>(m: Map<string, T>) =>
    [...m.values()].map(({ _o, ...x }) => ({ ...x, orders: _o.size })).sort((a, b) => b.trips - a.trips);

  // Xarajat turlari: yoqilg'i (turi bo'yicha) + transport xarajatlari (turi bo'yicha)
  const costMap = new Map<string, { label: string; count: number; sum: number }>();
  const cost = (label: string, a: number) => { const c = costMap.get(label) ?? { label, count: 0, sum: 0 }; c.count++; c.sum += a; costMap.set(label, c); };
  const ledger: VehicleLedger[] = [];
  for (const f of fuel) {
    const label = `Yoqilg'i — ${FUEL_TYPE[f.fuelType]}`;
    cost(label, Number(f.amount));
    ledger.push({ id: f.id, date: f.date, kind: "fuel", label, note: [`${fmtNum(Number(f.liters), 1)} ${f.fuelType === "METHANE" ? "m³" : "l"}`, f.station, f.driver?.fullName].filter(Boolean).join(" · "), amount: Number(f.amount), counted: true });
  }
  for (const e of expenses) {
    cost(EXPENSE_KIND[e.kind], Number(e.amount));
    ledger.push({ id: e.id, date: e.date, kind: "expense", label: EXPENSE_KIND[e.kind], note: e.note, amount: Number(e.amount), counted: true });
  }
  // Reys haqi (Trip.payAmount) avtoReport'da ish haqiga qo'shiladi — alohida qator bo'lib ko'rinsin
  const tripPay = row.pay - expenses.filter((e) => e.kind === "DRIVER_PAY").reduce((s, e) => s + Number(e.amount), 0);
  if (tripPay > 0.5) costMap.set("Reys haqi (tabel)", { label: "Reys haqi (tabel)", count: trips.length, sum: tripPay });
  let serviceSum = 0;
  for (const x of services) {
    const a = x.cost != null ? Number(x.cost) : 0;
    serviceSum += a;
    ledger.push({ id: x.id, date: x.date, kind: "service", label: `Texnik xizmat — ${x.kind}`, note: x.note, amount: a, counted: false });
  }
  ledger.sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    row, trips: tripRows, orders: orderIds.length, days: days.size, load,
    places: done(places), customers: done(customers),
    drivers: [...drivers].map(([name, n]) => ({ name, trips: n })).sort((a, b) => b.trips - a.trips),
    costs: [...costMap.values()].sort((a, b) => b.sum - a.sum),
    ledger, service: { count: services.length, sum: serviceSum },
  };
}
