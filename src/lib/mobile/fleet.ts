import { db } from "@/lib/db";
import type { MobileUser } from "./auth";
import type { FleetTruck, LiveTruck, Tone } from "./home";
import { time } from "./fmt";
import { ListError } from "./list";

/**
 * Faol reyslar xaritasi — logistika "Xarita" tabi va direktorning "Reyslar xaritada" ekrani.
 *
 * Raqamlar vebdagi logistika paneli bilan bitta manbadan (`logisticsDashboard()`): faol reyslar
 * (PLANNED / LOADED / ON_ROAD), GPS'i yo'qlari ham ro'yxatda turadi. Ilova 10–15 s da qayta so'raydi
 * (`GET /api/mobile/fleet`), shuning uchun bu yerda bosh sahifaning qolgan og'ir hisob-kitobi yo'q.
 */

const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };

/** Xaritani kim ko'radi: direktor, logistika va mexanik (vebda ham logistika paneli shularga ochiq). */
export const FLEET_ROLES = ["DIRECTOR", "LOGISTICS", "MECHANIC"] as const;

/** GPS eskirganmi: oxirgi aloqa `silentMin` daqiqadan eski. Bosh sahifa `live` ham shu bilan (`./home.ts`). */
export const gpsStale = (seen: Date | null, now: Date, silentMin: number) => !!seen && now.getTime() - seen.getTime() >= silentMin * 60_000;

type Dash = Awaited<ReturnType<typeof import("@/lib/logistics-dashboard").logisticsDashboard>>;

/** Panel reyslari + jonli nuqtalar → ilova qatorlari. Obyekt nuqtasi (navigator uchun) zayavkadan. */
export async function toFleet(d: Dash, live: LiveTruck[], now = new Date()): Promise<FleetTruck[]> {
  const { TRIP_PHASE, minutesLabel } = await import("@/lib/logistics");
  const byRef = new Map(live.map((l) => [l.ref, l]));
  const active = d.trips.filter((t) => ["PLANNED", "LOADED", "ON_ROAD"].includes(t.status));
  const g = await gpsExtras(active.map((t) => t.id), now);
  const orders = await db.order.findMany({ where: { id: { in: [...new Set(active.map((t) => t.orderId))] } }, select: { id: true, lat: true, lng: true, site: { select: { lat: true, lng: true } }, items: { select: { product: { select: { name: true } } } } } });
  // Reys nima olib ketyapti — zayavka mahsulotlari
  const products = new Map(orders.map((o) => [o.id, [...new Set(o.items.map((i) => i.product.name))].join(", ")]));
  const dest = new Map(
    orders.map((o) => [o.id, o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : o.site?.lat != null && o.site?.lng != null ? { lat: o.site.lat, lng: o.site.lng } : null]),
  );
  return active.map((t) => {
    const l = byRef.get(t.noteNo);
    // `at` — oxirgi nuqtaning haqiqiy GPS vaqti (ilgari so'rov vaqti yozilardi va eskirgan nuqta "hozirgi" ko'rinardi)
    const gps = l ? { lat: l.lat, lng: l.lng, at: l.at ?? t.fix?.at.toISOString() ?? now.toISOString(), etaMin: l.etaMin, km: l.km }
      : t.fix ? { lat: t.fix.lat, lng: t.fix.lng, at: t.fix.at.toISOString(), etaMin: t.fix.etaMin, km: null } : null;
    const ph = TRIP_PHASE[t.phase];
    const x = g.trips.get(t.id);
    // Eskirganlik: telefondan oxirgi aloqa ("tirikman" ham) — bo'lmasa oxirgi nuqta vaqti
    const seen = x?.lastSeenAt ?? (gps ? new Date(gps.at) : null);
    return {
      tripId: t.id, ref: t.noteNo, plate: t.plate, driver: t.driver, driverPhone: t.driverPhone,
      customer: t.customer, address: t.address,
      phase: ph.label, tone: t.openIssues ? "danger" as Tone : TRIP_TONE[t.status] ?? "info",
      plannedAt: t.plannedAt ? time(t.plannedAt) : null,
      delay: t.delayMin == null ? null : t.delayMin <= 0 ? "o'z vaqtida" : `+${minutesLabel(t.delayMin)}`,
      delayTone: t.delayMin == null || t.delayMin <= 0 ? null : t.level === "crit" ? "danger" : t.level === "warn" ? "warning" : "info",
      openIssues: t.openIssues,
      gps,
      // Yangi maydonlar (eski ilova e'tiborsiz qoldiradi): zayavka, holat, obyekt nuqtasi
      orderId: t.orderId, orderNo: t.orderNo, status: t.status,
      qty: `${t.qty % 1 ? t.qty.toFixed(1) : t.qty} ${t.unit === "m3" ? "m³" : t.unit}`,
      dest: dest.get(t.orderId) ?? null,
      product: products.get(t.orderId) || null,
      speedKmh: x?.lastSpeedKmh != null ? Math.round(x.lastSpeedKmh) : l?.speedKmh != null ? Math.round(l.speedKmh) : null,
      heading: x?.lastHeading != null ? Math.round(x.lastHeading) : l?.heading != null ? Math.round(l.heading) : null,
      stale: t.status !== "PLANNED" && gpsStale(seen, now, d.settings.gpsSilentMin),
      lastSeenAt: seen?.toISOString() ?? null,
      trail: g.trail.get(t.id) ?? [],
      alerts: g.alerts.get(t.id) ?? [],
    };
  });
}

