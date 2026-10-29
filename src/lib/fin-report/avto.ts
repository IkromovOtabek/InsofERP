import { db } from "@/lib/db";
import { VEHICLE_TYPE } from "@/lib/logistics";
import { tripFuelNorm } from "@/lib/driver-trip-pay";
import { tripPayKm } from "@/lib/trip-summary";

/**
 * «Insof 2026» → «AVTOTRANSPORT TAHLILI — har bir mashina va kunlik solishtirish» (Tahlil → Mexanik).
 *
 * Manbalar (oy bo'yicha, bekor qilinganlarsiz):
 *  - reys, probeg (zavod → obyekt → zavod, GPS yoki zayavka masofasi — haydovchi tabeli bilan bir xil), baraban soati — `Trip`;
 *  - yoqilg'i normasi — transport kartasidagi norma × km + soat (dizel litr, metan m³); berilgan — `FuelLog`;
 *  - ish haqi — reys haqi (`Trip.payAmount`) + «Haydovchi haqi» transport xarajati; remont / zapchast / boshqa — `TransportExpense`;
 *  - daromad — zayavka dastavka haqi reyslarga hajm ulushida bo'linadi;
 *  - nazorat: kassadan chiqqan (izohda shu mashina raqami yozilgan chiqim) va mexanik so'rovlari (to'langan) farqi.
 */

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const r1 = (v: number) => Math.round(v * 10) / 10 || 0;
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");

export type AvtoRow = {
  id: string; plate: string; type: string; model: string | null;
  trips: number; km: number; hours: number;
  dtNorm: number | null; dtGiven: number; gasNorm: number | null; gasGiven: number;
  fuelSum: number; fuelNormSum: number | null;
  pay: number; repair: number; other: number; total: number;
  revenue: number; profit: number; perKm: number | null;
  cash: number; mechanic: number; cashDiff: number; supplyTrips: number;
};
export type AvtoDay = {
  date: Date; trips: number; km: number; dtGiven: number; gasGiven: number; fuelSum: number;
  pay: number; repair: number; mechanic: number; cash: number; cashDiff: number; revenue: number; profit: number;
};
/** `to` — oraliq oxiri (kirmaydi). */
export type AvtoReport = { from: Date; to: Date; rows: AvtoRow[]; total: AvtoRow; days: AvtoDay[] };

const REPAIR_KINDS = new Set(["REPAIR", "PARTS"]);

