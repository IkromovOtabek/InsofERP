import { db } from "@/lib/db";
import { haversineMeters } from "@/lib/geo";
import { trackStats, type TrackPoint } from "@/lib/trips";
import { logisticsDashboard } from "@/lib/logistics-dashboard";

/**
 * GPS / Monitoring (TZ 9): tezlik, to'xtashlar, ETA, kechikish, harakat tarixi.
 * Joylashuv ikki manbadan (`lib/live.ts`); to'xtashlar faqat zavod haydovchilari izidan
 * (ERP TripPosition) — pudratchi izi ECO'da, u yerda nuqtalar alohida so'raladi.
 */

/** Shu radiusda shuncha vaqt turgan mashina "to'xtagan" hisoblanadi (svetofor 2-3 daqiqa — hisobga olinmaydi). */
const STOP_RADIUS_M = 60;
const STOP_MIN_MS = 5 * 60_000;

export type Stop = { lat: number; lng: number; from: Date; to: Date; minutes: number };

export function findStops(points: TrackPoint[]): Stop[] {
  const out: Stop[] = [];
  let i = 0;
  while (i < points.length) {
    const a = points[i];
    let j = i + 1;
    while (j < points.length && haversineMeters(a.lat, a.lng, points[j].lat, points[j].lng) <= STOP_RADIUS_M) j++;
    const last = points[j - 1];
    const ms = last.at.getTime() - a.at.getTime();
    if (ms >= STOP_MIN_MS) out.push({ lat: a.lat, lng: a.lng, from: a.at, to: last.at, minutes: Math.round(ms / 60000) });
    i = j > i + 1 ? j : i + 1;
  }
  return out;
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
  const rows = active.map((t) => {
    const mine = pts.filter((p) => p.tripId === t.id);
    const track = mine.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at }));
    const { meters, movingMs } = trackStats(track);
    const stops = findStops(track);
    const lastStop = stops[stops.length - 1];
    const lastPt = mine[mine.length - 1];
    // Hozir turibdimi: oxirgi to'xtash oxirgi nuqtagacha davom etgan
    const stopNowMin = lastStop && lastPt && lastStop.to.getTime() === lastPt.at.getTime() ? Math.round((now - lastStop.from.getTime()) / 60000) : null;
    const fixAt = t.fix?.at ?? lastPt?.at ?? null;
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
