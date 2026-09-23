import { db } from "@/lib/db";
import { eco, ecoEnabled, type EcoLiveTrip, type EcoOdometer, type EcoStatus, type EcoTrack } from "@/lib/eco/client";
import { visibleTrips, type Viewer } from "@/lib/eco/visibility";
import { haversineMeters } from "@/lib/geo";
import { tripTrack, tripTrackStats, type TrackPoint } from "@/lib/trips";

/**
 * Xaritadagi mashinalar — IKKI manbadan.
 *
 *  · Insof ECO — tashqi pudratchi haydovchilar, ular ECO ilovasidan yuradi;
 *  · Insof ERP — zavodning o'z haydovchilari, ular ERP logini bilan kiradi va
 *    GPS'ni `/api/mobile/track` orqali shu bazaga yuboradi (`lib/mobile/track.ts`).
 *
 * Sahifalar manbani bilmaydi: ikkalasi ham `EcoLiveTrip` shakliga keltiriladi va
 * ruxsat qoidasi bitta joyda qoladi (`lib/eco/visibility.ts`).
 */

/** ERP holatini ECO tilidagi holatga o'girish — xaritadagi rang va yozuv shu bo'yicha. */
const TO_ECO_STATUS: Record<string, EcoStatus> = { LOADED: "LOADING", ON_ROAD: "EN_ROUTE", DELIVERED: "COMPLETED" };

/** Iz bo'yicha haqiqiy yurilgan yo'l (to'g'ri chiziq emas — nuqtadan nuqtaga). */
function odometer(points: TrackPoint[]): EcoOdometer {
  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    meters += haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  const minutes = points.length > 1 ? Math.max(0, Math.round((points[points.length - 1].at.getTime() - points[0].at.getTime()) / 60000)) : 0;
  return {
    meters: Math.round(meters),
    points: points.length,
    movingMinutes: minutes,
    avgSpeedKmh: minutes > 0 ? Math.round((meters / 1000) / (minutes / 60)) : null,
    maxSpeedKmh: null, // tezlik nuqtalarda bor, lekin bu yerda kerak emas — ro'yxat uchun o'rtachasi yetadi
  };
}

/** Zavod haydovchilarining yo'ldagi reyslari. GPS yubormaganlari xaritaga chiqmaydi. */
async function erpLive(): Promise<EcoLiveTrip[]> {
  const trips = await db.trip.findMany({
    where: { status: { in: ["LOADED", "ON_ROAD"] } },
    include: { order: { include: { customer: true } }, driver: true, vehicle: true },
    take: 200,
  });
  if (trips.length === 0) return [];
  const stats = await tripTrackStats(trips.map((t) => t.id));
  return trips
    .filter((t) => stats.has(t.id))
    .map((t) => {
      const st = stats.get(t.id)!;
      const p = st.last;
      return {
        ref: t.deliveryNoteNo,
        deliveryId: t.ecoDeliveryId ?? t.id,
        status: TO_ECO_STATUS[t.status] ?? "EN_ROUTE",
        orderRef: t.order.orderNo,
        customer: t.order.customer.name,
        address: t.order.deliveryAddress,
        destination: t.order.lat != null && t.order.lng != null ? { lat: t.order.lat, lng: t.order.lng } : null,
        driver: t.driver.fullName,
        driverPhone: t.driver.phone,
        plate: t.vehicle.plate,
        plannedM3: String(t.qtyM3),
        loadedM3: t.status === "PLANNED" ? null : String(t.qtyM3),
        plannedAt: t.order.deliveryDate.toISOString(),
        departedAt: t.loadedAt?.toISOString() ?? null,
        slaBreached: false,
        position: { deliveryId: t.ecoDeliveryId ?? t.id, lat: p.lat, lng: p.lng, at: p.at.toISOString(), etaMin: null },
        // Yurilgan yo'l shu yerda hisoblanadi: ro'yxatda ham, kartochkada ham bir xil raqam
        odometer: {
          meters: Math.round(st.meters),
          points: st.points,
          movingMinutes: st.minutes,
          avgSpeedKmh: st.minutes > 0 ? Math.round((st.meters / 1000) / (st.minutes / 60)) : null,
          maxSpeedKmh: null,
        },
      } satisfies EcoLiveTrip;
    });
}

/**
 * Yo'ldagi hamma mashina — ko'ruvchining ruxsatiga qarab.
 *
 * Bir reys ikkala manbada ham bo'lishi mumkin (ERP uni ECO'ga yuborgan, lekin haydovchi
 * ECO ilovasidan foydalanmagan). Bunda ECO yozuvi qoladi-yu, joylashuv bizniki bilan
 * to'ldiriladi — xaritada bitta mashina ikki marta ko'rinmaydi.
 */
export async function liveTrips(viewer: Viewer, orderRef?: string | null): Promise<{ trips: EcoLiveTrip[]; error: string | null }> {
  let fromEco: EcoLiveTrip[] = [];
  let error: string | null = null;
  if (ecoEnabled()) {
    try { fromEco = await eco.positions(); } catch (e) { error = String((e as Error)?.message ?? e); }
  }
  const byRef = new Map(fromEco.map((t) => [t.ref, t]));
  for (const t of await erpLive()) {
    const existing = byRef.get(t.ref);
    if (existing) { if (!existing.position) byRef.set(t.ref, { ...existing, position: t.position }); }
    else byRef.set(t.ref, t);
  }
  const all = await visibleTrips(viewer, [...byRef.values()]);
  return { trips: orderRef ? all.filter((t) => t.orderRef === orderRef) : all, error };
}

/**
 * Bitta reysning izi. Avval ERP'dagi o'z nuqtalarimiz — zavod haydovchisi shu yerga yuboradi;
 * bo'lmasa ECO'dan so'raladi (pudratchi haydovchi).
 */
export async function trackByRef(ref: string): Promise<{ track: EcoTrack | null; error: string | null }> {
  const trip = await db.trip.findUnique({ where: { deliveryNoteNo: ref }, select: { id: true, status: true, ecoDeliveryId: true } });
  if (trip) {
    const points = await tripTrack(trip.id);
    if (points.length > 0) {
      return {
        track: {
          ref,
          deliveryId: trip.ecoDeliveryId ?? trip.id,
          status: TO_ECO_STATUS[trip.status] ?? "EN_ROUTE",
          points: points.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at.toISOString(), speedKmh: null })),
          odometer: odometer(points),
        },
        error: null,
      };
    }
  }
  if (!ecoEnabled()) return { track: null, error: null };
  try { return { track: await eco.track(ref), error: null }; }
  catch (e) { return { track: null, error: String((e as Error)?.message ?? e) }; }
}
