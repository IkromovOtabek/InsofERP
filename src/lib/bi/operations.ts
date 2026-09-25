import { db } from "@/lib/db";
import { type Range, type Gran, sum, safeDiv, kpi, series, addDays, startOfDay, WEEKDAYS, mean } from "./core";

export async function operationsTab(r: Range, gran: Gran) {
  const today = startOfDay(new Date());
  const [batches, prevBatches, trips, prevTrips, vehicles, drivers, openOrders] = await Promise.all([
    db.productionBatch.findMany({ where: { date: { gte: r.from, lt: r.to } }, include: { product: { select: { code: true, name: true, unit: true } }, order: { select: { orderNo: true } } } }),
    db.productionBatch.findMany({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, select: { qtyM3: true } }),
    db.trip.findMany({ where: { createdAt: { gte: r.from, lt: r.to } }, include: { vehicle: true, driver: true, order: { select: { deliveryDate: true, customer: { select: { name: true } } } } } }),
    db.trip.findMany({ where: { createdAt: { gte: r.prevFrom, lt: r.prevTo } }, select: { qtyM3: true, status: true, loadedAt: true, deliveredAt: true } }),
    db.vehicle.findMany({ where: { isActive: true }, include: { trips: { where: { createdAt: { gte: addDays(today, -7) } }, select: { id: true } } } }),
    db.employee.findMany({ where: { isActive: true, trips: { some: {} } }, select: { id: true, fullName: true } }),
    db.order.findMany({ where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, include: { customer: true, items: true, batches: true, trips: { where: { status: { not: "CANCELLED" } } } }, orderBy: { deliveryDate: "asc" } }),
  ]);

  const produced = sum(batches.map((b) => Number(b.qtyM3))), prevProduced = sum(prevBatches.map((b) => Number(b.qtyM3)));
  const active = trips.filter((t) => t.status !== "CANCELLED"), prevActive = prevTrips.filter((t) => t.status !== "CANCELLED");
  const delivered = active.filter((t) => t.status === "DELIVERED"), prevDelivered = prevActive.filter((t) => t.status === "DELIVERED");
  const deliveredM3 = sum(delivered.map((t) => Number(t.qtyM3)));
  const durations = delivered.filter((t) => t.loadedAt && t.deliveredAt).map((t) => (t.deliveredAt!.getTime() - t.loadedAt!.getTime()) / 60000);
  const prevDurations = prevDelivered.filter((t) => t.loadedAt && t.deliveredAt).map((t) => (t.deliveredAt!.getTime() - t.loadedAt!.getTime()) / 60000);
  const late = delivered.filter((t) => t.deliveredAt && t.deliveredAt > addDays(startOfDay(t.order.deliveryDate), 1));
  const cancelled = trips.filter((t) => t.status === "CANCELLED");

  const kpis = {
    produced: kpi(produced, prevProduced), batches: kpi(batches.length, prevBatches.length),
    trips: kpi(active.length, prevActive.length), deliveredM3: kpi(deliveredM3, sum(prevDelivered.map((t) => Number(t.qtyM3)))),
    deliveryRate: kpi(safeDiv(delivered.length, active.length) * 100, safeDiv(prevDelivered.length, prevActive.length) * 100),
    avgMinutes: kpi(mean(durations), mean(prevDurations)),
    onTime: kpi(safeDiv(delivered.length - late.length, delivered.length) * 100, 0), cancelled: cancelled.length,
    perDay: produced / r.days,
  };

  const prodDyn = series(batches, r.from, r.to, gran, (b) => b.date, (b) => Number(b.qtyM3));
  const shipDyn = series(delivered, r.from, r.to, gran, (t) => t.deliveredAt ?? t.createdAt, (t) => Number(t.qtyM3));
  const byShift = [1, 2, 3].map((s) => ({ label: `${s}-smena`, value: sum(batches.filter((b) => b.shift === s).map((b) => Number(b.qtyM3))) })).filter((x) => x.value > 0);
  const byProduct = [...new Map(batches.map((b) => [b.productId, b.product])).entries()].map(([id, p]) => ({ id, label: `${p.code} — ${p.name}`, value: sum(batches.filter((b) => b.productId === id).map((b) => Number(b.qtyM3))), batches: batches.filter((b) => b.productId === id).length })).sort((a, b) => b.value - a.value);
  const noOrder = batches.filter((b) => !b.orderId);

  // Mikserlar
  const mixers = vehicles.filter((v) => v.type === "MIXER").map((v) => {
    const vt = active.filter((t) => t.vehicleId === v.id), vd = vt.filter((t) => t.status === "DELIVERED");
    const m3 = sum(vt.map((t) => Number(t.qtyM3))); const daysActive = new Set(vt.map((t) => t.createdAt.toDateString())).size;
    const cap = v.capacityM3 ? Number(v.capacityM3) : null;
    return { id: v.id, plate: v.plate, trips: vt.length, m3, delivered: vd.length, daysActive, tripsPerDay: safeDiv(vt.length, daysActive), fill: cap ? safeDiv(m3, vt.length * cap) * 100 : null, idle: v.trips.length === 0, avgMinutes: mean(vd.filter((t) => t.loadedAt && t.deliveredAt).map((t) => (t.deliveredAt!.getTime() - t.loadedAt!.getTime()) / 60000)) };
  }).sort((a, b) => b.m3 - a.m3);
  const others = vehicles.filter((v) => v.type !== "MIXER").map((v) => ({ id: v.id, plate: v.plate, type: v.type, trips: active.filter((t) => t.vehicleId === v.id).length, idle: v.trips.length === 0 }));

  // Haydovchi scorecard
  const driverRows = drivers.map((d) => {
    const dt = active.filter((t) => t.driverId === d.id), dd = dt.filter((t) => t.status === "DELIVERED");
    const m3 = sum(dt.map((t) => Number(t.qtyM3))); const rate = safeDiv(dd.length, dt.length) * 100;
    const mins = mean(dd.filter((t) => t.loadedAt && t.deliveredAt).map((t) => (t.deliveredAt!.getTime() - t.loadedAt!.getTime()) / 60000));
    const lateN = dd.filter((t) => t.deliveredAt && t.deliveredAt > addDays(startOfDay(t.order.deliveryDate), 1)).length;
    const cancelledN = trips.filter((t) => t.driverId === d.id && t.status === "CANCELLED").length;
    return { id: d.id, name: d.fullName, trips: dt.length, delivered: dd.length, m3, rate, avgMinutes: mins, late: lateN, cancelled: cancelledN, days: new Set(dt.map((t) => t.createdAt.toDateString())).size };
  }).filter((d) => d.trips > 0);
  const maxM3 = Math.max(1, ...driverRows.map((d) => d.m3)), minMins = Math.min(...driverRows.filter((d) => d.avgMinutes > 0).map((d) => d.avgMinutes), Infinity);
  const scored = driverRows.map((d) => {
    const score = Math.round(0.4 * (d.m3 / maxM3) * 100 + 0.35 * d.rate + 0.15 * (d.avgMinutes > 0 && Number.isFinite(minMins) ? Math.min(1, minMins / d.avgMinutes) * 100 : 50) + 0.1 * Math.max(0, 100 - (d.late + d.cancelled) * 20));
    const tier = score >= 80 ? "TOP" : score >= 60 ? "YAXSHI" : score >= 40 ? "O'RTA" : "PAST";
    return { ...d, score, tier };
  }).sort((a, b) => b.score - a.score);

  // Haydovchi × hafta kuni (reyslar soni) — so'nggi 7 kun
  const last7 = trips.filter((t) => t.createdAt >= addDays(today, -6) && t.status !== "CANCELLED");
  const top = scored.slice(0, 10);
  const heat = top.map((d) => WEEKDAYS.map((_, wd) => last7.filter((t) => t.driverId === d.id && t.createdAt.getDay() === wd).length));

  // Zayavkalar bajarilishi
  const orders = openOrders.map((o) => {
    const total = sum(o.items.map((i) => Number(i.qtyM3))), done = sum(o.batches.map((b) => Number(b.qtyM3))), shipped = sum(o.trips.map((t) => Number(t.qtyM3)));
    const overdue = o.deliveryDate < today && shipped < total;
    return { id: o.id, orderNo: o.orderNo, customer: o.customer.name, deliveryDate: o.deliveryDate, total, done, shipped, overdue, status: o.status };
  });
  const overdue = orders.filter((o) => o.overdue);
  const backlog = sum(orders.map((o) => Math.max(0, o.total - o.done)));

  // Ogohlantirishlar
  const signals: { level: "danger" | "warning" | "info"; title: string; text: string; href?: string }[] = [];
  if (overdue.length) signals.push({ level: "danger", title: `${overdue.length} ta zayavka muddati o'tgan`, text: overdue.slice(0, 3).map((o) => `${o.orderNo} (${o.customer})`).join(", "), href: "/orders" });
  const idleMixers = mixers.filter((m) => m.idle);
  if (idleMixers.length) signals.push({ level: "warning", title: `${idleMixers.length} ta mikser 7 kundan beri reys qilmagan`, text: idleMixers.map((m) => m.plate).join(", "), href: "/drivers" });
  if (late.length) signals.push({ level: "warning", title: `${late.length} ta reys kechikib yetkazilgan`, text: "Yetkazish sanasidan keyin topshirilgan", href: "/trips" });
  if (noOrder.length) signals.push({ level: "info", title: `${noOrder.length} ta zames zayavkasiz`, text: `${sum(noOrder.map((b) => Number(b.qtyM3))).toFixed(1)} m³ — omborga`, href: "/production" });
  const weakDrivers = scored.filter((d) => d.tier === "PAST");
  if (weakDrivers.length) signals.push({ level: "warning", title: `${weakDrivers.length} ta haydovchi past ko'rsatkichda`, text: weakDrivers.map((d) => d.name).join(", ") });

  return { kpis, prodDyn, shipDyn, byShift, byProduct, noOrderCount: noOrder.length, mixers, others, drivers: scored, heat: { rows: top.map((d) => d.name), cols: WEEKDAYS, cells: heat }, orders, overdue, backlog, signals, late: late.length };
}