/** Iz "dumi" — so'nggi shuncha daqiqa. */
const TRAIL_MS = 15 * 60_000;

/**
 * Xarita uchun qo'shimcha GPS ma'lumoti — bitta so'rovda va faqat kerakli qismi: oxirgi nuqta Trip
 * ustunlaridan, iz faqat 15 daqiqalik oynadan (har 12 s da butun iz o'qilmaydi), ochiq ogohlantirishlar.
 */
async function gpsExtras(ids: string[], now: Date) {
  const { groupBy, simplifyLine } = await import("@/lib/trip-track");
  const { ALERT_TITLE } = await import("@/lib/gps-watch");
  if (!ids.length) return { trips: new Map(), trail: new Map<string, { lat: number; lng: number }[]>(), alerts: new Map<string, NonNullable<FleetTruck["alerts"]>>() };
  const [trips, pts, alerts] = await Promise.all([
    db.trip.findMany({ where: { id: { in: ids } }, select: { id: true, lastSeenAt: true, lastSpeedKmh: true, lastHeading: true } }),
    db.tripPosition.findMany({ where: { tripId: { in: ids }, at: { gte: new Date(now.getTime() - TRAIL_MS), lte: new Date(now.getTime() + 2 * 60_000) } }, orderBy: { at: "asc" }, select: { tripId: true, lat: true, lng: true } }),
    db.tripAlert.findMany({ where: { tripId: { in: ids }, closedAt: null }, orderBy: { openedAt: "asc" }, select: { tripId: true, kind: true, info: true, since: true, openedAt: true } }),
  ]);
  const trail = new Map<string, { lat: number; lng: number }[]>();
  for (const [id, list] of groupBy(pts, (p) => p.tripId)) trail.set(id, simplifyLine(list, 10).map((p) => ({ lat: p.lat, lng: p.lng })));
  const al = new Map<string, NonNullable<FleetTruck["alerts"]>>();
  for (const [id, list] of groupBy(alerts, (a) => a.tripId)) {
    al.set(id, list.map((a) => ({ kind: a.kind, title: ALERT_TITLE[a.kind as keyof typeof ALERT_TITLE] ?? a.kind, info: a.info, since: a.since?.toISOString() ?? null, openedAt: a.openedAt.toISOString() })));
  }
  return { trips: new Map(trips.map((t) => [t.id, t])), trail, alerts: al };
}

export type MobileFleet = {
  at: string; trucks: FleetTruck[]; gpsError: string | null;
  /** "GPS eskirgan" chegarasi, daqiqa (logistika sozlamasi) — `trucks[].stale` shu bo'yicha. */
  staleMin?: number;
};

/** `GET /api/mobile/fleet` — faol reyslar va ularning oxirgi GPS nuqtasi. */
export async function mobileFleet(user: MobileUser, liveOf: (u: MobileUser) => Promise<LiveTruck[]>): Promise<MobileFleet> {
  if (!(FLEET_ROLES as readonly string[]).includes(user.role)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const { logisticsDashboard } = await import("@/lib/logistics-dashboard");
  const [d, live] = await Promise.all([logisticsDashboard(), liveOf(user)]);
  const now = new Date();
  return { at: now.toISOString(), trucks: await toFleet(d, live, now), gpsError: d.gpsError, staleMin: d.settings.gpsSilentMin };
}
