import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import {
  decodePolyline, encodePolyline, LINE_TOLERANCE_M, simplifyLine, summarizeTrack, TrackAccumulator,
  type GpsPoint, type LatLng, type TrackSummary,
} from "@/lib/trip-track";

/**
 * Reys izi bazada: yakun (km, vaqt, soddalashtirilgan iz) va ochiq reys uchun keshlangan hisob.
 *
 *  - Yopilgan reys (`summaryAt` bor) — hamma raqam Trip ustunlaridan, nuqtalar o'qilmaydi
 *    (90 kundan keyin nuqtalar o'chiriladi — yakun qoladi).
 *  - Ochiq reys — `TrackAccumulator` jarayon xotirasida: har so'rovda faqat yangi kelgan nuqtalar
 *    qo'shiladi. Har korxona alohida jarayon, shuning uchun kesh korxonalar orasida aralashmaydi.
 */

/** Hisob uchun kerakli Trip ustunlari. */
const TRIP_COLS = {
  id: true, status: true, lastLat: true, lastLng: true, lastAt: true, lastSeenAt: true, lastSpeedKmh: true, lastHeading: true,
  distanceKm: true, movingSec: true, totalSec: true, maxSpeedKmh: true, avgSpeedKmh: true, trackLine: true, trackPoints: true, summaryAt: true, trackFirstAt: true,
} as const;

export type TripStat = {
  last: GpsPoint | null;
  meters: number;
  points: number;
  /** Harakat vaqti, daqiqa (eski `TripTrackStat.minutes` bilan mos). */
  minutes: number;
  movingSec: number;
  totalSec: number;
  maxSpeedKmh: number | null;
  avgSpeedKmh: number | null;
  /** Yakundan olinganmi (yopilgan reys) yoki hozir hisoblanganmi. */
  final: boolean;
};

type Entry = { rev: number; acc: TrackAccumulator; maxCreated: Date; builtAt: number };
const cache = new Map<string, Entry>();
/** Kesh shundan eski bo'lsa to'liq qayta quriladi (to'g'ridan-to'g'ri bazaga yozilgan nuqtalar ham ko'rinsin). */
const CACHE_FULL_MS = 2 * 60_000;
const CACHE_MAX = 500;

const SELECT_POINT = { lat: true, lng: true, at: true, speedKmh: true, createdAt: true } as const;

/**
 * Ochiq reysning yig'uvchisi — keshdan, yangi nuqtalar qo'shilgan holda.
 * `rev` — Trip.lastSeenAt: telefon nimadir yuborgandagina o'zgaradi, aks holda bazaga murojaat yo'q.
 */
async function accumulator(tripId: string, rev: number): Promise<TrackAccumulator> {
  const e = cache.get(tripId);
  const now = Date.now();
  if (e && e.rev === rev && now - e.builtAt < CACHE_FULL_MS) return e.acc;
  if (e && now - e.builtAt < CACHE_FULL_MS) {
    const fresh = await db.tripPosition.findMany({ where: { tripId, createdAt: { gt: e.maxCreated } }, orderBy: { at: "asc" }, select: SELECT_POINT });
    const lastAt = e.acc.last?.at.getTime() ?? -Infinity;
    // Hammasi oxirgi nuqtadan keyin — davom ettiramiz; eski bufer kelgan bo'lsa (vaqt orqada) — to'liq qayta
    if (fresh.every((p) => p.at.getTime() > lastAt)) {
      for (const p of fresh) e.acc.push(p);
      if (fresh.length) e.maxCreated = fresh.reduce((m, p) => (p.createdAt > m ? p.createdAt : m), e.maxCreated);
      e.rev = rev;
      return e.acc;
    }
  }
  const all = await db.tripPosition.findMany({ where: { tripId }, orderBy: { at: "asc" }, select: SELECT_POINT });
  const acc = new TrackAccumulator();
  let maxCreated = new Date(0);
  for (const p of all) { acc.push(p); if (p.createdAt > maxCreated) maxCreated = p.createdAt; }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(tripId, { rev, acc, maxCreated, builtAt: now });
  return acc;
}

/** Keshni tashlash — reys yopilganda (yakun endi bazada) yoki test. */
export function forgetTrack(tripId?: string) {
  if (tripId) { cache.delete(tripId); lineMemo.delete(tripId); } else { cache.clear(); lineMemo.clear(); }
}

type TripCols = Prisma.TripGetPayload<{ select: typeof TRIP_COLS }>;

