import { z } from "zod";
import { db } from "@/lib/db";
import type { MobileUser } from "./auth";
import { driverEmployeeId, ListError } from "./list";
import { haversineMeters } from "@/lib/geo";
import { reportTripIssue } from "@/lib/trips";
import { audit } from "@/lib/audit";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { saveTripSummarySafe } from "@/lib/trip-summary";
import { validPoint } from "@/lib/trip-track";
import { knownPoint, SITE_RADIUS_M } from "./geofence";

/**
 * Haydovchi ilovasidan kelayotgan GPS nuqtalari va "tirikman" belgisi.
 *
 * Ilova nuqtalarni lokal buferga yig'adi va to'p-to'p yuboradi (aloqa uzilsa yo'qolmasin),
 * shuning uchun bu yerga bir necha o'nlab nuqta birdan keladi va ular ORQADAGI vaqt bilan
 * bo'lishi mumkin — `at` qurilmadagi vaqt, `createdAt` esa serverga yetib kelgan payt.
 *
 * So'rov (`POST /api/mobile/track`):
 *   { tripId, points: [{ lat, lng, at, speedKmh?, heading?, accuracy? }], heartbeat?: true, ping?: ISO, platform?: "ios"|"android" }
 * Bitta noto'g'ri nuqta butun to'pni rad ETMAYDI: koordinatasi buzuq, aniqligi 100 m dan yomon yoki reys
 * vaqtidan tashqari nuqta tashlanadi (`dropped`), noto'g'ri tezlik/yo'nalish esa null qilinadi.
 * `points: []` (yoki `heartbeat`/`ping`) — nuqtasiz "tirikman": mashina turganda ham oxirgi aloqa yangilanadi.
 * `ping` — telefon so'rovni tuzgan payt (ISO): oxirgi aloqa shu vaqt bilan yoziladi (kelajakda emas, `PING_MAX_AGE_MS`
 * va reys oynasidan eski emas — `pingSeenAt`). `ping`siz so'rov (eski ilova, `heartbeat: true` yoki faqat nuqtalar) — server vaqti.
 * Oxirgi aloqa faqat oldinga suriladi: kech yetib kelgan eski so'rov uni orqaga qaytarmaydi.
 *
 * Javob: { ok, accepted, dropped, duplicates, rejected?, stop?, reason? }. `stop: true` — reys yopilgan,
 * bekor qilingan yoki boshqa haydovchiga o'tgan: ilova kuzatuvni to'xtatib, buferni tozalaydi.
 */

/** Bitta yuborishda ko'pi bilan — ilova 200 tadan bo'lib yuboradi, zaxira bilan. */
const MAX_POINTS = 500;
const Batch = z.object({
  tripId: z.string().min(1).max(64),
  points: z.array(z.unknown()).max(MAX_POINTS).optional().default([]),
  heartbeat: z.boolean().optional(),
  ping: z.string().max(64).optional(),
  platform: z.string().max(16).optional(),
});

export type TrackResult = {
  ok: true;
  accepted: number;
  /** Tashlangan nuqtalar: buzuq koordinata, aniqligi yomon, reys vaqtidan tashqari. */
  dropped: number;
  /** Allaqachon saqlangan nuqtalar (bufer qayta yuborilgan) — yozilmadi, xato emas. */
  duplicates: number;
  /** Tezlik bo'yicha "sakragan" (soxta GPS gumoni) nuqtalar. */
  rejected?: number;
  /** Kuzatuvni to'xtating va buferni tozalang. */
  stop?: true;
  reason?: "CLOSED" | "DELIVERED" | "CANCELLED";
  /** Server oxirgi aloqa deb yozgan vaqt. */
  lastSeenAt?: string;
};

/**
 * Mikser bundan tez yurolmaydi. Oldingi nuqtaga nisbatan shundan tez "sakragan" nuqta —
 * GPS soxtalashtirish (mock location) yoki qurilma xatosi: u izga yozilmaydi, aks holda
 * bitta soxta nuqta "Yetkazdim" 1 km qoidasini ochib qo'yardi.
 */
export const MAX_SPEED_KMH = 130;
/** Juda yaqin nuqtalarda (GPS titrashi) tezlik hisoblanmaydi — 50 m ichidagi sakrash xavfsiz. */
const SPEED_MIN_DIST_M = 50;
/** Aniqligi shundan yomon nuqta (metr) — shahar ichida ko'cha adashadi, izga yozilmaydi. */
export const MAX_ACCURACY_M = 100;

