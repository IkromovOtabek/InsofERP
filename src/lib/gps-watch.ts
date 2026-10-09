import { db } from "@/lib/db";
import { notifyRoles } from "@/lib/notify";
import { minutesLabel } from "@/lib/logistics";
import { freezeMissingSummaries, saveTripSummary } from "@/lib/trip-summary";
import { haversineMeters } from "@/lib/geo";
import {
  decideOffRoute, decideWatch, decodePolyline, groupBy, lastSeenStationary, standingSince, validPoint, type GpsPoint, type LatLng,
} from "@/lib/trip-track";

/**
 * GPS davriy tekshiruvi — har daqiqada (`instrumentation.ts` dagi taymer yoki `npm run gps:watch`).
 *
 * Yo'ldagi (ON_ROAD, obyektga hali yetmagan) va yuklangan (LOADED) reyslar bo'yicha uchta holat — Insof ECO
 * `shipment-alerts.ts` qoidasi:
 *  - SILENT    — telefondan oxirgi aloqa (nuqta yoki "tirikman") `gpsSilentMin` dan eski;
 *  - STOP      — mashina `stopAlertMin` daqiqadan beri 150 m radiusdan chiqmagan. LOADED reysda — faqat
 *                yuklash joyi (zavod) geozonasidan TASHQARIDA: zavodda yuklash va navbat odatiy hol;
 *  - OFF_ROUTE — rejadagi yo'ldan `offRouteM` metrdan uzoqda (kamida 3 nuqta, 2 daqiqa); faqat ON_ROAD.
 * Holat boshlanganda `TripAlert` ochiladi va logistikaga BIR MARTA xabar ketadi; holat o'tgach
 * (GPS qaytdi / mashina yurdi / yo'lga qaytdi / reys yetib keldi yoki yopildi) yozuv o'zi yopiladi.
 *
 * Ko'p korxonali server: har korxona alohida jarayon va alohida baza — har jarayon o'z bazasini tekshiradi.
 * Bitta bazaga ikki jarayon ulangan bo'lsa (deploy paytida eski va yangi reliz) ikki marta ishlamasligi uchun:
 * Postgres advisory lock (bir vaqtda bittasi) + `CompanySettings.gpsWatchAt` (daqiqasiga bir marta).
 *
 * Kuniga bir marta shu yerda tozalash ham: 90 kundan eski nuqtalar — faqat yakuni saqlangan reyslarniki.
 * Har tekshiruvda: yakuni saqlanmay qolgan yetkazilgan/bekor qilingan reyslarga yakun qayta hisoblanadi.
 */

const LOCK_KEY = 7_402_031;
/** Ikki tekshiruv orasida kamida — boshqa jarayon hozirgina ishlagan bo'lsa o'tkazib yuboriladi. */
const MIN_GAP_MS = 50_000;
export const KEEP_POSITIONS_DAYS = 90;
const CLEANUP_EVERY_MS = 24 * 3600_000;

export type AlertKind = "SILENT" | "STOP" | "OFF_ROUTE";
export const ALERT_TITLE: Record<AlertKind, string> = { SILENT: "GPS jim", STOP: "Uzoq turibdi", OFF_ROUTE: "Yo'ldan chiqdi" };

export type WatchReport = {
  checked: number;
  opened: { tripId: string; kind: AlertKind }[];
  closed: { tripId: string; kind: AlertKind }[];
  cleanup: { summarized: number; deleted: number } | null;
  /** Shu tekshiruvda qayta saqlangan yakunlar (yetkazishda xato bo'lgan). */
  frozen?: number;
};

/**
 * Bitta tekshiruv. `force` — daqiqalik chegarani e'tiborsiz qoldirish (test, qo'lda ishga tushirish);
 * advisory lock baribir amal qiladi. Boshqa jarayon ishlayotgan bo'lsa — null.
 */
export async function gpsWatchTick(opts: { now?: Date; force?: boolean; cleanup?: boolean } = {}): Promise<WatchReport | null> {
  const now = opts.now ?? new Date();
  return db.$transaction(async (tx) => {
    const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
    if (!ok) return null;
    const s = await db.companySettings.findUnique({ where: { id: "main" } });
    if (!opts.force && s?.gpsWatchAt && now.getTime() - s.gpsWatchAt.getTime() < MIN_GAP_MS) return null;
    await db.companySettings.upsert({ where: { id: "main" }, create: { id: "main", gpsWatchAt: now }, update: { gpsWatchAt: now } });

    // Zavod geozonasi — davomatdagi bilan bir xil (`workplace()`, lib/self-attendance.ts: "Zavod joyi" + "Davomat radiusi").
    // O'sha modul bu yerga import qilinmaydi: gps-watch `instrumentation.ts` dan yuklanadi va u yerda og'ir importlar build'ni buzadi
    const plantAt = s?.lat != null && s?.lng != null ? { lat: s.lat, lng: s.lng } : null;
    const plant = plantAt && validPoint(plantAt) ? { ...plantAt, radiusM: Math.max(50, Math.min(5000, s?.attendanceRadiusM || 300)) } : null;
    const report = await watchTrips(now, { silentMin: s?.gpsSilentMin ?? 15, stopMin: s?.stopAlertMin ?? 20, offRouteM: s?.offRouteM ?? 500, plant });
    report.frozen = await freezeMissingSummaries().catch((e) => { console.error("[gps-watch] yakun", e); return 0; });
    const due = opts.cleanup ?? (!s?.gpsCleanupAt || now.getTime() - s.gpsCleanupAt.getTime() >= CLEANUP_EVERY_MS);
    if (due) {
      report.cleanup = await cleanupPositions(now);
      await db.companySettings.update({ where: { id: "main" }, data: { gpsCleanupAt: now } });
    }
    return report;
  }, { timeout: 10 * 60_000, maxWait: 10_000 });
}