function fromSummary(t: TripCols): TripStat {
  return {
    last: t.lastLat != null && t.lastLng != null && t.lastAt ? { lat: t.lastLat, lng: t.lastLng, at: t.lastAt, speedKmh: t.lastSpeedKmh } : null,
    meters: Math.round((t.distanceKm ?? 0) * 1000),
    points: t.trackPoints ?? 0,
    minutes: Math.round((t.movingSec ?? 0) / 60),
    movingSec: t.movingSec ?? 0, totalSec: t.totalSec ?? 0,
    maxSpeedKmh: t.maxSpeedKmh, avgSpeedKmh: t.avgSpeedKmh, final: true,
  };
}

function fromAcc(acc: TrackAccumulator): TripStat {
  const s = acc.summary();
  return {
    last: acc.last, meters: s.meters, points: s.rawPoints, minutes: s.movingMinutes, movingSec: s.movingSec, totalSec: s.totalSec,
    maxSpeedKmh: s.maxSpeedKmh, avgSpeedKmh: s.avgSpeedKmh, final: false,
  };
}

/**
 * Bir nechta reys statistikasi: yopilganlari yakundan, ochiqlari keshlangan hisobdan.
 * Iz yo'q reys natijada bo'lmaydi (eski `tripTrackStats` bilan bir xil xulq).
 */
export async function tripStats(tripIds: string[]): Promise<Map<string, TripStat>> {
  const out = new Map<string, TripStat>();
  if (tripIds.length === 0) return out;
  const trips = await db.trip.findMany({ where: { id: { in: [...new Set(tripIds)] } }, select: TRIP_COLS });
  await Promise.all(trips.map(async (t) => {
    if (t.summaryAt) {
      if (t.trackPoints) out.set(t.id, fromSummary(t));
      return;
    }
    const acc = await accumulator(t.id, t.lastSeenAt?.getTime() ?? 0);
    if (acc.raw > 0 && acc.last) out.set(t.id, fromAcc(acc));
  }));
  return out;
}

/** Saqlanadigan yakun: statistika + soddalashtirilgan iz. */
export type StoredSummary = TrackSummary & { line: LatLng[]; polyline: string };

export function buildSummary(points: GpsPoint[]): StoredSummary {
  const s = summarizeTrack(points);
  const line = simplifyLine(s.kept, LINE_TOLERANCE_M).map((p) => ({ lat: p.lat, lng: p.lng }));
  return { ...s, line, polyline: encodePolyline(line) };
}

/**
 * Reys yakunini hisoblab saqlash — yetkazilganda, yopilganda, kech kelgan nuqtalardan keyin va
 * tozalashdan oldin. Iz bo'lmasa ham `summaryAt` qo'yiladi (distanceKm = null) — qayta-qayta hisoblanmasin.
 */
export async function saveTripSummary(tripId: string): Promise<StoredSummary | null> {
  const pts = await db.tripPosition.findMany({ where: { tripId }, orderBy: { at: "asc" }, select: { lat: true, lng: true, at: true, speedKmh: true, heading: true } });
  const s = buildSummary(pts);
  const last = pts[pts.length - 1];
  await db.trip.update({
    where: { id: tripId },
    data: {
      distanceKm: pts.length ? s.distanceKm : null,
      movingSec: pts.length ? s.movingSec : null,
      totalSec: pts.length ? s.totalSec : null,
      trackFirstAt: s.firstAt,
      maxSpeedKmh: s.maxSpeedKmh,
      avgSpeedKmh: s.avgSpeedKmh,
      trackLine: pts.length ? s.polyline : null,
      trackPoints: pts.length,
      summaryAt: new Date(),
      ...(last ? { lastLat: last.lat, lastLng: last.lng, lastAt: last.at, lastSpeedKmh: last.speedKmh, lastHeading: last.heading } : {}),
    },
  });
  forgetTrack(tripId);
  return pts.length ? s : null;
}

/** Xato yakun hisobini to'xtatmasin — holat o'tishi (yetkazildi/yopildi) muhimroq. */
export async function saveTripSummarySafe(tripId: string) {
  try { await saveTripSummary(tripId); } catch (e) { console.error("[trip-summary]", tripId, e); }
}

/**
 * Yakuni yo'q yetkazilgan reyslarga yakun hisoblash (hisobot, haydovchi km, tozalash oldidan).
 * Bir chaqiruvda `limit` tadan — eski bazada minglab reys bo'lsa so'rov cho'zilib ketmasin.
 */
export async function ensureTripSummaries(tripIds: string[], limit = 200): Promise<number> {
  if (tripIds.length === 0) return 0;
  const missing = await db.trip.findMany({ where: { id: { in: tripIds }, status: "DELIVERED", summaryAt: null }, select: { id: true }, take: limit });
  for (const t of missing) await saveTripSummarySafe(t.id);
  return missing.length;
}

