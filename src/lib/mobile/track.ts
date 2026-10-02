import { z } from "zod";
import { db } from "@/lib/db";
import type { MobileUser } from "./auth";
import { driverEmployeeId, ListError } from "./list";
import { haversineMeters } from "@/lib/geo";
import { reportTripIssue } from "@/lib/trips";

/**
 * Haydovchi ilovasidan kelayotgan GPS nuqtalari.
 *
 * Ilova nuqtalarni lokal buferga yig'adi va to'p-to'p yuboradi (aloqa uzilsa yo'qolmasin),
 * shuning uchun bu yerga bir necha o'nlab nuqta birdan keladi va ular ORQADAGI vaqt bilan
 * bo'lishi mumkin — `at` qurilmadagi vaqt, `createdAt` esa serverga yetib kelgan payt.
 */

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(300).optional(),
  heading: z.number().min(0).max(360).optional(),
  at: z.string().min(1),
});
const Batch = z.object({
  tripId: z.string().min(1),
  points: z.array(Point).min(1).max(200),
});

export type TrackResult = { ok: true; accepted: number; rejected?: number };

/**
 * Mikser bundan tez yurolmaydi. Oldingi nuqtaga nisbatan shundan tez "sakragan" nuqta —
 * GPS soxtalashtirish (mock location) yoki qurilma xatosi: u izga yozilmaydi, aks holda
 * bitta soxta nuqta "Yetkazdim" 1 km qoidasini ochib qo'yardi.
 */
export const MAX_SPEED_KMH = 130;
/** Juda yaqin nuqtalarda (GPS titrashi) tezlik hisoblanmaydi — 50 m ichidagi sakrash xavfsiz. */
const SPEED_MIN_DIST_M = 50;

/** Kuzatuv boshlangan va tugaydigan holatlar. PLANNED — hali yuklanmagan, CANCELLED — reys yo'q. */
const TRACKABLE = ["LOADED", "ON_ROAD", "DELIVERED"];
/** Telefon soati server soatidan shuncha oldinda bo'lishi mumkin. */
export const CLOCK_SKEW_MS = 2 * 60_000;

/**
 * Nuqtalarni qabul qilish.
 *
 * `DELIVERED` ham ro'yxatda: ilova kuzatuvni "Yetkazdim" bosilgandan KEYIN to'xtatadi va
 * qolgan buferni o'shanda yuboradi — aks holda yo'lning oxirgi qismi yo'qolardi.
 */
export async function recordTrack(user: MobileUser, body: unknown): Promise<TrackResult> {
  const p = Batch.safeParse(body);
  if (!p.success) throw new ListError("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri", 400);
  const { tripId, points } = p.data;

  const trip = await db.trip.findUnique({ where: { id: tripId }, select: { driverId: true, status: true } });
  if (!trip) throw new ListError("NOT_FOUND", "Reys topilmadi", 404);
  // Izni faqat reysga biriktirilgan haydovchi yuboradi: boshqa rol (yoki boshqa haydovchi) nuqta
  // qo'shsa, "Yetkazdim" 1 km qoidasini haydovchi uchun soxta joylashuv bilan ochib qo'yishi mumkin edi
  if (user.role !== "DRIVER" || trip.driverId !== (await driverEmployeeId(user.id))) {
    throw new ListError("FORBIDDEN", "Bu reys sizga biriktirilmagan", 403);
  }
  if (!TRACKABLE.includes(trip.status)) return { ok: true, accepted: 0 }; // kech kelgan nuqta — xato emas, shunchaki kerak emas

  // Qurilma vaqti kelajakda bo'lolmaydi: kelajak sanali nuqta doim "eng yangi" bo'lib qolib,
  // 1 km tekshiruvini abadiy ochib qo'yardi. Soat farqi uchun ozgina zaxira qoldiriladi.
  const now = Date.now();
  const rows = points.map((x) => {
    const at = new Date(x.at);
    const t = isNaN(at.getTime()) ? now : Math.min(at.getTime(), now + CLOCK_SKEW_MS);
    return { tripId, lat: x.lat, lng: x.lng, speedKmh: x.speedKmh, heading: x.heading, at: new Date(t) };
  }).sort((a, b) => a.at.getTime() - b.at.getTime());

  // Tezlik tekshiruvi: har nuqta oldingi QABUL QILINGAN nuqtaga nisbatan. Izda nuqta bo'lmasa —
  // yuk olingan joy (yoki zavod) va yuklangan vaqt boshlang'ich nuqta bo'ladi: birinchi nuqtaning
  // o'zi soxta bo'lsa, keyingi haqiqiy nuqtalar unga nisbatan rad etilib ketmasin.
  const first = rows[0]!;
  const prevRow = await db.tripPosition.findFirst({ where: { tripId, at: { lte: first.at } }, orderBy: { at: "desc" }, select: { lat: true, lng: true, at: true } });
  let prev: { lat: number; lng: number; at: Date } | null = prevRow;
  if (!prev) {
    const t = await db.trip.findUnique({ where: { id: tripId }, select: { loadedAt: true, pickupLat: true, pickupLng: true } });
    const plant = await db.companySettings.findUnique({ where: { id: "main" }, select: { lat: true, lng: true } });
    const lat = t?.pickupLat ?? plant?.lat, lng = t?.pickupLng ?? plant?.lng;
    if (t?.loadedAt && lat != null && lng != null) prev = { lat, lng, at: t.loadedAt };
  }
  const accepted: typeof rows = [];
  let rejected = 0, worst = 0;
  for (const r of rows) {
    if (prev) {
      const d = haversineMeters(prev.lat, prev.lng, r.lat, r.lng);
      const dtH = Math.max(1000, r.at.getTime() - prev.at.getTime()) / 3_600_000;
      const kmh = d / 1000 / dtH;
      if (d > SPEED_MIN_DIST_M && kmh > MAX_SPEED_KMH) { rejected++; worst = Math.max(worst, kmh); continue; }
    }
    accepted.push(r);
    prev = r;
  }
  if (accepted.length) await db.tripPosition.createMany({ data: accepted });
  if (rejected) {
    // Dispetcher bilsin — lekin har to'pda yangi muammo ochib, ro'yxatni to'ldirmaslik uchun ochig'i bo'lsa yozilmaydi
    const open = await db.tripIssue.findFirst({ where: { tripId, resolvedAt: null, note: { startsWith: "Shubhali GPS" } }, select: { id: true } });
    if (!open) {
      await reportTripIssue(tripId, user.id, {
        kind: "OTHER", source: "DRIVER",
        note: `Shubhali GPS: ${rejected} ta nuqta rad etildi — oldingi nuqtadan ~${Math.round(worst)} km/soat tezlikda "sakragan" (chegara ${MAX_SPEED_KMH}). Soxta joylashuv ilovasi bo'lishi mumkin, tekshiring`,
      }).catch(() => undefined);
    }
  }
  return { ok: true, accepted: accepted.length, ...(rejected ? { rejected } : {}) };
}