/** Kuzatuv boshlangan va tugaydigan holatlar. PLANNED — hali yuklanmagan, CANCELLED — reys yo'q. */
const TRACKABLE = ["LOADED", "ON_ROAD", "DELIVERED"];
/** Telefon soati server soatidan shuncha farq qilishi mumkin; reys oynasi chegaralari ham shu zaxira bilan. */
export const CLOCK_SKEW_MS = 2 * 60_000;

/** `ping` server vaqtidan shuncha orqada bo'lsa ham qabul (tarmoq kechikishi, telefon soati farqi), eskisi — shu chegaraga. */
export const PING_MAX_AGE_MS = 5 * 60_000;

/**
 * "Tirikman" vaqti: `ping` bo'lsa — min(ping, hozir), pastdan reys oynasi boshi va `PING_MAX_AGE_MS` bilan
 * cheklangan; yaroqsiz yoki yo'q bo'lsa — hozir. Sof funksiya (QA `c-gps.ts` tekshiradi).
 */
export function pingSeenAt(ping: string | null | undefined, now: number, windowFrom = -Infinity): Date {
  const ms = ping ? new Date(ping).getTime() : NaN;
  if (!Number.isFinite(ms)) return new Date(now);
  const lower = Math.max(windowFrom, now - PING_MAX_AGE_MS);
  return new Date(Math.min(now, Math.max(lower, ms)));
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

type Row = { tripId: string; lat: number; lng: number; speedKmh: number | null; heading: number | null; accuracy: number | null; at: Date };

/**
 * Bitta nuqtani tekshirish. null — nuqta tashlanadi (koordinata yoki aniqlik yaroqsiz).
 * Tezlik va yo'nalish ixtiyoriy: iOS noma'lumini -1 beradi — bu nuqtani emas, faqat maydonni bekor qiladi.
 */
function parsePoint(tripId: string, x: unknown, now: number): Row | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const lat = num(o.lat), lng = num(o.lng);
  if (lat == null || lng == null || !validPoint({ lat, lng })) return null;
  const acc = num(o.accuracy);
  if (acc != null && acc > MAX_ACCURACY_M) return null;
  const sp = num(o.speedKmh), hd = num(o.heading);
  const atMs = typeof o.at === "string" || typeof o.at === "number" ? new Date(o.at).getTime() : NaN;
  return {
    tripId, lat, lng,
    speedKmh: sp != null && sp >= 0 && sp <= 300 ? sp : null,
    heading: hd != null && hd >= 0 && hd <= 360 ? hd : null,
    accuracy: acc != null && acc >= 0 ? acc : null,
    // Vaqtsiz nuqta (eski ilova xatosi) — serverga kelgan payt
    at: new Date(Number.isFinite(atMs) ? atMs : now),
  };
}

/**
 * Nuqtalarni qabul qilish.
 *
 * `DELIVERED` ham ro'yxatda: ilova kuzatuvni "Yetkazdim" bosilgandan KEYIN to'xtatadi va
 * qolgan buferni o'shanda yuboradi — aks holda yo'lning oxirgi qismi yo'qolardi. Shuning uchun
 * yetkazilgan reysga `deliveredAt` gacha bo'lgan nuqtalar qabul qilinadi (yakun qayta hisoblanadi),
 * undan keyingilari — yo'q; foydali nuqta qolmaganda javobda `stop: true`.
 */