/** Yakunlangan holatlar: yetkazilgan yoki bekor qilingan reysning izi endi o'zgarmaydi (`final`). */
export const FINISHED_STATUSES = ["DELIVERED", "CANCELLED"] as const;
export const isFinishedStatus = (status: string) => (FINISHED_STATUSES as readonly string[]).includes(status);

/**
 * Yakuni saqlanmay qolgan yakunlangan reyslar (yetkazishdagi `saveTripSummarySafe` xatoga uchragan) —
 * davriy tekshiruv (`lib/gps-watch.ts`) har daqiqada qayta urinadi. Iz yo'q reysga ham `summaryAt`
 * qo'yiladi, shuning uchun har reys bir marta ko'riladi; xato bo'lsa keyingi tekshiruvda yana.
 * Faqat izi bor (`lastSeenAt`/`lastAt`) reyslar — GPS'dan oldingi eski reyslar navbatni egallamasin.
 */
export async function freezeMissingSummaries(limit = 20): Promise<number> {
  const missing = await db.trip.findMany({
    where: { status: { in: [...FINISHED_STATUSES] }, summaryAt: null, OR: [{ lastAt: { not: null } }, { lastSeenAt: { not: null } }] },
    orderBy: { createdAt: "desc" }, select: { id: true }, take: limit,
  });
  let ok = 0;
  for (const t of missing) {
    try { await saveTripSummary(t.id); ok++; } catch (e) { console.error("[trip-summary] qayta", t.id, e); }
  }
  return ok;
}

/** Reys km (GPS izi bo'yicha) — yakundan, bo'lmasa hisoblab. Iz yo'q — null. */
export async function tripKmMap(tripIds: string[]): Promise<Map<string, number>> {
  await ensureTripSummaries(tripIds, 500);
  const stats = await tripStats(tripIds);
  return new Map([...stats].map(([id, s]) => [id, s.meters / 1000]));
}

/**
 * Haydovchi km (ish haqi, haydovchi ekrani): zavod → obyekt → zavod = bir tomon × 2.
 * Bir tomon — GPS izi bo'yicha (`Trip.distanceKm`; yakunsiz yetkazilgan reysga hozir hisoblanadi).
 * Iz yo'q yoki taxminiy masofaning yarmidan kam bo'lsa (telefon yo'lda o'chgan — iz to'liq emas) —
 * zayavkadagi taxminiy masofa (`Order.distanceKm`), avvalgidek.
 */
export async function tripPayKm(trips: { id: string; distanceKm?: number | null; summaryAt?: Date | null; order: { distanceKm: unknown } }[]): Promise<Map<string, number>> {
  const need = trips.filter((t) => !t.summaryAt).map((t) => t.id);
  const fresh = new Map<string, number | null>();
  if (need.length) {
    await ensureTripSummaries(need, 500);
    for (const r of await db.trip.findMany({ where: { id: { in: need } }, select: { id: true, distanceKm: true } })) fresh.set(r.id, r.distanceKm);
  }
  const out = new Map<string, number>();
  for (const t of trips) {
    const gps = fresh.has(t.id) ? fresh.get(t.id) : t.distanceKm;
    const est = Number(t.order.distanceKm ?? 0);
    out.set(t.id, (gps != null && gps > 0 && gps >= est / 2 ? gps : est) * 2);
  }
  return out;
}

/** Saqlangan rejadagi yo'l. */
export const plannedLine = (s: string | null | undefined) => decodePolyline(s);

/** Reys raqamlari (chiziqsiz). */
export type TrackNumbers = {
  /** Yakun saqlanganmi (`summaryAt`). Javobdagi `final` esa reys holatidan (`lib/mobile/trip-track.ts`). */
  final: boolean;
  /** Izning birinchi va oxirgi nuqtasi vaqti (nuqta yo'q — null). */
  firstAt: Date | null;
  lastAt: Date | null;
  meters: number; distanceKm: number; totalSec: number; movingSec: number;
  avgSpeedKmh: number | null; maxSpeedKmh: number | null; points: number;
};

export type TrackDetail = TrackNumbers & { line: LatLng[]; polyline: string };

const lineMemo = new Map<string, { raw: number; line: LatLng[]; polyline: string }>();

/**
 * Bitta reysning izi (soddalashtirilgan) va statistikasi: yopilgan reysda saqlangan yakundan,
 * ochiqda keshlangan yig'uvchidan (soddalashtirish ham nuqtalar soni o'zgarmaguncha keshda).
 */
