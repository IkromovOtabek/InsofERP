import { db } from "@/lib/db";
import { trackStats, type TrackPoint } from "@/lib/trips";
import { logisticsDashboard } from "@/lib/logistics-dashboard";
import { findStops as findStopsIn, groupBy } from "@/lib/trip-track";

/**
 * GPS / Monitoring (TZ 9): tezlik, to'xtashlar, ETA, kechikish, harakat tarixi.
 * Joylashuv ikki manbadan (`lib/live.ts`); to'xtashlar faqat zavod haydovchilari izidan
 * (ERP TripPosition) — pudratchi izi ECO'da, u yerda nuqtalar alohida so'raladi.
 */

/** Shu radiusda shuncha vaqt turgan mashina "to'xtagan" hisoblanadi (svetofor 2-3 daqiqa — hisobga olinmaydi). */
const STOP_RADIUS_M = 60;
const STOP_MIN_MS = 5 * 60_000;

export type Stop = { lat: number; lng: number; from: Date; to: Date; minutes: number };

/** To'xtashlar — bir o'tishda, O(n) (`lib/trip-track.ts`). */
export function findStops(points: TrackPoint[]): Stop[] {
  return findStopsIn(points, STOP_RADIUS_M, STOP_MIN_MS);
}

export type MonitorRow = Awaited<ReturnType<typeof logisticsDashboard>>["trips"][number] & {
  speedKmh: number | null; avgKmh: number | null; km: number; stops: Stop[]; stopNowMin: number | null; fixAgeMin: number | null;
};

export async function monitorRows(): Promise<{ rows: MonitorRow[]; gpsSilentMin: number; error: string | null }> {
  const d = await logisticsDashboard();
  const active = d.trips.filter((t) => ["LOADED", "ON_ROAD"].includes(t.status));
  const pts = await db.tripPosition.findMany({
    where: { tripId: { in: active.map((t) => t.id) } }, orderBy: { at: "asc" },
    select: { tripId: true, lat: true, lng: true, at: true, speedKmh: true },
  });
  const now = Date.now();
  // Reys bo'yicha guruhlash bir o'tishda — ilgari har reys uchun butun ro'yxat filtrlanardi (reyslar × nuqtalar)
  const byTrip = groupBy(pts, (p) => p.tripId);
  const rows = active.map((t) => {
    const mine = byTrip.get(t.id) ?? [];
    const track = mine.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at }));
    const { meters, movingMs } = trackStats(track);
    const stops = findStops(track);
    const lastStop = stops[stops.length - 1];
    const lastPt = mine[mine.length - 1];
    // Hozir turibdimi: oxirgi to'xtash oxirgi nuqtagacha davom etgan
    const stopNowMin = lastStop && lastPt && lastStop.to.getTime() === lastPt.at.getTime() ? Math.round((now - lastStop.from.getTime()) / 60000) : null;
    // "GPS jim" — telefondan oxirgi aloqa (nuqtasiz "tirikman" ham), bo'lmasa oxirgi nuqta
    const fixAt = t.lastSeenAt ?? t.fix?.at ?? lastPt?.at ?? null;
    return {
      ...t,
      speedKmh: lastPt?.speedKmh != null ? Math.round(lastPt.speedKmh) : null,
      avgKmh: movingMs > 60_000 ? Math.round((meters / 1000) / (movingMs / 3_600_000)) : null,
      km: meters / 1000, stops, stopNowMin,
      fixAgeMin: fixAt ? Math.round((now - fixAt.getTime()) / 60000) : null,
    };
  });
  return { rows, gpsSilentMin: d.settings.gpsSilentMin, error: d.gpsError };
}
