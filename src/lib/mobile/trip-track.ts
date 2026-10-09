import { db } from "@/lib/db";
import type { MobileUser } from "./auth";
import { FLEET_ROLES } from "./fleet";
import { driverEmployeeId, ListError } from "./list";
import { tripTrackDetail, tripTrackSummaries } from "@/lib/trip-summary";
import { decodePolyline, type LatLng } from "@/lib/trip-track";

/**
 * `GET /api/mobile/trip-track?id=...` — reysning bosib o'tgan yo'li va statistikasi (xarita + raqamlar).
 *
 * Ruxsat: reys haydovchisi (o'z reysi) va xarita rollari (direktor, logistika, mexanik).
 * Yopilgan reys — saqlangan yakundan (nuqtalar 90 kundan keyin o'chsa ham ishlaydi);
 * ochiq reys — keshlangan hisobdan, ilova bir necha soniyada so'rasa ham butun iz qayta o'qilmaydi.
 * Chiziq ikki ko'rinishda: `line` (nuqtalar massivi) va `polyline` (Google encoded polyline, 5 xona).
 */
export type TripTrackResponse = {
  tripId: string;
  ref: string;
  status: string;
  /** true — reys yakuni saqlangan (yetkazilgan/yopilgan), raqamlar endi o'zgarmaydi. */
  final: boolean;
  distanceKm: number;
  meters: number;
  /** Birinchi nuqtadan oxirgisigacha, soniya. */
  totalSec: number;
  /** Harakatda o'tgan vaqt, soniya (turishlar va aloqa uzilishlari chiqarilgan). */
  movingSec: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  /** Serverdagi xom nuqtalar soni. */
  points: number;
  line: LatLng[];
  polyline: string;
  last: { lat: number; lng: number; at: string; speedKmh: number | null; heading: number | null } | null;
  /** Telefondan oxirgi aloqa (nuqta yoki "tirikman"). */
  lastSeenAt: string | null;
  planned: { line: LatLng[]; polyline: string; km: number | null; min: number | null } | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
};

export async function mobileTripTrack(user: MobileUser, tripId: string): Promise<TripTrackResponse> {
  if (!tripId) throw new ListError("BAD_REQUEST", "Reys tanlanmagan", 400);
  const isDriver = user.role === "DRIVER";
  if (!isDriver && !(FLEET_ROLES as readonly string[]).includes(user.role)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const t = await db.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true, deliveryNoteNo: true, status: true, driverId: true, arrivedAt: true, deliveredAt: true,
      lastLat: true, lastLng: true, lastAt: true, lastSpeedKmh: true, lastHeading: true, lastSeenAt: true,
      plannedRoute: true, plannedKm: true, plannedMin: true,
    },
  });
  // Begona reys "topilmadi" — kartochka qoidasi bilan bir xil (`lib/mobile/detail.ts`)
  if (!t || (isDriver && t.driverId !== (await driverEmployeeId(user.id)))) throw new ListError("NOT_FOUND", "Reys topilmadi", 404);
  const d = (await tripTrackDetail(t.id))!;
  return {
    tripId: t.id, ref: t.deliveryNoteNo, status: t.status, final: d.final,
    distanceKm: d.distanceKm, meters: d.meters, totalSec: d.totalSec, movingSec: d.movingSec,
    avgSpeedKmh: d.avgSpeedKmh, maxSpeedKmh: d.maxSpeedKmh, points: d.points,
    line: d.line, polyline: d.polyline,
    last: t.lastLat != null && t.lastLng != null && t.lastAt
      ? { lat: t.lastLat, lng: t.lastLng, at: t.lastAt.toISOString(), speedKmh: t.lastSpeedKmh != null ? Math.round(t.lastSpeedKmh) : null, heading: t.lastHeading != null ? Math.round(t.lastHeading) : null }
      : null,
    lastSeenAt: t.lastSeenAt?.toISOString() ?? null,
    planned: t.plannedRoute ? { line: decodePolyline(t.plannedRoute), polyline: t.plannedRoute, km: t.plannedKm, min: t.plannedMin } : null,
    arrivedAt: t.arrivedAt?.toISOString() ?? null,
    deliveredAt: t.deliveredAt?.toISOString() ?? null,
  };
}

/** Ro'yxat ekrani uchun bitta reys yakuni (chiziqsiz) — `trip-track` raqamlari bilan bir xil. */
export type TripTrackSummaryItem = {
  distanceKm: number;
  totalSec: number;
  movingSec: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  final: boolean;
  status: string;
};

/** Bir so'rovda ko'pi bilan shuncha reys. */
export const SUMMARY_MAX_IDS = 100;

/**
 * `GET /api/mobile/trip-track/summary?ids=a,b,c` (yoki `POST {ids: [...]}`) — bir nechta reys yakuni bitta so'rovda.
 * "Mening reyslarim" ro'yxati oyda 60 reys uchun 60 ta `trip-track` so'ramasin.
 *
 * Ruxsat `mobileTripTrack` bilan bir xil: haydovchi faqat o'z reyslari, xarita rollari hammasi.
 * Ruxsatsiz yoki mavjud bo'lmagan id javobda shunchaki yo'q (bori-yo'qligi oshkor qilinmaydi).
 */
export async function mobileTripTrackSummary(user: MobileUser, raw: unknown): Promise<{ items: Record<string, TripTrackSummaryItem> }> {
  const list = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : null;
  if (!list) throw new ListError("BAD_REQUEST", "Reyslar ro'yxati (ids) kerak", 400);
  const ids = [...new Set(list.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x.length > 0 && x.length <= 64))];
  if (ids.length === 0) throw new ListError("BAD_REQUEST", "Reys tanlanmagan", 400);
  if (ids.length > SUMMARY_MAX_IDS) throw new ListError("BAD_REQUEST", `Bir so'rovda ko'pi bilan ${SUMMARY_MAX_IDS} ta reys`, 400);
  const isDriver = user.role === "DRIVER";
  if (!isDriver && !(FLEET_ROLES as readonly string[]).includes(user.role)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const stats = await tripTrackSummaries(ids, isDriver ? await driverEmployeeId(user.id) : undefined);
  const items: Record<string, TripTrackSummaryItem> = {};
  for (const [id, d] of stats) {
    items[id] = {
      distanceKm: d.distanceKm, totalSec: d.totalSec, movingSec: d.movingSec,
      avgSpeedKmh: d.avgSpeedKmh, maxSpeedKmh: d.maxSpeedKmh, final: d.final, status: d.status,
    };
  }
  return { items };
}