export async function recordTrack(user: MobileUser, body: unknown): Promise<TrackResult> {
  const p = Batch.safeParse(body);
  if (!p.success) throw new ListError("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri", 400);
  const { tripId, points, platform, ping } = p.data;

  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: {
      driverId: true, status: true, loadedAt: true, departedAt: true, deliveredAt: true, closedAt: true, lastAt: true, lastSeenAt: true, gpsPlatform: true,
      arrivedAt: true, arrivalNotifiedAt: true, deliveryNoteNo: true, pickupLat: true, pickupLng: true,
      order: { select: { lat: true, lng: true, orderNo: true, site: { select: { lat: true, lng: true } } } },
      vehicle: { select: { plate: true } }, driver: { select: { fullName: true } },
    },
  });
  if (!trip) throw new ListError("NOT_FOUND", "Reys topilmadi", 404, { stop: true });
  // Izni faqat reysga biriktirilgan haydovchi yuboradi: boshqa rol (yoki boshqa haydovchi) nuqta
  // qo'shsa, "Yetkazdim" 1 km qoidasini haydovchi uchun soxta joylashuv bilan ochib qo'yishi mumkin edi.
  if (user.role !== "DRIVER") throw new ListError("FORBIDDEN", "Bu reys sizga biriktirilmagan", 403);
  if (trip.driverId !== (await driverEmployeeId(user.id))) {
    // Reys boshqa haydovchiga o'tkazilgan bo'lishi mumkin — yangi ilova kuzatuvni to'xtatadi (eski ilova 403 ni avvalgidek ko'radi)
    throw new ListError("FORBIDDEN", "Bu reys sizga biriktirilmagan", 403, { stop: true, reason: "REASSIGNED" });
  }
  const base = { ok: true as const, accepted: 0, dropped: 0, duplicates: 0 };
  if (trip.status === "CANCELLED") return { ...base, dropped: points.length, stop: true, reason: "CANCELLED" };
  if (!TRACKABLE.includes(trip.status)) return { ...base, dropped: points.length }; // PLANNED: hali yuklanmagan — kech emas, erta

  const now = Date.now();
  const done = trip.status === "DELIVERED";
  // Reys oynasi: yuklangan (yoki yo'lga chiqqan) paytdan — yetkazilgan paytgacha, ikki tomonda soat farqi zaxirasi
  const startAt = trip.loadedAt ?? trip.departedAt;
  const from = startAt ? startAt.getTime() - CLOCK_SKEW_MS : -Infinity;
  const to = done && trip.deliveredAt ? trip.deliveredAt.getTime() + CLOCK_SKEW_MS : now + CLOCK_SKEW_MS;

  let dropped = 0, duplicates = 0, rejected = 0, worst = 0;
  const accepted: Row[] = [];
  const byAt = new Map<number, Row>();
  for (const x of points) {
    const r = parsePoint(tripId, x, now);
    // Kelajak sanali nuqta doim "eng yangi" bo'lib qolib, 1 km tekshiruvini abadiy ochib qo'yardi — tashlanadi
    if (!r || r.at.getTime() < from || r.at.getTime() > to) { dropped++; continue; }
    if (byAt.has(r.at.getTime())) { dropped++; continue; } // bir to'p ichida bir vaqt ikki marta
    byAt.set(r.at.getTime(), r);
  }
  let rows = [...byAt.values()].sort((a, b) => a.at.getTime() - b.at.getTime());

  // "Tirikman": har qanday so'rov (nuqtali yoki nuqtasiz, `heartbeat`/`ping` bilan yoki ularsiz) oxirgi aloqani
  // yangilaydi — `ping` bo'lsa uning vaqti bilan. Faqat oldinga: parallel/kech so'rov orqaga surmaydi. Yetkazilgan reysda kerak emas
  let seen = pingSeenAt(ping, now, from);
  if (!done) {
    const pf = platform === "ios" || platform === "android" ? platform : undefined;
    await db.trip.updateMany({ where: { id: tripId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: seen } }] }, data: { lastSeenAt: seen } });
    if (pf && pf !== trip.gpsPlatform) await db.trip.update({ where: { id: tripId }, data: { gpsPlatform: pf } });
    if (trip.lastSeenAt && trip.lastSeenAt > seen) seen = trip.lastSeenAt;
  }

  // Allaqachon saqlangan nuqtalar (bufer qayta yuborilgan — javob telefonga yetib bormagan) tezlik tekshiruviga ham kirmaydi
  if (rows.length) {
    const have = new Set((await db.tripPosition.findMany({ where: { tripId, at: { in: rows.map((r) => r.at) } }, select: { at: true } })).map((x) => x.at.getTime()));
    duplicates = have.size;
    if (have.size) rows = rows.filter((r) => !have.has(r.at.getTime()));
  }
  if (rows.length) {
    // Tezlik tekshiruvi: har nuqta oldingi QABUL QILINGAN nuqtaga nisbatan. Izda nuqta bo'lmasa —
    // yuk olingan joy (yoki zavod) va yuklangan vaqt boshlang'ich nuqta bo'ladi: birinchi nuqtaning
    // o'zi soxta bo'lsa, keyingi haqiqiy nuqtalar unga nisbatan rad etilib ketmasin.
    const first = rows[0]!;
    const prevRow = await db.tripPosition.findFirst({ where: { tripId, at: { lte: first.at } }, orderBy: { at: "desc" }, select: { lat: true, lng: true, at: true } });
    let prev: { lat: number; lng: number; at: Date } | null = prevRow;
    if (!prev) {
      const plant = trip.pickupLat == null ? await db.companySettings.findUnique({ where: { id: "main" }, select: { lat: true, lng: true } }) : null;
      const lat = trip.pickupLat ?? plant?.lat, lng = trip.pickupLng ?? plant?.lng;
      if (trip.loadedAt && lat != null && lng != null) prev = { lat, lng, at: trip.loadedAt };
    }
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
    if (accepted.length) {
      // Parallel ikki so'rov bir xil nuqtani yozsa — unique (tripId, at) ikkinchisini o'tkazib yuboradi
      const res = await db.tripPosition.createMany({ data: accepted, skipDuplicates: true });
      duplicates += accepted.length - res.count;
    }
  }

  if (accepted.length) {
    const last = accepted[accepted.length - 1]!;
    // Oxirgi nuqta — faqat haqiqatan yangisi bo'lsa (eski bufer oxirgi joyni orqaga surmasin)
    await db.trip.updateMany({
      where: { id: tripId, OR: [{ lastAt: null }, { lastAt: { lt: last.at } }] },
      data: { lastLat: last.lat, lastLng: last.lng, lastSpeedKmh: last.speedKmh, lastHeading: last.heading, lastAt: last.at },
    });
    // Yetkazilgandan keyin kelgan bufer — yakun qayta hisoblanadi
    if (done) await saveTripSummarySafe(tripId);
    else await checkArrival(user.id, tripId, trip, accepted);
  }

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

  const out: TrackResult = { ok: true, accepted: accepted.length, dropped, duplicates, ...(rejected ? { rejected } : {}) };
  if (!done) out.lastSeenAt = seen.toISOString();
  // Yetkazilgan reys: shu to'pda yetkazishgacha bo'lgan yangi foydali nuqta bo'lmasa — bufer tugadi, to'xtatish.
  // Yopilgan reys — har doim to'xtatish (yakun allaqachon hisoblangan).
  if (trip.closedAt) return { ...out, stop: true, reason: "CLOSED" };
  if (done && rows.length === 0) return { ...out, stop: true, reason: "DELIVERED" };
  return out;
}

