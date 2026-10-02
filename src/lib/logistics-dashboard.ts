import { db } from "@/lib/db";
import { haversineMeters } from "@/lib/geo";
import { liveTrips } from "@/lib/live";
import { transportCosts } from "@/lib/logistics-costs";
import {
  ACTIVE_TRIP, dayRange, delayLevel, DRUM_MAX_MIN, expiryLevel, isConcreteTrip, ISSUE_KIND, logisticsSettings, minutesLabel, orderLogistics, tripDelayMin, tripPhase,
  tripPlannedAt, vehicleLive, type Level, type LogisticsSettings, type OrderLogi, type TripPhase, type VehicleLive,
} from "@/lib/logistics";

/**
 * Logistika bosh sahifasi (TZ 3-bo'lim) — barcha raqam shu bitta funksiyadan.
 * UI hech narsani o'zi hisoblamaydi: yangi ko'rsatkich kerak bo'lsa shu yerga qo'shiladi
 * (egasi dashbordidagi `ownerDashboard()` qoidasi bilan bir xil).
 */

export type LiveFix = { lat: number; lng: number; at: Date; etaMin: number | null; remainingKm: number | null };

export type DashTrip = {
  id: string; noteNo: string; status: string; phase: TripPhase;
  orderId: string; orderNo: string; customerId: string; customer: string; address: string;
  plate: string; vehicleId: string; driver: string; driverId: string; driverPhone: string | null;
  qty: number; unit: string;
  plannedAt: Date | null; loadedAt: Date | null; departedAt: Date | null; arrivedAt: Date | null; deliveredAt: Date | null;
  delayMin: number | null; level: Level; fix: LiveFix | null; openIssues: number;
  /** Beton (m³) reysi — mikserda, baraban vaqti va qotish xavfi faqat shunga tegishli */
  concrete: boolean;
  /** Yuklangandan beri daqiqa (yetkazilmagan beton reysi uchun), aks holda null */
  drumMin: number | null;
};

export type DashOrder = OrderLogi & {
  id: string; orderNo: string; customerId: string; customer: string; address: string; needsPump: boolean; isUrgent: boolean;
  unit: string; deliveryTime: string | null; trips: DashTrip[];
};

export type DashVehicle = {
  id: string; plate: string; type: string; capacity: number | null; live: VehicleLive; statusNote: string | null;
  driver: string | null; trip: DashTrip | null; todayTrips: number; todayQty: number; busyMin: number;
  docs: Level | null;
};

export type DashAlert = { level: Level; title: string; text: string; href: string };

export type DashDriver = { id: string; name: string; trips: number; qty: number; late: number; issues: number; avgMin: number | null; active: boolean };

export type LogisticsDashboard = {
  day: Date; isToday: boolean; settings: LogisticsSettings;
  kpi: {
    trips: number; onRoad: number; done: number; closed: number; waitingOrders: number; waitingQty: number;
    late: number; freeVehicles: number; totalVehicles: number; concreteM3: number; pieceQty: number;
    cost: number; fuelCost: number; avgDeliveryMin: number | null; onTimePct: number | null; planM3: number;
  };
  orders: DashOrder[];
  trips: DashTrip[];
  vehicles: DashVehicle[];
  drivers: DashDriver[];
  alerts: DashAlert[];
  issues: { id: string; tripId: string; noteNo: string; kind: string; note: string | null; at: Date; driver: string; plate: string }[];
  week: { day: Date; m3: number; trips: number; onTime: number | null }[];
  pumps: { orderId: string; orderNo: string; customer: string; time: string | null }[];
  gpsError: string | null;
};

const mins = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

/** Yo'ldagi mashinalarning oxirgi nuqtasi (ERP + ECO) va ETA. */
async function liveFixes(s: LogisticsSettings): Promise<{ byRef: Map<string, LiveFix>; error: string | null }> {
  const { trips, error } = await liveTrips({ userId: "", role: "DIRECTOR" });
  const byRef = new Map<string, LiveFix>();
  for (const t of trips) {
    if (!t.position) continue;
    const p = t.position;
    // ETA: ECO bersa o'shani, bo'lmasa to'g'ri chiziq × 1,3 (yo'l egriligi) / o'rtacha tezlik
    let remainingKm: number | null = null, etaMin = p.etaMin ?? null;
    if (t.destination) {
      remainingKm = (haversineMeters(p.lat, p.lng, t.destination.lat, t.destination.lng) * 1.3) / 1000;
      if (etaMin == null) etaMin = Math.round((remainingKm / s.avgSpeedKmh) * 60);
    }
    byRef.set(t.ref, { lat: p.lat, lng: p.lng, at: new Date(p.at), etaMin, remainingKm });
  }
  return { byRef, error };
}