export async function tripTrackDetail(tripId: string): Promise<TrackDetail | null> {
  const t = await db.trip.findUnique({ where: { id: tripId }, select: TRIP_COLS });
  if (!t) return null;
  if (t.summaryAt) {
    return { ...closedNumbers(t), firstAt: t.trackPoints ? await summaryFirstAt(t) : null, line: decodePolyline(t.trackLine), polyline: t.trackLine ?? "" };
  }
  const acc = await accumulator(tripId, t.lastSeenAt?.getTime() ?? 0);
  let memo = lineMemo.get(tripId);
  if (!memo || memo.raw !== acc.raw) {
    const line = simplifyLine(acc.kept, LINE_TOLERANCE_M).map((p) => ({ lat: p.lat, lng: p.lng }));
    memo = { raw: acc.raw, line, polyline: encodePolyline(line) };
    if (lineMemo.size >= CACHE_MAX) lineMemo.delete(lineMemo.keys().next().value!);
    lineMemo.set(tripId, memo);
  }
  return { ...openNumbers(acc), line: memo.line, polyline: memo.polyline };
}

/** Yopilgan reys raqamlari — Trip ustunlaridan (`trip-track` va `trip-track/summary` bir xil). */
function closedNumbers(t: TripCols): TrackNumbers {
  return {
    final: true, firstAt: t.trackPoints ? t.trackFirstAt : null, lastAt: t.trackPoints ? t.lastAt : null,
    meters: Math.round((t.distanceKm ?? 0) * 1000), distanceKm: t.distanceKm ?? 0, totalSec: t.totalSec ?? 0, movingSec: t.movingSec ?? 0,
    avgSpeedKmh: t.avgSpeedKmh, maxSpeedKmh: t.maxSpeedKmh != null ? Math.round(t.maxSpeedKmh) : null, points: t.trackPoints ?? 0,
  };
}

/**
 * Yakundagi izning birinchi nuqtasi vaqti. Ustun bo'sh bo'lsa (ustundan oldingi yakun) — nuqtalardan,
 * ular ham o'chirilgan bo'lsa oxirgi nuqta − umumiy vaqt; topilgani saqlab qo'yiladi (keyingi so'rov ustundan).
 */
async function summaryFirstAt(t: TripCols): Promise<Date | null> {
  if (t.trackFirstAt) return t.trackFirstAt;
  const p = await db.tripPosition.findFirst({ where: { tripId: t.id }, orderBy: { at: "asc" }, select: { at: true } });
  const at = p?.at ?? (t.lastAt && t.totalSec != null ? new Date(t.lastAt.getTime() - t.totalSec * 1000) : null);
  if (at) await db.trip.updateMany({ where: { id: t.id, trackFirstAt: null }, data: { trackFirstAt: at } }).catch(() => undefined);
  return at;
}

/** Ochiq reys raqamlari — keshlangan yig'uvchidan. */
function openNumbers(acc: TrackAccumulator): TrackNumbers {
  const s = acc.summary();
  return {
    final: false, firstAt: s.firstAt, lastAt: s.lastAt, meters: s.meters, distanceKm: s.distanceKm, totalSec: s.totalSec, movingSec: s.movingSec,
    avgSpeedKmh: s.avgSpeedKmh, maxSpeedKmh: s.maxSpeedKmh, points: s.rawPoints,
  };
}

/**
 * Bir nechta reys raqamlari (chiziqsiz) — ro'yxat ekrani uchun ("Mening reyslarim").
 * Bitta `findMany`: yopilganlari Trip ustunlaridan (nuqtalar o'qilmaydi), ochiqlari keshlangan yig'uvchidan.
 * `driverId` berilsa — faqat shu haydovchining reyslari (begona id natijada shunchaki bo'lmaydi).
 * Iz yo'q reys ham natijada (nol qiymatlar bilan) — `tripTrackDetail` bilan bir xil.
 */
export async function tripTrackSummaries(tripIds: string[], driverId?: string): Promise<Map<string, TrackNumbers & { status: string }>> {
  const out = new Map<string, TrackNumbers & { status: string }>();
  if (tripIds.length === 0) return out;
  const trips = await db.trip.findMany({
    where: { id: { in: [...new Set(tripIds)] }, ...(driverId ? { driverId } : {}) },
    select: TRIP_COLS,
  });
  await Promise.all(trips.map(async (t) => {
    const n = t.summaryAt ? closedNumbers(t) : openNumbers(await accumulator(t.id, t.lastSeenAt?.getTime() ?? 0));
    out.set(t.id, { ...n, status: t.status });
  }));
  return out;
}