/**
 * Obyektga yetib kelish (geofence): izning obyekt nuqtasidan 300 m ichiga kirgan birinchi nuqtasi.
 * Logistikaga BIR MARTA xabar (`arrivalNotifiedAt` shartli yoziladi — parallel so'rovlar ikki marta yubormaydi).
 * Yo'ldagi (ON_ROAD) reysda "Obyektga keldi" bosqichi bo'sh bo'lsa — shu nuqta vaqti bilan qo'yiladi;
 * LOADED reysning holati o'zgartirilmaydi (yo'lga chiqishni haydovchi/logist belgilaydi), faqat xabar ketadi.
 */
async function checkArrival(
  userId: string, tripId: string,
  trip: { status: string; arrivedAt: Date | null; arrivalNotifiedAt: Date | null; deliveryNoteNo: string; order: { lat: number | null; lng: number | null; orderNo: string; site: { lat: number | null; lng: number | null } | null }; vehicle: { plate: string }; driver: { fullName: string } },
  rows: Row[],
) {
  if (trip.arrivalNotifiedAt || !["LOADED", "ON_ROAD"].includes(trip.status)) return;
  const dest = knownPoint(trip.order.lat, trip.order.lng) ?? knownPoint(trip.order.site?.lat, trip.order.site?.lng);
  if (!dest) return;
  const hit = rows.find((r) => haversineMeters(r.lat, r.lng, dest.lat, dest.lng) <= SITE_RADIUS_M);
  if (!hit) return;
  const claim = await db.trip.updateMany({ where: { id: tripId, arrivalNotifiedAt: null }, data: { arrivalNotifiedAt: new Date() } });
  if (claim.count !== 1) return;
  const at = new Date(Math.min(hit.at.getTime(), Date.now()));
  if (trip.status === "ON_ROAD" && !trip.arrivedAt) {
    const r = await db.trip.updateMany({ where: { id: tripId, status: "ON_ROAD", arrivedAt: null }, data: { arrivedAt: at } });
    if (r.count) await audit(db, userId, "UPDATE", "Trip", tripId, { phase: "ON_ROAD" }, { phase: "ARRIVED", note: `GPS: obyektdan ${SITE_RADIUS_M} m ichida` });
  }
  const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  notifyAfter(() => notifyRoles(["LOGISTICS"], {
    type: "TRIP_ARRIVED",
    title: `Obyektga yetib keldi — ${trip.deliveryNoteNo}`,
    body: `${trip.vehicle.plate} · ${trip.driver.fullName} · ${trip.order.orderNo} · ${hhmm}`,
    link: { key: "trips", id: tripId },
    channel: "oddiy",
  }));
}