export async function logisticsDashboard(dayInput?: Date): Promise<LogisticsDashboard> {
  const now = new Date();
  const { from, to } = dayRange(dayInput ?? now);
  const isToday = now >= from && now < to;
  const settings = await logisticsSettings();
  const weekFrom = new Date(from); weekFrom.setDate(weekFrom.getDate() - 13);

  const tripInclude = {
    order: { include: { customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } },
    vehicle: { select: { plate: true, type: true } }, driver: { select: { fullName: true, phone: true } },
    issues: { select: { id: true, kind: true, note: true, createdAt: true, resolvedAt: true } },
  } as const;

  const [orders, trips, vehicles, costs, weekTrips, live] = await Promise.all([
    db.order.findMany({
      // Kun rejasi + oldingi kunlardan qolib ketgan ochiq zayavkalar (faqat bugungi ko'rinishda)
      where: {
        kind: "SALE", needsDelivery: true, status: { notIn: ["CANCELLED", "DRAFT"] },
        OR: [
          { deliveryDate: { gte: from, lt: to } },
          ...(isToday ? [{ deliveryDate: { lt: from }, status: { in: ["CONFIRMED" as const, "IN_PRODUCTION" as const] } }] : []),
        ],
      },
      include: {
        customer: { select: { name: true } },
        items: { select: { qtyM3: true, product: { select: { unit: true } } } },
        trips: { include: tripInclude },
      },
      orderBy: [{ deliveryDate: "asc" }, { deliveryTime: "asc" }],
    }),
    db.trip.findMany({
      where: {
        status: { not: "CANCELLED" },
        OR: [
          { order: { deliveryDate: { gte: from, lt: to } } },
          { createdAt: { gte: from, lt: to } },
          { deliveredAt: { gte: from, lt: to } },
          ...(isToday ? [{ status: { in: ACTIVE_TRIP } }] : []),
        ],
      },
      include: tripInclude,
      orderBy: { createdAt: "asc" },
    }),
    db.vehicle.findMany({
      orderBy: [{ isActive: "desc" }, { type: "asc" }, { plate: "asc" }],
      include: { drivers: { where: { isActive: true }, select: { fullName: true } } },
    }),
    transportCosts(from, to),
    db.trip.findMany({
      where: { status: "DELIVERED", deliveredAt: { gte: weekFrom, lt: to } },
      select: { deliveredAt: true, qtyM3: true, plannedAt: true, status: true, order: { select: { deliveryDate: true, deliveryTime: true, items: { select: { product: { select: { unit: true } } } } } } },
    }),
    isToday ? liveFixes(settings) : Promise.resolve({ byRef: new Map<string, LiveFix>(), error: null }),
  ]);

  // ── Reyslar ──
  type RawTrip = (typeof trips)[number];
  const unitOf = (items: { product: { unit: string } }[]) => (items.every((i) => i.product.unit === "m3") ? "m3" : items[0]?.product.unit ?? "m3");
  const toDash = (t: RawTrip): DashTrip => {
    const fix = live.byRef.get(t.deliveryNoteNo) ?? null;
    const delay = tripDelayMin(t, t.order, now, t.status === "ON_ROAD" && !t.arrivedAt ? fix?.etaMin : null);
    return {
      id: t.id, noteNo: t.deliveryNoteNo, status: t.status, phase: tripPhase(t),
      orderId: t.orderId, orderNo: t.order.orderNo, customerId: t.order.customerId, customer: t.order.customer.name, address: t.order.deliveryAddress,
      plate: t.vehicle.plate, vehicleId: t.vehicleId, driver: t.driver.fullName, driverId: t.driverId, driverPhone: t.driver.phone,
      qty: Number(t.qtyM3), unit: unitOf(t.order.items),
      plannedAt: tripPlannedAt(t, t.order), loadedAt: t.loadedAt, departedAt: t.departedAt, arrivedAt: t.arrivedAt, deliveredAt: t.deliveredAt,
      delayMin: delay, level: delayLevel(delay, settings), fix, openIssues: t.issues.filter((i) => !i.resolvedAt).length,
      concrete: isConcreteTrip(t),
      drumMin: isConcreteTrip(t) && t.loadedAt && (t.status === "LOADED" || t.status === "ON_ROAD") ? mins(t.loadedAt, now) : null,
    };
  };
  const dashTrips = trips.map(toDash);
  const byId = new Map(dashTrips.map((t) => [t.id, t]));

  // ── Zayavkalar ──
  const dashOrders: DashOrder[] = orders.map((o) => ({
    ...orderLogistics(o, now),
    id: o.id, orderNo: o.orderNo, customerId: o.customerId, customer: o.customer.name, address: o.deliveryAddress,
    needsPump: o.needsPump, isUrgent: o.isUrgent, unit: unitOf(o.items), deliveryTime: o.deliveryTime,
    trips: o.trips.filter((t) => t.status !== "CANCELLED").map((t) => byId.get(t.id) ?? toDash(t)),
  }));

  // ── Transport ──
  const shiftMin = Math.max(60, (settings.shiftEndHour - settings.shiftStartHour) * 60);
  const shiftStart = new Date(from); shiftStart.setHours(settings.shiftStartHour, 0, 0, 0);
  const shiftEnd = new Date(from); shiftEnd.setHours(settings.shiftEndHour, 0, 0, 0);
  const dashVehicles: DashVehicle[] = vehicles.map((v) => {
    const vt = trips.filter((t) => t.vehicleId === v.id);
    const liveState = vehicleLive(v, vt, now);
    const current = vt.find((t) => ACTIVE_TRIP.includes(t.status)) ?? null;
    const inRange = (x: Date | null) => !!x && x >= from && x < to;
    // Kechadan qolgan yo'ldagi reys ham bugungi bandlikka kiradi
    const today = vt.filter((t) => t.status !== "CANCELLED" && (inRange(t.loadedAt) || inRange(t.createdAt) || inRange(t.deliveredAt) || (isToday && ACTIVE_TRIP.includes(t.status))));
    // Bandlik: yuklashdan qaytishgacha (qaytish bo'lmasa — yetkazish, u ham bo'lmasa — hozir), smena ichida
    let busy = 0;
    for (const t of today) {
      if (!t.loadedAt) continue;
      const a = new Date(Math.max(t.loadedAt.getTime(), shiftStart.getTime()));
      const endRaw = t.returnedAt ?? t.deliveredAt ?? (isToday ? now : shiftEnd);
      const b = new Date(Math.min(endRaw.getTime(), shiftEnd.getTime()));
      if (b > a) busy += mins(a, b);
    }
    const docs = [expiryLevel(v.inspectionUntil, now), expiryLevel(v.insuranceUntil, now)].filter((x): x is Level => !!x);
    return {
      id: v.id, plate: v.plate, type: v.type, capacity: v.capacityM3 ? Number(v.capacityM3) : null, live: liveState, statusNote: v.statusNote,
      driver: current ? current.driver.fullName : v.drivers[0]?.fullName ?? null, trip: current ? byId.get(current.id) ?? null : null,
      todayTrips: today.length, todayQty: today.reduce((s, t) => s + Number(t.qtyM3), 0), busyMin: Math.min(busy, shiftMin),
      docs: docs.includes("crit") ? "crit" : docs.includes("warn") ? "warn" : docs.length ? "ok" : null,
    };
  });
  const fleet = dashVehicles.filter((v) => v.type !== "PUMP" && v.live !== "INACTIVE");

  // ── KPI ──
  const inDay = (d: Date | null) => !!d && d >= from && d < to;
  const delivered = dashTrips.filter((t) => t.status === "DELIVERED" && inDay(t.deliveredAt));
  const dayTrips = dashTrips.filter((t) => ACTIVE_TRIP.includes(t.status as never) || inDay(t.deliveredAt) || inDay(t.loadedAt) || inDay(t.plannedAt));
  const withDelay = delivered.filter((t) => t.delayMin != null);
  const durations = delivered.filter((t) => t.loadedAt && t.deliveredAt).map((t) => mins(t.loadedAt!, t.deliveredAt!));
  const waiting = dashOrders.filter((o) => ["CONFIRMED", "PLANNED"].includes(o.status) || (["ASSIGNED", "LOADING", "ON_ROAD"].includes(o.status) && o.remaining > 0.001));
  const lateTrips = dashTrips.filter((t) => ACTIVE_TRIP.includes(t.status as never) && t.level !== "ok");
  // Kun rejasi — faqat shu kunga yozilgan beton zayavkalari (oldingi kunlardan qolgani alohida: "kutayotgan")
  const dayOrderIds = new Set(orders.filter((o) => o.deliveryDate >= from && o.deliveryDate < to).map((o) => o.id));
  const planM3 = dashOrders.filter((o) => o.unit === "m3" && dayOrderIds.has(o.id)).reduce((s, o) => s + o.total, 0);

  // ── Ogohlantirishlar ──
  const alerts: DashAlert[] = [];
  if (isToday) {
    for (const o of waiting) {
      if (!o.plannedAt || o.remaining <= 0.001) continue;
      const left = mins(now, o.plannedAt);
      if (left <= settings.assignLeadMin * 2) {
        alerts.push({
          level: left <= settings.assignLeadMin ? "crit" : "warn",
          title: `${o.orderNo}: transport biriktirilmagan`,
          text: `${o.customer} · ${o.remaining} ${o.unit === "m3" ? "m³" : o.unit} qoldi · ${left >= 0 ? `${minutesLabel(left)} qoldi` : `${minutesLabel(-left)} o'tdi`}`,
          href: `/trips/new?orderId=${o.id}`,
        });
      }
    }
    for (const t of dashTrips) {
      if (t.status === "ON_ROAD" && t.level !== "ok") {
        alerts.push({ level: t.level, title: `${t.noteNo} kechikmoqda`, text: `${t.plate} · ${t.driver} · +${minutesLabel(t.delayMin)}`, href: `/trips/${t.id}` });
      }
      if (t.status === "ON_ROAD" && !t.arrivedAt) {
        const age = t.fix ? mins(t.fix.at, now) : t.departedAt ? mins(t.departedAt, now) : null;
        if (age != null && age >= settings.gpsSilentMin) {
          alerts.push({ level: "crit", title: `${t.plate}: GPS jim`, text: `${t.fix ? `oxirgi nuqta ${minutesLabel(age)} oldin` : `yo'lga chiqqaniga ${minutesLabel(age)}, nuqta yo'q`} · ${t.driver}`, href: `/trips/${t.id}` });
        }
      }
      if (t.status === "LOADED" && t.loadedAt && mins(t.loadedAt, now) >= settings.loadedWarnMin) {
        const m = mins(t.loadedAt, now);
        // "Qotish xavfi" faqat beton reysida — yuk mashinadagi plita qotmaydi
        alerts.push({ level: m >= settings.loadedWarnMin * 3 ? "crit" : "warn", title: `${t.noteNo} yuklangan, chiqmadi`, text: `${minutesLabel(m)} · ${t.plate}${t.concrete ? " · beton qotish xavfi" : ""}`, href: `/trips/${t.id}` });
      }
      // Baraban vaqti: yuklangan beton yetkazilmasdan limitdan oshdi (yo'lda ham, zavodda ham)
      if (t.drumMin != null && t.drumMin >= DRUM_MAX_MIN * 0.8) {
        const over = t.drumMin >= DRUM_MAX_MIN;
        alerts.push({
          level: over ? "crit" : "warn",
          title: over ? `${t.noteNo}: baraban vaqti oshdi` : `${t.noteNo}: baraban vaqti tugayapti`,
          text: `yuklanganiga ${minutesLabel(t.drumMin)} (chegara ${DRUM_MAX_MIN} daq) · ${t.plate} · ${t.driver} · beton qotish xavfi`,
          href: `/trips/${t.id}`,
        });
      }
    }
    for (const o of dashOrders) {
      if (o.status === "CANCELLED" || o.status === "DELIVERED" || o.status === "CLOSED") continue;
      const raw = orders.find((x) => x.id === o.id);
      if (raw && raw.lat == null) alerts.push({ level: "warn", title: `${o.orderNo}: obyekt nuqtasi yo'q`, text: `${o.customer} — navigatsiya va ETA ishlamaydi`, href: `/orders/${o.id}` });
    }
    for (const t of trips) {
      if (ACTIVE_TRIP.includes(t.status) && t.ecoError) alerts.push({ level: "warn", title: `${t.deliveryNoteNo}: haydovchi ilovasi`, text: t.ecoError, href: `/trips/${t.id}` });
    }
    for (const v of vehicles) {
      if (v.status === "REPAIR" && v.statusSince && now.getTime() - v.statusSince.getTime() > 3 * 86_400_000) {
        alerts.push({ level: "warn", title: `${v.plate} uzoq ta'mirda`, text: `${Math.floor((now.getTime() - v.statusSince.getTime()) / 86_400_000)} kun · ${v.statusNote ?? ""}`, href: "/logistika/transport" });
      }
      const lv = [expiryLevel(v.inspectionUntil, now), expiryLevel(v.insuranceUntil, now)];
      if (v.isActive && lv.includes("crit")) alerts.push({ level: "crit", title: `${v.plate}: hujjat muddati o'tgan`, text: "Texnik ko'rik yoki sug'urta", href: `/logistika/transport/${v.id}` });
    }
  }
  const openIssues = trips.flatMap((t) => t.issues.filter((i) => !i.resolvedAt).map((i) => ({
    id: i.id, tripId: t.id, noteNo: t.deliveryNoteNo, kind: ISSUE_KIND[i.kind], note: i.note, at: i.createdAt, driver: t.driver.fullName, plate: t.vehicle.plate,
  })));
  for (const i of openIssues) alerts.push({ level: "crit", title: `Muammo — ${i.noteNo}: ${i.kind}`, text: `${i.plate} · ${i.driver}${i.note ? ` · ${i.note}` : ""}`, href: `/trips/${i.tripId}` });
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "crit" ? -1 : b.level === "crit" ? 1 : a.level === "warn" ? -1 : 1));

  // ── Haydovchilar ──
  const drv = new Map<string, DashDriver>();
  for (const t of dashTrips) {
    const d = drv.get(t.driverId) ?? { id: t.driverId, name: t.driver, trips: 0, qty: 0, late: 0, issues: 0, avgMin: null, active: false };
    d.trips++; d.qty += t.qty; d.issues += t.openIssues;
    if (t.level !== "ok") d.late++;
    if (ACTIVE_TRIP.includes(t.status as never)) d.active = true;
    drv.set(t.driverId, d);
  }
  for (const d of drv.values()) {
    const ds = delivered.filter((t) => t.driverId === d.id && t.loadedAt && t.deliveredAt).map((t) => mins(t.loadedAt!, t.deliveredAt!));
    d.avgMin = ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : null;
  }

  // ── 14 kunlik tendensiya ──
  const week: LogisticsDashboard["week"] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(weekFrom); d.setDate(d.getDate() + i);
    const e = new Date(d); e.setDate(e.getDate() + 1);
    const ts = weekTrips.filter((t) => t.deliveredAt! >= d && t.deliveredAt! < e);
    const judged = ts.map((t) => tripDelayMin(t, t.order, now)).filter((x): x is number => x != null);
    week.push({
      day: d, trips: ts.length,
      m3: ts.filter((t) => t.order.items.every((i) => i.product.unit === "m3")).reduce((s, t) => s + Number(t.qtyM3), 0),
      onTime: judged.length ? Math.round((judged.filter((x) => x < settings.lateWarnMin).length / judged.length) * 100) : null,
    });
  }

  // ── Nasoslar: kerak bo'lgan zayavkalar (nasos reysga yozilmaydi — u yuk tashimaydi, holati Transportda) ──
  const pumps = dashOrders.filter((o) => o.needsPump && !["CANCELLED", "DELIVERED", "CLOSED"].includes(o.status)).map((o) => ({ orderId: o.id, orderNo: o.orderNo, customer: o.customer, time: o.deliveryTime }));

  return {
    day: from, isToday, settings,
    kpi: {
      trips: dayTrips.length,
      onRoad: new Set(dashTrips.filter((t) => t.status === "ON_ROAD").map((t) => t.vehicleId)).size,
      done: delivered.length,
      closed: delivered.filter((t) => t.phase === "CLOSED").length,
      waitingOrders: waiting.length,
      waitingQty: waiting.reduce((s, o) => s + o.remaining, 0),
      late: lateTrips.length + (isToday ? 0 : withDelay.filter((t) => t.level !== "ok").length),
      freeVehicles: fleet.filter((v) => v.live === "FREE").length,
      totalVehicles: fleet.length,
      concreteM3: delivered.filter((t) => t.unit === "m3").reduce((s, t) => s + t.qty, 0),
      pieceQty: delivered.filter((t) => t.unit !== "m3").reduce((s, t) => s + t.qty, 0),
      cost: costs.total, fuelCost: costs.fuel,
      avgDeliveryMin: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      onTimePct: withDelay.length ? Math.round((withDelay.filter((t) => t.level === "ok").length / withDelay.length) * 100) : null,
      planM3,
    },
    orders: dashOrders, trips: dashTrips, vehicles: dashVehicles,
    drivers: [...drv.values()].sort((a, b) => b.qty - a.qty),
    alerts, issues: openIssues, week, pumps, gpsError: live.error,
  };
}
