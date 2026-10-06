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

type Dash = Awaited<ReturnType<typeof import("@/lib/logistics-dashboard").logisticsDashboard>>;

/** Panel reyslari + jonli nuqtalar → ilova qatorlari. Obyekt nuqtasi (navigator uchun) zayavkadan. */
export async function toFleet(d: Dash, live: LiveTruck[]): Promise<FleetTruck[]> {
  const { TRIP_PHASE, minutesLabel } = await import("@/lib/logistics");
  const byRef = new Map(live.map((l) => [l.ref, l]));
  const active = d.trips.filter((t) => ["PLANNED", "LOADED", "ON_ROAD"].includes(t.status));
  const orders = await db.order.findMany({ where: { id: { in: [...new Set(active.map((t) => t.orderId))] } }, select: { id: true, lat: true, lng: true, site: { select: { lat: true, lng: true } }, items: { select: { product: { select: { name: true } } } } } });
  // Reys nima olib ketyapti — zayavka mahsulotlari
  const products = new Map(orders.map((o) => [o.id, [...new Set(o.items.map((i) => i.product.name))].join(", ")]));
  const dest = new Map(
    orders.map((o) => [o.id, o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : o.site?.lat != null && o.site?.lng != null ? { lat: o.site.lat, lng: o.site.lng } : null]),
  );
  return active.map((t) => {
    const l = byRef.get(t.noteNo);
    const gps = l ? { lat: l.lat, lng: l.lng, at: new Date().toISOString(), etaMin: l.etaMin, km: l.km }
      : t.fix ? { lat: t.fix.lat, lng: t.fix.lng, at: t.fix.at.toISOString(), etaMin: t.fix.etaMin, km: null } : null;
    const ph = TRIP_PHASE[t.phase];
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
    };
  });
}

export type MobileFleet = { at: string; trucks: FleetTruck[]; gpsError: string | null };

/** `GET /api/mobile/fleet` — faol reyslar va ularning oxirgi GPS nuqtasi. */
export async function mobileFleet(user: MobileUser, liveOf: (u: MobileUser) => Promise<LiveTruck[]>): Promise<MobileFleet> {
  if (!(FLEET_ROLES as readonly string[]).includes(user.role)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const { logisticsDashboard } = await import("@/lib/logistics-dashboard");
  const [d, live] = await Promise.all([logisticsDashboard(), liveOf(user)]);
  return { at: new Date().toISOString(), trucks: await toFleet(d, live), gpsError: d.gpsError };
}
