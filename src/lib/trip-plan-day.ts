import { db } from "./db";
import { dayRange, logisticsSettings, parseDay, tripPlannedAt } from "./logistics";
import { concretePlan, piecePlan, refWeight, type DayFleet, type FleetVehicle } from "./trip-plan";

/**
 * Tanlangan kun uchun transport holati — zayavka formasidagi «Reys va transport hisobi» paneli shu yerdan oladi:
 *   · har mashinaning smena ichidagi band daqiqalari (shu kungi reyslar; bandlik dispetcher kalendari bilan bir xil:
 *     yuklashdan 45 daq oldin boshlanadi, qaytguncha / yetkazilgandan +40 daq / sukut 120 daq);
 *   · shu kungi boshqa zayavkalarning hali reys biriktirilmagan qismi — ular ham transport talab qiladi.
 */
const DEFAULT_TURN_MIN = 120;

export async function dayFleet(day: string, excludeOrderId?: string): Promise<DayFleet> {
  const d = parseDay(day);
  const { from, to } = dayRange(d);
  const ls = await logisticsSettings();
  const s0 = new Date(from); s0.setHours(ls.shiftStartHour, 0, 0, 0);
  const s1 = new Date(from); s1.setHours(ls.shiftEndHour, 0, 0, 0);
  const shiftMin = Math.max(60, (s1.getTime() - s0.getTime()) / 60000);

  const [vehicles, orders, company] = await Promise.all([
    db.vehicle.findMany({
      where: { isActive: true, type: { in: ["MIXER", "TRUCK", "PUMP"] } },
      orderBy: [{ type: "asc" }, { plate: "asc" }],
      include: {
        trips: {
          where: { status: { not: "CANCELLED" }, OR: [{ plannedAt: { gte: from, lt: to } }, { loadedAt: { gte: from, lt: to } }, { AND: [{ plannedAt: null }, { order: { deliveryDate: { gte: from, lt: to } } }] }] },
          select: { plannedAt: true, loadedAt: true, deliveredAt: true, returnedAt: true, orderId: true, order: { select: { deliveryDate: true, deliveryTime: true, customer: { select: { name: true } } } } },
        },
      },
    }),
    db.order.findMany({
      where: { kind: "SALE", needsDelivery: true, status: { notIn: ["CANCELLED", "DRAFT"] }, deliveryDate: { gte: from, lt: to }, ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) },
      select: {
        distanceKm: true, needsPump: true,
        items: { select: { qtyM3: true, product: { select: { code: true, name: true, unit: true } } } },
        trips: { where: { status: { not: "CANCELLED" } }, select: { qtyM3: true, vehicle: { select: { type: true } } } },
      },
    }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { dailyCapacityM3: true } }),
  ]);

  const list: FleetVehicle[] = vehicles.map((v) => {
    let busy = 0;
    const names = new Set<string>();
    for (const t of v.trips) {
      const planned = tripPlannedAt(t, t.order);
      const start = t.loadedAt ?? (planned ? new Date(planned.getTime() - 45 * 60000) : s0);
      const end = t.returnedAt ?? (t.deliveredAt ? new Date(t.deliveredAt.getTime() + 40 * 60000) : new Date(start.getTime() + DEFAULT_TURN_MIN * 60000));
      const a = Math.max(start.getTime(), s0.getTime()), b = Math.min(end.getTime(), s1.getTime());
      if (b > a) busy += (b - a) / 60000;
      if (t.orderId !== excludeOrderId) names.add(t.order.customer.name);
    }
    return {
      id: v.id, plate: v.plate, type: v.type, cap: v.capacityM3 != null ? Number(v.capacityM3) : null, unit: v.capacityUnit, status: v.status,
      busyMin: Math.min(shiftMin, Math.round(busy)), busyNote: names.size ? [...names].slice(0, 2).join(", ") : null,
    };
  });

  // Boshqa zayavkalar: reys biriktirilmagan qismi uchun kerak bo'ladigan mashina-daqiqa (o'sha hisob bilan)
  const other = { orders: 0, m3: 0, tons: 0, mixerMin: 0, truckMin: 0, pumps: 0 };
  const noFleet = { ...emptyFleet(shiftMin), vehicles: list.filter((v) => v.status !== "REPAIR") };
  for (const o of orders) {
    other.orders++;
    if (o.needsPump) other.pumps++;
    const km = o.distanceKm != null ? Number(o.distanceKm) : null;
    const m3 = o.items.filter((i) => i.product.unit === "m3").reduce((s, i) => s + Number(i.qtyM3), 0);
    other.m3 += m3;
    const m3Left = Math.max(0, m3 - o.trips.filter((t) => t.vehicle.type === "MIXER").reduce((s, t) => s + Number(t.qtyM3), 0));
    if (m3Left > 0) {
      const p = concretePlan({ m3: m3Left, km, pump: o.needsPump, fleet: noFleet });
      other.mixerMin += (p.ownTrips + p.hiredTrips) * p.days * p.cycle.total;
    }
    const pieces = o.items.filter((i) => i.product.unit !== "m3");
    if (pieces.length && !o.trips.some((t) => t.vehicle.type === "TRUCK")) {
      other.tons += pieces.reduce((s, i) => s + (refWeight(i.product.code, i.product.name)?.kg ?? 0) * Number(i.qtyM3), 0) / 1000;
      const p = piecePlan({ items: pieces.map((i) => ({ code: i.product.code, name: i.product.name, unit: i.product.unit, qty: Number(i.qtyM3) })), km, fleet: noFleet });
      other.truckMin += p.trips * p.cycleMin;
    }
  }
  other.m3 = Math.round(other.m3 * 10) / 10;
  other.tons = Math.round(other.tons * 10) / 10;

  return {
    date: day, shiftMin, vehicles: list, other,
    dailyCapacityM3: company?.dailyCapacityM3 != null ? Number(company.dailyCapacityM3) : null,
  };
}

function emptyFleet(shiftMin: number): DayFleet {
  return { date: "", shiftMin, vehicles: [], other: { orders: 0, m3: 0, tons: 0, mixerMin: 0, truckMin: 0, pumps: 0 }, dailyCapacityM3: null };
}