async function watchTrips(now: Date, cfg: { silentMin: number; stopMin: number; offRouteM: number; plant: (LatLng & { radiusM: number }) | null }): Promise<WatchReport> {
  const report: WatchReport = { checked: 0, opened: [], closed: [], cleanup: null };
  const trips = await db.trip.findMany({
    where: { OR: [{ status: "ON_ROAD", arrivedAt: null }, { status: "LOADED" }] },
    select: {
      id: true, deliveryNoteNo: true, status: true, pickupLat: true, pickupLng: true, departedAt: true, loadedAt: true, lastSeenAt: true, lastAt: true, lastLat: true, lastLng: true, lastSpeedKmh: true,
      gpsPlatform: true, plannedRoute: true, ecoDeliveryId: true,
      vehicle: { select: { plate: true } }, driver: { select: { fullName: true } },
    },
  });
  report.checked = trips.length;
  const ids = trips.map((t) => t.id);

  // Ochiq ogohlantirishlar: kuzatuvdan chiqqan reyslarniki (yetib keldi, yetkazildi, yopildi) — yopiladi
  const open = await db.tripAlert.findMany({ where: { closedAt: null }, select: { id: true, tripId: true, kind: true } });
  const watched = new Set(ids);
  const gone = open.filter((a) => !watched.has(a.tripId));
  if (gone.length) {
    await db.tripAlert.updateMany({ where: { id: { in: gone.map((a) => a.id) } }, data: { closedAt: now } });
    for (const a of gone) report.closed.push({ tripId: a.tripId, kind: a.kind as AlertKind });
  }
  if (!trips.length) return report;
  const openBy = groupBy(open.filter((a) => watched.has(a.tripId)), (a) => a.tripId);

  // Oxirgi nuqtalar — bitta so'rovda, guruhlash O(n). Oyna turish chegarasidan uzunroq bo'lsin
  const windowMin = Math.max(40, cfg.stopMin + 10);
  const pts = await db.tripPosition.findMany({
    where: { tripId: { in: ids }, at: { gte: new Date(now.getTime() - windowMin * 60_000), lte: new Date(now.getTime() + 2 * 60_000) } },
    orderBy: { at: "asc" }, select: { tripId: true, lat: true, lng: true, at: true, speedKmh: true },
  });
  const byTrip = groupBy(pts, (p) => p.tripId);

  for (const t of trips) {
    let points: GpsPoint[] = byTrip.get(t.id) ?? [];
    // Oynada nuqta yo'q, lekin oxirgi nuqta ma'lum (telefon turibdi va faqat "tirikman" yuboryapti)
    if (!points.length && t.lastAt && t.lastLat != null && t.lastLng != null) points = [{ lat: t.lastLat, lng: t.lastLng, at: t.lastAt, speedKmh: t.lastSpeedKmh }];
    const mine = openBy.get(t.id) ?? [];
    const openOf = (k: AlertKind) => mine.find((a) => a.kind === k) ?? null;

    // ECO'ga yuborilgan va ERP'ga birorta ham signal kelmagan reys — haydovchi ECO ilovasida, uni ECO kuzatadi
    const ecoOnly = !!t.ecoDeliveryId && !t.lastSeenAt && !t.lastAt;
    const w = decideWatch({
      now, departedAt: t.departedAt ?? t.loadedAt, lastSeenAt: t.lastSeenAt ?? t.lastAt,
      iosStill: t.gpsPlatform === "ios" && lastSeenStationary(points),
      standingSince: points.length ? standingSince(points) : null,
      silentMin: cfg.silentMin, stopMin: cfg.stopMin,
      silentOpen: !!openOf("SILENT"), stopOpen: !!openOf("STOP"),
    });
    const loaded = t.status === "LOADED";
    // Yuklangan reys: yuklash joyi (pickup, bo'lmasa zavod) radiusida yoki joyi noma'lum — turish baholanmaydi
    if (loaded && w.stop !== "close" && !outsideLoadingZone(points[points.length - 1] ?? null, pickupOf(t), cfg.plant)) {
      w.stop = openOf("STOP") ? "close" : null;
    }
    const route = decodePolyline(t.plannedRoute);
    const off = loaded ? { distanceM: null, since: null, action: null } : decideOffRoute({ now, route, points, offRouteM: cfg.offRouteM, open: !!openOf("OFF_ROUTE") });

    const who = `${t.vehicle.plate} · ${t.driver.fullName}`;
    const todo: [AlertKind, "open" | "close" | null, string, Date | null][] = [
      ["SILENT", ecoOnly ? null : w.silent, `${minutesLabel(w.silentMin)} dan beri telefondan signal yo'q · ${who}`, t.lastSeenAt ?? t.lastAt ?? t.departedAt],
      ["STOP", w.stop, `${minutesLabel(w.stoppedMin)} dan beri bir joyda turibdi · ${who}`, points.length ? standingSince(points) : null],
      ["OFF_ROUTE", off.action, `rejadagi yo'ldan ${off.distanceM ?? "?"} m uzoqda · ${who}`, off.since],
    ];
    for (const [kind, action, info, since] of todo) {
      if (action === "close") {
        const a = openOf(kind);
        if (a) { await db.tripAlert.update({ where: { id: a.id }, data: { closedAt: now } }); report.closed.push({ tripId: t.id, kind }); }
      } else if (action === "open") {
        await db.tripAlert.create({ data: { tripId: t.id, kind, openedAt: now, since, info } });
        report.opened.push({ tripId: t.id, kind });
        await notifyRoles(["LOGISTICS"], {
          type: `TRIP_${kind}`,
          title: `${ALERT_TITLE[kind]} — ${t.deliveryNoteNo}`,
          body: info,
          link: { key: "trips", id: t.id },
        }).catch((e) => console.error("[gps-watch] xabar", e));
      }
    }
  }
  return report;
}

