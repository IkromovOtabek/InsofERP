import { db } from "@/lib/db";
import { tripKmMap } from "@/lib/trip-summary";
import { delayLevel, logisticsSettings, tripDelayMin } from "@/lib/logistics";

/**
 * Logistika hisobotlari va analitikasi (TZ 14) — davr bo'yicha bitta hisob.
 * Hisobotlar sahifasi jadval + Excel, Analitika sahifasi reyting va foizlar — ikkalasi shu yerdan.
 */

export type ReportRow = { trips: number; delivered: number; cancelled: number; m3: number; pieces: number; late: number; judged: number; durSum: number; durN: number; fuel: number; other: number; issues: number };
const empty = (): ReportRow => ({ trips: 0, delivered: 0, cancelled: 0, m3: 0, pieces: 0, late: 0, judged: 0, durSum: 0, durN: 0, fuel: 0, other: 0, issues: 0 });

export const avgMin = (r: ReportRow) => (r.durN ? Math.round(r.durSum / r.durN) : null);
export const onTimePct = (r: ReportRow) => (r.judged ? Math.round(((r.judged - r.late) / r.judged) * 100) : null);
export const cost = (r: ReportRow) => r.fuel + r.other;

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function logisticsReport(from: Date, to: Date) {
  const settings = await logisticsSettings();
  const [trips, fuel, other, vehicles] = await Promise.all([
    db.trip.findMany({
      where: { OR: [{ createdAt: { gte: from, lt: to } }, { deliveredAt: { gte: from, lt: to } }] },
      include: {
        order: { select: { deliveryDate: true, deliveryTime: true, deliveryAddress: true, siteId: true, customer: { select: { name: true } }, site: { select: { name: true } }, items: { select: { product: { select: { unit: true } } } } } },
        vehicle: { select: { plate: true, type: true } }, driver: { select: { fullName: true } }, issues: { select: { id: true } },
      },
    }),
    db.fuelLog.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true, liters: true, vehicleId: true, driverId: true } }),
    db.transportExpense.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true, vehicleId: true, driverId: true } }),
    db.vehicle.findMany({ where: { isActive: true }, select: { id: true, plate: true, type: true } }),
  ]);
  // Yurilgan km — zavod haydovchilari GPS izidan (pudratchi izi ECO'da, bu yerga kirmaydi).
  // Yopilgan reys — saqlangan yakundan (`Trip.distanceKm`), yakunsizi hisoblanib saqlanadi, ochig'i — keshdan
  const kmByTrip = await tripKmMap(trips.filter((t) => t.status !== "CANCELLED").map((t) => t.id));

  const total = empty();
  const byDay = new Map<string, ReportRow>();
  const byVehicle = new Map<string, ReportRow & { plate: string; type: string; busyMin: number; km: number; liters: number }>();
  const byDriver = new Map<string, ReportRow & { name: string; km: number }>();
  const bySite = new Map<string, ReportRow & { name: string; customer: string }>();

  const bump = (r: ReportRow, t: (typeof trips)[number]) => {
    const unit = t.order.items.every((i) => i.product.unit === "m3") ? "m3" : "piece";
    r.trips++;
    if (t.status === "CANCELLED") { r.cancelled++; return; }
    if (t.status === "DELIVERED" && t.deliveredAt && t.deliveredAt >= from && t.deliveredAt < to) {
      r.delivered++;
      if (unit === "m3") r.m3 += Number(t.qtyM3); else r.pieces += Number(t.qtyM3);
      const dl = tripDelayMin(t, t.order);
      if (dl != null) { r.judged++; if (delayLevel(dl, settings) !== "ok") r.late++; }
      if (t.loadedAt) { r.durSum += (t.deliveredAt.getTime() - t.loadedAt.getTime()) / 60000; r.durN++; }
    }
    r.issues += t.issues.length;
  };

  for (const t of trips) {
    bump(total, t);
    const k = dayKey(t.deliveredAt && t.deliveredAt >= from ? t.deliveredAt : t.createdAt);
    const d = byDay.get(k) ?? empty(); bump(d, t); byDay.set(k, d);
    const v = byVehicle.get(t.vehicleId) ?? { ...empty(), plate: t.vehicle.plate, type: t.vehicle.type, busyMin: 0, km: 0, liters: 0 };
    bump(v, t);
    if (t.loadedAt && t.status !== "CANCELLED") {
      const end = t.returnedAt ?? t.deliveredAt;
      if (end) v.busyMin += Math.max(0, (end.getTime() - t.loadedAt.getTime()) / 60000);
    }
    v.km += kmByTrip.get(t.id) ?? 0;
    byVehicle.set(t.vehicleId, v);
    const dr = byDriver.get(t.driverId) ?? { ...empty(), name: t.driver.fullName, km: 0 };
    bump(dr, t); dr.km += kmByTrip.get(t.id) ?? 0; byDriver.set(t.driverId, dr);
    const sk = t.order.siteId ?? `addr:${t.order.deliveryAddress}`;
    const st = bySite.get(sk) ?? { ...empty(), name: t.order.site?.name ?? t.order.deliveryAddress, customer: t.order.customer.name };
    bump(st, t); bySite.set(sk, st);
  }
  for (const v of vehicles) if (!byVehicle.has(v.id)) byVehicle.set(v.id, { ...empty(), plate: v.plate, type: v.type, busyMin: 0, km: 0, liters: 0 });
  for (const f of fuel) {
    total.fuel += Number(f.amount);
    const d = byDay.get(dayKey(f.date)) ?? empty(); d.fuel += Number(f.amount); byDay.set(dayKey(f.date), d);
    const v = byVehicle.get(f.vehicleId); if (v) { v.fuel += Number(f.amount); v.liters += Number(f.liters); }
    if (f.driverId) { const dr = byDriver.get(f.driverId); if (dr) dr.fuel += Number(f.amount); }
  }
  for (const e of other) {
    total.other += Number(e.amount);
    const d = byDay.get(dayKey(e.date)) ?? empty(); d.other += Number(e.amount); byDay.set(dayKey(e.date), d);
    if (e.vehicleId) { const v = byVehicle.get(e.vehicleId); if (v) v.other += Number(e.amount); }
    if (e.driverId) { const dr = byDriver.get(e.driverId); if (dr) dr.other += Number(e.amount); }
  }

  // Utilization: band vaqt / (ish kunlari × smena). Ish kunlari — davrdagi yakshanbadan boshqa kunlar.
  let workDays = 0;
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0 && d <= new Date()) workDays++;
  const shiftMin = Math.max(60, (settings.shiftEndHour - settings.shiftStartHour) * 60) * Math.max(1, workDays);

  return {
    settings, total, workDays,
    byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, r]) => ({ day, ...r })),
    byVehicle: [...byVehicle.entries()].map(([id, r]) => ({ id, ...r, utilization: Math.min(100, Math.round((r.busyMin / shiftMin) * 100)) })).sort((a, b) => b.m3 - a.m3),
    byDriver: [...byDriver.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => b.m3 + b.pieces - (a.m3 + a.pieces)),
    bySite: [...bySite.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => b.m3 + b.pieces - (a.m3 + a.pieces)),
  };
}