/** Ixtiyoriy kunlar oralig'i: `from` (kun boshi) dan `to` gacha (kirmaydi). `vehicleId` — faqat bitta mashina (transport kartasi). */
export async function avtoReport(from: Date, to: Date, opts: { vehicleId?: string } = {}): Promise<AvtoReport> {
  const inMonth = { gte: from, lt: to };
  const vid = opts.vehicleId;

  const [vehicles, trips, fuel, expenses, mech, cashTx, receipts] = await Promise.all([
    db.vehicle.findMany({ where: vid ? { id: vid } : {}, select: { id: true, plate: true, type: true, brand: true, model: true, isActive: true, fuelType: true, fuelNormL100: true, idleNormPerHour: true, gasNormPer100: true, gasIdlePerHour: true } }),
    db.trip.findMany({
      where: { status: { not: "CANCELLED" }, ...(vid ? { vehicleId: vid } : {}), OR: [{ deliveredAt: inMonth }, { deliveredAt: null, createdAt: inMonth }] },
      select: { id: true, vehicleId: true, orderId: true, qtyM3: true, workHours: true, payAmount: true, deliveredAt: true, createdAt: true, distanceKm: true, summaryAt: true, order: { select: { distanceKm: true, deliveryFee: true } } },
    }),
    db.fuelLog.findMany({ where: { cancelledAt: null, date: inMonth, ...(vid ? { vehicleId: vid } : {}) }, select: { vehicleId: true, date: true, fuelType: true, liters: true, amount: true } }),
    db.transportExpense.findMany({ where: { cancelledAt: null, date: inMonth, vehicleId: vid ?? { not: null } }, select: { vehicleId: true, date: true, kind: true, amount: true } }),
    db.mechanicRequest.findMany({ where: { status: "PAID", paidAt: inMonth, vehicleId: vid ?? { not: null } }, select: { vehicleId: true, paidAt: true, amount: true } }),
    db.cashTransaction.findMany({ where: { cancelledAt: null, type: "EXPENSE", date: inMonth }, select: { date: true, amount: true, note: true, counterparty: true, subCategory: true } }),
    db.goodsReceipt.findMany({ where: { cancelledAt: null, date: inMonth, carrier: { not: null } }, select: { carrier: true } }),
  ]);

  // Dastavka haqi zayavkaning barcha reyslariga hajm ulushida
  const orderIds = [...new Set(trips.map((t) => t.orderId))];
  const orderQty = new Map((orderIds.length
    ? await db.trip.groupBy({ by: ["orderId"], where: { orderId: { in: orderIds }, status: { not: "CANCELLED" } }, _sum: { qtyM3: true }, _count: true })
    : []).map((g) => [g.orderId, { qty: Number(g._sum.qtyM3 ?? 0), n: g._count }]));
  const kmOf = await tripPayKm(trips);

  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const rows = new Map<string, AvtoRow>();
  const row = (id: string): AvtoRow => {
    let r = rows.get(id);
    if (!r) {
      const v = vById.get(id)!;
      r = {
        id, plate: v.plate, type: VEHICLE_TYPE[v.type] ?? v.type, model: [v.brand, v.model].filter(Boolean).join(" ") || null,
        trips: 0, km: 0, hours: 0, dtNorm: null, dtGiven: 0, gasNorm: null, gasGiven: 0, fuelSum: 0, fuelNormSum: null,
        pay: 0, repair: 0, other: 0, total: 0, revenue: 0, profit: 0, perKm: null, cash: 0, mechanic: 0, cashDiff: 0, supplyTrips: 0,
      };
      rows.set(id, r);
    }
    return r;
  };
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const days = new Map<string, AvtoDay>();
  const day = (d: Date): AvtoDay => {
    const k = dayKey(d);
    let x = days.get(k);
    if (!x) { x = { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), trips: 0, km: 0, dtGiven: 0, gasGiven: 0, fuelSum: 0, pay: 0, repair: 0, mechanic: 0, cash: 0, cashDiff: 0, revenue: 0, profit: 0 }; days.set(k, x); }
    return x;
  };
  const addNorm = (cur: number | null, v: number | null) => (v == null ? cur : (cur ?? 0) + v);

  for (const t of trips) {
    const v = vById.get(t.vehicleId); if (!v) continue;
    const r = row(v.id), d = day(t.deliveredAt ?? t.createdAt);
    const km = kmOf.get(t.id) ?? 0, hours = t.workHours != null ? Number(t.workHours) : 0;
    const oq = orderQty.get(t.orderId);
    const fee = Number(t.order.deliveryFee ?? 0);
    const revenue = fee > 0 && oq ? (oq.qty > 0 ? (fee * Number(t.qtyM3)) / oq.qty : fee / oq.n) : 0;
    const pay = Number(t.payAmount ?? 0);
    r.trips++; r.km += km; r.hours += hours; r.revenue += revenue; r.pay += pay;
    d.trips++; d.km += km; d.revenue += revenue; d.pay += pay;
    // Norma: metan transportida asosiy norma m³; «Dizel + metan» da dizel + alohida gaz normasi
    const main = tripFuelNorm(v, km, hours);
    if (v.fuelType === "METHANE") r.gasNorm = addNorm(r.gasNorm, main);
    else r.dtNorm = addNorm(r.dtNorm, main);
    if (v.fuelType === "DIESEL_METHANE") r.gasNorm = addNorm(r.gasNorm, tripFuelNorm({ fuelNormL100: v.gasNormPer100, idleNormPerHour: v.gasIdlePerHour }, km, hours));
  }

  // O'rtacha narx (oy bo'yicha, yoqilg'i turi) — normani so'mga aylantirish uchun
  const price = new Map<string, { l: number; s: number }>();
  for (const f of fuel) {
    const gas = f.fuelType === "METHANE" || f.fuelType === "PROPANE";
    const r = vById.has(f.vehicleId) ? row(f.vehicleId) : null, d = day(f.date);
    const l = Number(f.liters), s = Number(f.amount);
    if (r) { if (gas) r.gasGiven += l; else r.dtGiven += l; r.fuelSum += s; }
    if (gas) d.gasGiven += l; else d.dtGiven += l;
    d.fuelSum += s;
    const k = gas ? "gas" : "dt", p = price.get(k) ?? { l: 0, s: 0 }; p.l += l; p.s += s; price.set(k, p);
  }
  const avg = (k: string) => { const p = price.get(k); return p && p.l > 0 ? p.s / p.l : null; };
  const dtPrice = avg("dt"), gasPrice = avg("gas");

  for (const e of expenses) {
    const r = row(e.vehicleId!), d = day(e.date), a = Number(e.amount);
    if (e.kind === "DRIVER_PAY") { r.pay += a; d.pay += a; }
    else if (REPAIR_KINDS.has(e.kind)) { r.repair += a; d.repair += a; }
    else r.other += a;
  }
  for (const m of mech) { const r = row(m.vehicleId!), a = Number(m.amount); r.mechanic += a; day(m.paidAt!).mechanic += a; }

  // Kassa: izohida (yoki «kimga» / sub manbada) mashina raqami yozilgan chiqimlar
  const plates = vehicles.map((v) => ({ id: v.id, key: norm(v.plate) })).filter((p) => p.key.length >= 5);
  for (const t of cashTx) {
    const text = norm(`${t.note ?? ""} ${t.counterparty ?? ""} ${t.subCategory ?? ""}`);
    if (!text) continue;
    const hit = plates.find((p) => text.includes(p.key));
    if (!hit) continue;
    const a = Number(t.amount);
    row(hit.id).cash += a; day(t.date).cash += a;
  }
  for (const g of receipts) {
    const text = norm(g.carrier);
    const hit = plates.find((p) => text.includes(p.key));
    if (hit) row(hit.id).supplyTrips++;
  }

  const finish = (r: AvtoRow) => {
    r.km = r1(r.km); r.hours = r1(r.hours);
    r.dtNorm = r.dtNorm == null ? null : r1(r.dtNorm); r.gasNorm = r.gasNorm == null ? null : r1(r.gasNorm);
    r.dtGiven = r1(r.dtGiven); r.gasGiven = r1(r.gasGiven);
    const parts = [r.dtNorm != null && dtPrice != null ? r.dtNorm * dtPrice : null, r.gasNorm != null && gasPrice != null ? r.gasNorm * gasPrice : null].filter((x): x is number => x != null);
    r.fuelNormSum = parts.length ? r2(parts.reduce((a, b) => a + b, 0)) : null;
    r.fuelSum = r2(r.fuelSum); r.pay = r2(r.pay); r.repair = r2(r.repair); r.other = r2(r.other); r.revenue = r2(r.revenue);
    r.total = r2(r.fuelSum + r.pay + r.repair + r.other);
    r.profit = r2(r.revenue - r.total);
    r.perKm = r.km > 0 ? r2(r.total / r.km) : null;
    r.cash = r2(r.cash); r.mechanic = r2(r.mechanic); r.cashDiff = r2(r.cash - r.mechanic);
    return r;
  };

  // Faol mashinalar harakatsiz bo'lsa ham ro'yxatda turadi (jadvaldagidek)
  for (const v of vehicles) if (v.isActive) row(v.id);
  const list = [...rows.values()].map(finish).sort((a, b) => b.trips - a.trips || a.plate.localeCompare(b.plate));

  const sum = (f: (r: AvtoRow) => number) => list.reduce((s, r) => s + f(r), 0);
  const sumN = (f: (r: AvtoRow) => number | null) => (list.some((r) => f(r) != null) ? sum((r) => f(r) ?? 0) : null);
  const total = finish({
    id: "total", plate: "JAMI", type: "", model: null,
    trips: sum((r) => r.trips), km: sum((r) => r.km), hours: sum((r) => r.hours),
    dtNorm: sumN((r) => r.dtNorm), dtGiven: sum((r) => r.dtGiven), gasNorm: sumN((r) => r.gasNorm), gasGiven: sum((r) => r.gasGiven),
    fuelSum: sum((r) => r.fuelSum), fuelNormSum: null, pay: sum((r) => r.pay), repair: sum((r) => r.repair), other: sum((r) => r.other),
    total: 0, revenue: sum((r) => r.revenue), profit: 0, perKm: null, cash: sum((r) => r.cash), mechanic: sum((r) => r.mechanic), cashDiff: 0, supplyTrips: sum((r) => r.supplyTrips),
  });

  // Kunlar: oraliq boshidan bugungacha (yoki oraliq oxirigacha), har kun alohida qator
  const last = new Date(Math.min(Date.now(), to.getTime() - 1));
  const dayList: AvtoDay[] = [];
  for (let d = new Date(from); d <= last; d.setDate(d.getDate() + 1)) {
    const x = day(d);
    // Kun foydasi: daromad − (yoqilg'i + ish haqi + remont); boshqa xarajatlar kun bo'yicha ajratilmaydi
    dayList.push({ ...x, km: r1(x.km), dtGiven: r1(x.dtGiven), gasGiven: r1(x.gasGiven), fuelSum: r2(x.fuelSum), pay: r2(x.pay), repair: r2(x.repair), mechanic: r2(x.mechanic), cash: r2(x.cash), cashDiff: r2(x.cash - x.mechanic), revenue: r2(x.revenue), profit: r2(x.revenue - x.fuelSum - x.pay - x.repair) });
  }
  return { from, to, rows: list, total, days: dayList };
}