const pickupOf = (t: { pickupLat: number | null; pickupLng: number | null }): LatLng | null =>
  t.pickupLat != null && t.pickupLng != null && validPoint({ lat: t.pickupLat, lng: t.pickupLng }) ? { lat: t.pickupLat, lng: t.pickupLng } : null;

/**
 * Mashina yuklash joyi geozonasidan tashqaridami. Nuqta: yuk olingan joy (pickup) — zavod radiusi bilan,
 * bo'lmasa zavodning o'zi. Joy yoki geozona noma'lum — false (zavoddadir deb hisoblanadi, ogohlantirish yo'q).
 */
export function outsideLoadingZone(
  pos: { lat: number; lng: number } | null,
  pickup: { lat: number; lng: number } | null,
  plant: { lat: number; lng: number; radiusM: number } | null,
  defaultRadiusM = 300,
): boolean {
  const zone = pickup ? { ...pickup, radiusM: plant?.radiusM ?? defaultRadiusM } : plant;
  if (!pos || !zone) return false;
  return haversineMeters(pos.lat, pos.lng, zone.lat, zone.lng) > zone.radiusM;
}

/**
 * 90 kundan eski nuqtalarni o'chirish. Faqat yakuni (`summaryAt`) saqlangan reyslarniki: yakunsiz eski
 * yetkazilgan/bekor qilingan reysga avval yakun hisoblanadi (km va iz hisobotda qoladi).
 */
export async function cleanupPositions(now = new Date()): Promise<{ summarized: number; deleted: number }> {
  const cutoff = new Date(now.getTime() - KEEP_POSITIONS_DAYS * 86_400_000);
  const old = await db.tripPosition.findMany({ where: { at: { lt: cutoff }, trip: { summaryAt: null, status: { in: ["DELIVERED", "CANCELLED"] } } }, distinct: ["tripId"], select: { tripId: true }, take: 500 });
  let summarized = 0;
  for (const { tripId } of old) {
    try { await saveTripSummary(tripId); summarized++; } catch (e) { console.error("[gps-watch] yakun", tripId, e); }
  }
  const del = await db.tripPosition.deleteMany({ where: { at: { lt: cutoff }, trip: { summaryAt: { not: null } } } });
  await db.tripAlert.deleteMany({ where: { closedAt: { lt: cutoff } } });
  return { summarized, deleted: del.count };
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Jarayon ichidagi taymer (`instrumentation.ts`). Har korxona jarayoni o'z bazasini tekshiradi.
 * Test rejimida sukut bo'yicha o'chiq — QA testlari tekshiruvni o'zi chaqiradi (`GPS_WATCH=on` bilan yoqiladi).
 */
export function startGpsWatch(intervalMs = 60_000) {
  if (timer) return;
  const run = () => { gpsWatchTick().catch((e) => console.error("[gps-watch]", e)); };
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 20_000).unref?.();
}
