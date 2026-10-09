/**
 * QA (C) — haydovchi GPS kuzatuvi: `/api/mobile/track` (yumshoq tekshiruv, takror, reys oynasi, stop, "tirikman",
 * aniqlik), reys yakuni (ECO algoritmi bilan bir xil km), `/api/mobile/trip-track`, fleet yangi maydonlari,
 * obyektga yetib kelish (300 m, bir marta xabar), davriy tekshiruv (GPS jim / turish / yo'ldan chiqish),
 * logistika sozlamalari validatsiyasi, 90 kunlik tozalash va hisobot/haydovchi km.
 *
 *   DATABASE_URL=… QA_BASE=http://localhost:3203 npx tsx scripts/qa/c-gps.ts
 *
 * Server test rejimida (INSOF_ENV=test) — jarayon taymeri o'chiq, davriy tekshiruvni test o'zi chaqiradi.
 */
import { api, check, done, section, tok } from "./c-lib";
import { db } from "@/lib/db";
import { haversineMeters } from "@/lib/geo";
import { decodePolyline, encodePolyline, simplifyLine, summarizeTrack } from "@/lib/trip-track";
import { saveTripSummary, tripKmMap, tripPayKm } from "@/lib/trip-summary";
import { tripDelivered, tripTrack } from "@/lib/trips";
import { cleanupPositions, gpsWatchTick } from "@/lib/gps-watch";

// Push himoyasi test rejimiga tayanadi (`lib/push.ts` → externalAllowed) — skript ham test rejimida
process.env.INSOF_ENV = "test";
const stamp = Date.now().toString(36);
const msg = (r: { json: any; text: string }) => r.json ?? r.text.slice(0, 200); // eslint-disable-line @typescript-eslint/no-explicit-any
const M_PER_DEG = 111_195;
/** Shimolga `m` metr. */
const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / M_PER_DEG, lng: p.lng });
/** Sharqqa `m` metr (shu kenglikda). */
const east = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat, lng: p.lng + m / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)) });
const ago = (ms: number) => new Date(Date.now() - ms);
const MIN = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── ECO'dagi `summarizeTrack` (apps/api/src/modules/shipments/shipment-track.ts) — so'zma-so'z nusxa, solishtirish uchun ──
function ecoSummarize(raw: { lat: number; lng: number; at: Date; speedKmh?: number | null }[]) {
  const MIN_STEP_M = 15, MAX_KMH = 180, MOVING_KMH = 4, MAX_GAP_MS = 5 * 60_000;
  const pts = raw.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0));
  const kept: typeof pts = [];
  let meters = 0, movingMs = 0, maxSpeed: number | null = null;
  for (const p of pts) {
    const prev = kept[kept.length - 1];
    if (!prev) { kept.push(p); continue; }
    const step = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);
    if (step < MIN_STEP_M) continue;
    const dtMs = p.at.getTime() - prev.at.getTime();
    const kmh = dtMs > 0 ? (step / 1000) / (dtMs / 3_600_000) : Infinity;
    if (kmh > MAX_KMH) continue;
    kept.push(p);
    meters += step;
    if (kmh >= MOVING_KMH && dtMs <= MAX_GAP_MS) movingMs += dtMs;
    if (p.speedKmh != null && p.speedKmh <= MAX_KMH && (maxSpeed == null || p.speedKmh > maxSpeed)) maxSpeed = p.speedKmh;
  }
  return { meters: Math.round(meters), distanceKm: Math.round(meters / 100) / 10, movingMinutes: Math.round(movingMs / 60_000), maxSpeedKmh: maxSpeed != null ? Math.round(maxSpeed) : null, kept: kept.length };
}

/** ECO spec namunasi: shimolga har `dtS` soniyada `stepM` metr. */
const t0 = Date.parse("2026-10-09T08:00:00Z");
const line = (n: number, stepM: number, dtS: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ lat: 41 + ((from + i) * stepM) / 111_195, lng: 69.2, at: new Date(t0 + (from + i) * dtS * 1000) }));

async function main() {
  const drvUser = await db.user.findUniqueOrThrow({ where: { login: "test.haydovchi" }, include: { employee: true } });
  const drvEmp = drvUser.employee!.id;
  const drv = await tok("test.haydovchi");
  const lg = await tok("test.logistika");
  const sotuv = await tok("test.sotuv");
  const logUser = await db.user.findUniqueOrThrow({ where: { login: "test.logistika" } });
  const otherEmp = (await db.employee.findFirst({ where: { id: { not: drvEmp }, isActive: true }, select: { id: true } }))!.id;
  const order = await db.order.findFirstOrThrow({ where: { kind: "SALE" }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const vehicle = await db.vehicle.findFirstOrThrow({ where: { type: "MIXER" }, select: { id: true } });

  // Obyekt (DEST) bazadan ~30 km sharqda — kuzatuv sinovlari tasodifan "yetib keldi" bo'lmasin
  const BASE = { lat: 41.2, lng: 69.1 };
  const DEST = east(BASE, 30_000);
  await db.order.update({ where: { id: order.id }, data: { lat: DEST.lat, lng: DEST.lng } });

  let seq = 0;
  const mkTrip = (data: Record<string, unknown>) => db.trip.create({
    data: {
      deliveryNoteNo: `QA-GPS-${stamp}-${++seq}`, orderId: order.id, vehicleId: vehicle.id, driverId: drvEmp, qtyM3: 1,
      status: "ON_ROAD", loadedAt: ago(60 * MIN), departedAt: ago(55 * MIN), pickupLat: BASE.lat, pickupLng: BASE.lng, ...data,
    } as never,
  });
  const track = (tripId: string, points: unknown[], extra: Record<string, unknown> = {}, token = drv) =>
    api("POST", "/api/mobile/track", { token, body: { tripId, points, ...extra } });
  const pt = (p: { lat: number; lng: number }, at: Date, x: Record<string, unknown> = {}): { lat: number; lng: number; at: string; speedKmh?: number } => ({ lat: p.lat, lng: p.lng, at: at.toISOString(), ...x });
  const count = (tripId: string) => db.tripPosition.count({ where: { tripId } });

  // ─────────────────────────────────────────────────────────────
  section("track: yumshoq tekshiruv — bitta yomon maydon to'pni rad etmaydi");
  const A = await mkTrip({});
  const a = (i: number) => north(BASE, i * 400); // 400 m / 30 s ≈ 48 km/soat
  const T = Date.now();
  const aAt = (i: number) => new Date(T - 10 * MIN + i * 30_000);
  let r = await track(A.id, [
    pt(a(0), aAt(0), { speedKmh: 40, heading: 10 }),
    pt(a(1), aAt(1), { speedKmh: 45, heading: -1 }),
    pt(a(2), aAt(2), { speedKmh: -5, heading: 400 }),
    pt(a(3), aAt(3), { speedKmh: null, heading: "NaN" }),
  ]);
  check("noto'g'ri heading/speed → 200, 4 ta qabul", r.status === 200 && r.json?.ok === true && r.json?.accepted === 4 && r.json?.dropped === 0, msg(r));
  const rowsA = await db.tripPosition.findMany({ where: { tripId: A.id }, orderBy: { at: "asc" } });
  check("heading -1 / 400 / \"NaN\" → null, speed -5 / null → null", rowsA[1]?.heading == null && rowsA[2]?.heading == null && rowsA[2]?.speedKmh == null && rowsA[3]?.speedKmh == null && rowsA[0]?.heading === 10, rowsA.map((x) => [x.speedKmh, x.heading]));
  r = await track(A.id, [pt(a(4), aAt(4)), { lat: 999, lng: 69, at: aAt(5).toISOString() }, { lat: 0, lng: 0, at: aAt(5).toISOString() }, { lng: 69.1, at: aAt(5).toISOString() }, "x"]);
  check("koordinatasi buzuq 4 ta nuqta tashlandi, yaxshisi qabul (accepted 1, dropped 4)", r.status === 200 && r.json?.accepted === 1 && r.json?.dropped === 4, msg(r));

  section("track: accuracy");
  r = await track(A.id, [pt(a(5), aAt(5), { accuracy: 150 }), pt(a(6), aAt(6), { accuracy: 20 })]);
  check("accuracy 150 m tashlandi, 20 m qabul", r.json?.accepted === 1 && r.json?.dropped === 1, msg(r));
  const acc = await db.tripPosition.findFirst({ where: { tripId: A.id, at: aAt(6) } });
  check("accuracy saqlandi (20)", acc?.accuracy === 20, acc?.accuracy);
  check("accuracy 150 li nuqta bazada yo'q", (await db.tripPosition.count({ where: { tripId: A.id, at: aAt(5) } })) === 0);

  section("track: takroriy yuborish yozilmaydi");
  const before = await count(A.id);
  const batch = [pt(a(7), aAt(7)), pt(a(8), aAt(8)), pt(a(8), aAt(8))];
  r = await track(A.id, batch);
  check("yangi to'p: 2 qabul, ichidagi takror tashlandi", r.json?.accepted === 2 && r.json?.dropped === 1, msg(r));
  r = await track(A.id, batch);
  check("aynan shu to'p qayta → accepted 0, duplicates 2", r.status === 200 && r.json?.accepted === 0 && r.json?.duplicates === 2, msg(r));
  r = await track(A.id, [pt(a(8), aAt(8)), pt(a(9), aAt(9))]);
  check("qisman takror → 1 yangi, 1 duplicate", r.json?.accepted === 1 && r.json?.duplicates === 1, msg(r));
  check("bazada takror yo'q", (await count(A.id)) === before + 3, { before, now: await count(A.id) });
  const dupDb = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM (SELECT "tripId", at FROM "TripPosition" GROUP BY 1, 2 HAVING count(*) > 1) x`;
  check("unique (tripId, at) — butun bazada takror nuqta yo'q", Number(dupDb[0]!.n) === 0, dupDb);

  section("track: reys oynasi (yuklanishdan oldin / kelajak)");
  r = await track(A.id, [pt(a(0), ago(70 * MIN))]);
  check("yuklanishdan 10 daq oldingi nuqta rad (dropped)", r.json?.accepted === 0 && r.json?.dropped === 1, msg(r));
  r = await track(A.id, [pt(a(10), new Date(Date.now() + 10 * MIN))]);
  check("kelajakdagi (10 daq) nuqta rad", r.json?.accepted === 0 && r.json?.dropped === 1, msg(r));
  r = await track(A.id, [pt(a(10), aAt(10))]);
  check("oynadagi nuqta qabul", r.json?.accepted === 1, msg(r));

  section("track: oxirgi nuqta va «tirikman»");
  let tA = await db.trip.findUniqueOrThrow({ where: { id: A.id } });
  check("Trip.lastAt = eng yangi nuqta vaqti", tA.lastAt?.getTime() === aAt(10).getTime() && Math.abs((tA.lastLat ?? 0) - a(10).lat) < 1e-9, { lastAt: tA.lastAt, want: aAt(10) });
  r = await track(A.id, [pt(north(BASE, 1400), new Date(aAt(3).getTime() + 15_000))]);
  check("eski bufer nuqtasi (vaqt orqada) qabul qilindi", r.json?.accepted === 1, msg(r));
  tA = await db.trip.findUniqueOrThrow({ where: { id: A.id } });
  check("eski bufer nuqtasi oxirgi nuqtani orqaga surmaydi", tA.lastAt?.getTime() === aAt(10).getTime(), tA.lastAt);
  await db.trip.update({ where: { id: A.id }, data: { lastSeenAt: ago(40 * MIN) } });
  r = await track(A.id, [], { heartbeat: true, platform: "ios" });
  tA = await db.trip.findUniqueOrThrow({ where: { id: A.id } });
  check("bo'sh points + heartbeat → 200, accepted 0", r.status === 200 && r.json?.ok && r.json?.accepted === 0 && !r.json?.stop, msg(r));
  check("lastSeenAt yangilandi (hozir), platforma yozildi", !!tA.lastSeenAt && Date.now() - tA.lastSeenAt.getTime() < 10_000 && tA.gpsPlatform === "ios", { lastSeenAt: tA.lastSeenAt, pf: tA.gpsPlatform });
  check("javobda lastSeenAt", typeof r.json?.lastSeenAt === "string", r.json);
  r = await track(A.id, [], { ping: new Date().toISOString() });
  check("ECO uslubidagi {points: [], ping} ham qabul", r.status === 200 && r.json?.ok, msg(r));
  r = await api("POST", "/api/mobile/track", { token: drv, body: { tripId: A.id } });
  check("points'siz (faqat tripId) → «tirikman», 200", r.status === 200 && r.json?.accepted === 0, msg(r));

  section("track: stop — yopilgan / bekor / boshqa haydovchi");
  const C = await mkTrip({ status: "CANCELLED" });
  r = await track(C.id, [pt(a(1), ago(5 * MIN))]);
  check("bekor qilingan reys → stop: true, CANCELLED, eski maydonlar bor", r.status === 200 && r.json?.ok === true && r.json?.accepted === 0 && r.json?.stop === true && r.json?.reason === "CANCELLED", msg(r));
  const D = await mkTrip({ status: "DELIVERED", deliveredAt: ago(5 * MIN), lastAt: ago(10 * MIN) });
  r = await track(D.id, [pt(a(0), ago(9 * MIN)), pt(a(1), ago(8 * MIN) /* 400 m / 60 s */)]);
  check("yetkazilgan reys: yetkazishgacha bo'lgan bufer qabul, stop yo'q", r.json?.accepted === 2 && !r.json?.stop, msg(r));
  const tD = await db.trip.findUniqueOrThrow({ where: { id: D.id } });
  check("kech kelgan bufer → yakun qayta hisoblandi", !!tD.summaryAt && (tD.distanceKm ?? 0) > 0.3, { summaryAt: tD.summaryAt, km: tD.distanceKm });
  r = await track(D.id, [pt(a(2), ago(1 * MIN))]);
  check("yetkazilgandan keyingi nuqta rad, stop: true (DELIVERED)", r.json?.accepted === 0 && r.json?.dropped === 1 && r.json?.stop === true && r.json?.reason === "DELIVERED", msg(r));
  r = await track(D.id, [], { heartbeat: true });
  check("yetkazilgan reysga «tirikman» → stop: true", r.json?.stop === true, msg(r));
  await db.trip.update({ where: { id: D.id }, data: { closedAt: new Date() } });
  r = await track(D.id, [pt(a(3), ago(7 * MIN))]);
  check("yopilgan reys → stop: true, CLOSED", r.json?.stop === true && r.json?.reason === "CLOSED", msg(r));
  const E = await mkTrip({ driverId: otherEmp });
  r = await track(E.id, [pt(a(1), ago(5 * MIN))]);
  check("boshqa haydovchiga o'tgan reys → 403 (eski ilova) + stop: true", r.status === 403 && r.json?.stop === true && r.json?.code === "FORBIDDEN", msg(r));
  r = await track(A.id, [pt(a(11), ago(1 * MIN))], {}, lg);
  check("logist iz yubora olmaydi → 403", r.status === 403, r.status);
  r = await track("yoq-" + stamp, []);
  check("mavjud bo'lmagan reys → 404", r.status === 404, r.status);

  // ─────────────────────────────────────────────────────────────
  section("Yakun: ECO algoritmi bilan bir xil (shipment-track.spec namunalari)");
  {
    const e0 = summarizeTrack([]);
    check("bo'sh iz — nol", e0.meters === 0 && e0.distanceKm === 0 && e0.movingMinutes === 0 && e0.firstAt === null);
    const s1 = summarizeTrack(line(11, 500, 30));
    check("11 × 500 m / 30 s → 5 km, 5 daq, 11 nuqta", s1.meters > 4990 && s1.meters < 5010 && s1.distanceKm === 5 && s1.movingMinutes === 5 && s1.kept.length === 11, s1);
    const s2 = summarizeTrack(line(20, 3, 15));
    check("drift (< 15 m) — masofa < 60 m, harakat 0", s2.kept.length < 20 && s2.meters < 60 && s2.movingMinutes === 0, s2);
    const jump = line(5, 200, 30);
    jump.splice(2, 0, { lat: 41.5, lng: 69.2, at: new Date(t0 + 45_000) });
    const s3 = summarizeTrack(jump);
    check("sakrash (> 180 km/soat) tashlanadi, 790–810 m", !s3.kept.some((p) => p.lat === 41.5) && s3.meters > 790 && s3.meters < 810, s3.meters);
    const long = line(5000, 20, 2);
    const s4 = summarizeTrack(long);
    const simp = simplifyLine(s4.kept, 10);
    check("uzun iz soddalashtiriladi, oxirgi nuqta qoladi", simp.length <= 1501 && simp[simp.length - 1]!.at.getTime() === long[long.length - 1]!.at.getTime(), simp.length);
    // Har namunada ECO nusxasi bilan aynan bir xil natija
    const same = [line(11, 500, 30), line(20, 3, 15), jump, long].every((x) => {
      const m = summarizeTrack(x), e = ecoSummarize(x);
      return m.meters === e.meters && m.distanceKm === e.distanceKm && m.movingMinutes === e.movingMinutes && m.kept.length === e.kept && m.maxSpeedKmh === e.maxSpeedKmh;
    });
    check("4 namunada meters / distanceKm / movingMinutes / kept — ECO bilan aynan bir xil", same);
    const enc = encodePolyline([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]);
    check("encoded polyline Google namunasi bilan mos", enc === "_p~iF~ps|U_ulLnnqC_mqNvxq`@", enc);
    check("polyline decode ↔ encode", JSON.stringify(decodePolyline(enc)) === JSON.stringify([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]));
  }

  section("Yakun: reys yetkazilganda saqlanadi (10 km marshrut ±1%)");
  const F = await mkTrip({ loadedAt: ago(40 * MIN), departedAt: ago(35 * MIN) });
  // 21 nuqta × 500 m har 30 s (60 km/soat) → 10 km, 10 daqiqa harakat
  const fPts = Array.from({ length: 21 }, (_, i) => pt(north(BASE, i * 500), ago(30 * MIN - i * 30_000), { speedKmh: 60 + (i === 10 ? 12 : 0), heading: 0, accuracy: 8 }));
  r = await track(F.id, fPts.slice(0, 15));
  const r2 = await track(F.id, fPts.slice(10)); // 5 tasi takror (bufer qayta yuborilgan)
  check("marshrut 2 to'pda (takror bilan) qabul", r.json?.accepted === 15 && r2.json?.accepted === 6 && r2.json?.duplicates === 5, [msg(r), msg(r2)]);
  const dres = await tripDelivered(F.id, logUser.id, "QA qabul");
  check("tripDelivered → changed", dres.changed, dres);
  const tF = await db.trip.findUniqueOrThrow({ where: { id: F.id } });
  const eco = ecoSummarize(fPts.map((p) => ({ lat: p.lat, lng: p.lng, at: new Date(p.at), speedKmh: p.speedKmh })));
  check("distanceKm ≈ 10 km (±1%)", tF.distanceKm != null && Math.abs(tF.distanceKm - 10) <= 0.1, tF.distanceKm);
  check("distanceKm = ECO natijasi", tF.distanceKm === eco.distanceKm, { erp: tF.distanceKm, eco: eco.distanceKm });
  check("movingSec = 600, totalSec = 600", tF.movingSec === 600 && tF.totalSec === 600, { m: tF.movingSec, t: tF.totalSec });
  check("maxSpeedKmh 72, avgSpeedKmh ≈ 60", tF.maxSpeedKmh === 72 && Math.abs((tF.avgSpeedKmh ?? 0) - 60) < 1, { max: tF.maxSpeedKmh, avg: tF.avgSpeedKmh });
  const fLine = decodePolyline(tF.trackLine);
  check("yo'l chizig'i soddalashtirilgan (to'g'ri chiziq → 2 nuqta), summaryAt", fLine.length === 2 && !!tF.summaryAt && tF.trackPoints === 21, { n: fLine.length, pts: tF.trackPoints });

  section("GET /api/mobile/trip-track");
  r = await api("GET", `/api/mobile/trip-track?id=${F.id}`, { token: drv });
  check("haydovchi o'z yopilgan reysi → 200, final, km 10", r.status === 200 && r.json?.final === true && Math.abs(r.json?.distanceKm - 10) <= 0.1 && r.json?.movingSec === 600 && r.json?.totalSec === 600, msg(r));
  check("javobda line[], polyline, avg/max tezlik, oxirgi nuqta", Array.isArray(r.json?.line) && r.json.line.length >= 2 && typeof r.json?.polyline === "string" && r.json?.maxSpeedKmh === 72 && r.json?.avgSpeedKmh > 59 && r.json?.last?.lat != null, msg(r));
  r = await api("GET", `/api/mobile/trip-track?id=${A.id}`, { token: lg });
  check("logistika ochiq reys → 200, final false, km > 0", r.status === 200 && r.json?.final === false && r.json?.distanceKm > 0 && r.json?.points >= 10, msg(r));
  const kmOpen1 = r.json?.meters;
  await track(A.id, [pt(north(BASE, 4400), ago(2.5 * MIN)), pt(north(BASE, 4800), ago(2 * MIN))]);
  r = await api("GET", `/api/mobile/trip-track?id=${A.id}`, { token: lg });
  check("ochiq reys keshi yangi nuqtalarni qo'shadi (km o'sdi)", r.json?.meters > kmOpen1, { was: kmOpen1, now: r.json?.meters });
  r = await api("GET", `/api/mobile/trip-track?id=${A.id}`, { token: sotuv });
  check("sotuv → 403", r.status === 403, r.status);
  r = await api("GET", `/api/mobile/trip-track?id=${E.id}`, { token: drv });
  check("haydovchi begona reys → 404", r.status === 404, r.status);
  r = await api("GET", `/api/mobile/trip-track`, { token: lg });
  check("id'siz → 400", r.status === 400, r.status);

  section("GET/POST /api/mobile/trip-track/summary — ro'yxat uchun bitta so'rov");
  const pick = (j: any) => ({ distanceKm: j?.distanceKm, totalSec: j?.totalSec, movingSec: j?.movingSec, avgSpeedKmh: j?.avgSpeedKmh, maxSpeedKmh: j?.maxSpeedKmh, final: j?.final, status: j?.status }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const one = async (id: string) => pick((await api("GET", `/api/mobile/trip-track?id=${id}`, { token: lg })).json);
  r = await api("GET", `/api/mobile/trip-track/summary?ids=${F.id},${A.id},${E.id},yoq-${stamp}`, { token: drv });
  const drvItems = r.json?.items ?? {};
  check("haydovchi → 200, o'z reyslari (F yopilgan, A ochiq) bor", r.status === 200 && !!drvItems[F.id] && !!drvItems[A.id], msg(r));
  check("begona reys (E) va mavjud bo'lmagan id javobda yo'q", !(E.id in drvItems) && Object.keys(drvItems).length === 2, Object.keys(drvItems));
  check("chiziq yo'q (line/polyline/points emas)", !("line" in (drvItems[F.id] ?? {})) && !("polyline" in (drvItems[F.id] ?? {})), drvItems[F.id]);
  const [oneF, oneA] = [await one(F.id), await one(A.id)];
  check("yopilgan reys (F): qiymatlar trip-track bilan bir xil", JSON.stringify(pick(drvItems[F.id])) === JSON.stringify(oneF) && oneF.final === true && oneF.status === "DELIVERED", { s: drvItems[F.id], t: oneF });
  check("ochiq reys (A): qiymatlar trip-track bilan bir xil", JSON.stringify(pick(drvItems[A.id])) === JSON.stringify(oneA) && oneA.final === false, { s: drvItems[A.id], t: oneA });
  r = await api("POST", "/api/mobile/trip-track/summary", { token: lg, body: { ids: [F.id, A.id, E.id, F.id] } });
  check("logistika (POST) → hammasi, E ham (takror id bir marta)", r.status === 200 && Object.keys(r.json?.items ?? {}).length === 3 && !!r.json.items[E.id], msg(r));
  r = await api("GET", `/api/mobile/trip-track/summary?ids=${F.id}`, { token: sotuv });
  check("sotuv → 403", r.status === 403, r.status);
  r = await api("GET", `/api/mobile/trip-track/summary?ids=${Array.from({ length: 101 }, (_, i) => `x${i}`).join(",")}`, { token: lg });
  check("101 ta id → 400", r.status === 400, msg(r));
  r = await api("POST", "/api/mobile/trip-track/summary", { token: lg, body: { ids: Array.from({ length: 100 }, (_, i) => (i === 0 ? F.id : `x${i}`)) } });
  check("100 ta id → 200 (chegara)", r.status === 200 && Object.keys(r.json?.items ?? {}).length === 1, msg(r));
  r = await api("GET", "/api/mobile/trip-track/summary", { token: lg });
  check("ids'siz → 400", r.status === 400, r.status);
  r = await api("POST", "/api/mobile/trip-track/summary", { token: lg, body: { ids: "a" } });
  check("POST ids massiv emas → 400", r.status === 400, r.status);

  // ─────────────────────────────────────────────────────────────
  section("Fleet: haqiqiy gps.at, tezlik, trail, stale");
  await track(A.id, [pt(north(BASE, 5200), ago(90_000), { speedKmh: 47.4, heading: 12.6 })]);
  const lastA = ago(90_000);
  r = await api("GET", "/api/mobile/fleet", { token: lg });
  let truck = (r.json?.trucks ?? []).find((t: { tripId: string }) => t.tripId === A.id);
  check("fleet 200, reys bor", r.status === 200 && !!truck, r.status);
  check("gps.at — oxirgi nuqtaning haqiqiy vaqti (so'rov vaqti emas)", !!truck?.gps && Math.abs(Date.parse(truck.gps.at) - lastA.getTime()) < 5000, { at: truck?.gps?.at, want: lastA.toISOString() });
  check("speedKmh 47, heading 13", truck?.speedKmh === 47 && truck?.heading === 13, { s: truck?.speedKmh, h: truck?.heading });
  check("trail — so'nggi 15 daqiqa, soddalashtirilgan", Array.isArray(truck?.trail) && truck.trail.length >= 2 && truck.trail.length < 20, truck?.trail?.length);
  check("stale false, staleMin bor, eski maydonlar saqlangan", truck?.stale === false && typeof r.json?.staleMin === "number" && truck?.ref && truck?.phase && "delay" in truck, truck);
  await db.trip.update({ where: { id: A.id }, data: { lastSeenAt: ago(40 * MIN) } });
  r = await api("GET", "/api/mobile/fleet", { token: lg });
  truck = (r.json?.trucks ?? []).find((t: { tripId: string }) => t.tripId === A.id);
  check("40 daqiqa signal yo'q → stale true", truck?.stale === true, { stale: truck?.stale, seen: truck?.lastSeenAt });
  await db.trip.update({ where: { id: A.id }, data: { lastSeenAt: new Date() } });

  // ─────────────────────────────────────────────────────────────
  section("Obyektga yetib kelish (300 m) — xabar bir marta");
  const G = await mkTrip({ pickupLat: east(DEST, -3000).lat, pickupLng: east(DEST, -3000).lng, loadedAt: ago(30 * MIN), departedAt: ago(25 * MIN) });
  const arrN = () => db.notification.count({ where: { type: "TRIP_ARRIVED", link: { path: ["id"], equals: G.id } } });
  r = await track(G.id, [pt(east(DEST, -1000), ago(4 * MIN)), pt(east(DEST, -600), ago(3 * MIN))]);
  await sleep(600);
  let tG = await db.trip.findUniqueOrThrow({ where: { id: G.id } });
  check("600 m — hali yetmagan", r.json?.accepted === 2 && !tG.arrivedAt && !tG.arrivalNotifiedAt && (await arrN()) === 0, { acc: r.json, arr: tG.arrivedAt });
  r = await track(G.id, [pt(east(DEST, -200), ago(2 * MIN))]);
  await sleep(800);
  tG = await db.trip.findUniqueOrThrow({ where: { id: G.id } });
  const n1 = await arrN();
  check("200 m → arrivedAt (nuqta vaqti), arrivalNotifiedAt", !!tG.arrivedAt && Math.abs(tG.arrivedAt.getTime() - ago(2 * MIN).getTime()) < 10_000 && !!tG.arrivalNotifiedAt, { arr: tG.arrivedAt });
  check("logistikaga xabar ketdi (TRIP_ARRIVED)", n1 >= 1, n1);
  r = await track(G.id, [pt(east(DEST, -50), ago(1 * MIN))]);
  await track(G.id, [pt(east(DEST, -10), ago(30_000))]);
  await sleep(800);
  check("ichkarida yana nuqtalar — xabar takrorlanmadi", (await arrN()) === n1, { n1, now: await arrN() });
  const auditArr = await db.auditLog.count({ where: { entity: "Trip", entityId: G.id, action: "UPDATE" } });
  check("bosqich audit'ga yozildi (GPS)", auditArr >= 1, auditArr);
  const H = await mkTrip({ status: "LOADED", departedAt: null, pickupLat: east(DEST, -500).lat, pickupLng: east(DEST, -500).lng });
  await track(H.id, [pt(east(DEST, -100), ago(1 * MIN))]);
  await sleep(600);
  const tH = await db.trip.findUniqueOrThrow({ where: { id: H.id } });
  check("LOADED reys: xabar ketadi, lekin bosqich (arrivedAt/status) o'zgarmaydi", !!tH.arrivalNotifiedAt && !tH.arrivedAt && tH.status === "LOADED", { n: tH.arrivalNotifiedAt, a: tH.arrivedAt, s: tH.status });

  // ─────────────────────────────────────────────────────────────
  section("Davriy tekshiruv: GPS jim / uzoq turish / yo'ldan chiqish");
  // Test rejimida push tashqariga ketmaydi: logistikaga soxta qurilma, fetch va konsol kuzatiladi
  await db.mobileDevice.upsert({ where: { userId_deviceId: { userId: logUser.id, deviceId: `qa-gps-${stamp}` } }, create: { userId: logUser.id, deviceId: `qa-gps-${stamp}`, expoPushToken: "ExponentPushToken[qa-gps]" }, update: {} });
  const realFetch = globalThis.fetch;
  const expoCalls: string[] = [];
  // Expo manziliga so'rov umuman chiqmasin — chiqsa ham shu yerda to'xtaydi va sanaladi
  globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    if (String(u).includes("exp.host")) { expoCalls.push(String(u)); return new Response("{}", { status: 200 }); }
    return realFetch(u, init);
  }) as typeof fetch;
  const logs: string[] = [];
  const realLog = console.log;
  console.log = (...x: unknown[]) => { logs.push(x.map(String).join(" ")); realLog(...x); };

  const W1 = await mkTrip({ lastSeenAt: ago(30 * MIN), lastAt: ago(30 * MIN), lastLat: BASE.lat, lastLng: BASE.lng });
  await db.tripPosition.create({ data: { tripId: W1.id, ...BASE, at: ago(30 * MIN) } });
  const B2 = north(BASE, 20_000);
  const W2 = await mkTrip({ lastSeenAt: new Date() });
  await db.tripPosition.createMany({ data: Array.from({ length: 16 }, (_, i) => ({ tripId: W2.id, lat: B2.lat + ((i % 3) - 1) * 0.00008, lng: B2.lng, at: ago(30 * MIN - i * 2 * MIN) })) });
  const B3 = north(BASE, 40_000);
  const route3 = [B3, east(B3, 2500), east(B3, 5000)];
  const W3 = await mkTrip({ lastSeenAt: new Date(), plannedRoute: encodePolyline(route3) });
  await db.tripPosition.createMany({ data: [4, 3, 2, 1].map((m, i) => ({ tripId: W3.id, ...north(east(B3, 1000 + i * 250), 1000), at: ago(m * MIN) })) });
  const alertsOf = (tripId: string) => db.tripAlert.findMany({ where: { tripId }, orderBy: { openedAt: "asc" } });
  const pushN = (type: string, tripId: string) => db.notification.count({ where: { type, userId: logUser.id, link: { path: ["id"], equals: tripId } } });

  const rep1 = await gpsWatchTick({ force: true, cleanup: false });
  const opened = (id: string, k: string) => !!rep1?.opened.some((o) => o.tripId === id && o.kind === k);
  check("tekshiruv ishladi", !!rep1 && rep1.checked >= 3, rep1 && { checked: rep1.checked });
  check("W1: GPS jim ochildi (STOP emas)", opened(W1.id, "SILENT") && !opened(W1.id, "STOP"), rep1?.opened.filter((o) => o.tripId === W1.id));
  check("W2: uzoq turish ochildi", opened(W2.id, "STOP") && !opened(W2.id, "SILENT"), rep1?.opened.filter((o) => o.tripId === W2.id));
  check("W3: yo'ldan chiqish ochildi", opened(W3.id, "OFF_ROUTE") && !opened(W3.id, "STOP"), rep1?.opened.filter((o) => o.tripId === W3.id));
  check("logistikaga xabar: TRIP_SILENT / TRIP_STOP / TRIP_OFF_ROUTE", (await pushN("TRIP_SILENT", W1.id)) === 1 && (await pushN("TRIP_STOP", W2.id)) === 1 && (await pushN("TRIP_OFF_ROUTE", W3.id)) === 1);
  check("test rejimi: push Expo'ga yuborilmadi ([push · test])", expoCalls.length === 0 && logs.some((l) => l.includes("[push · test]")), { expo: expoCalls.length });

  r = await api("GET", "/api/mobile/fleet", { token: lg });
  const fa = (id: string) => (r.json?.trucks ?? []).find((t: { tripId: string }) => t.tripId === id)?.alerts ?? [];
  check("fleet alerts: W1 SILENT, W2 STOP, W3 OFF_ROUTE (sarlavha bilan)", fa(W1.id).some((a: { kind: string; title: string }) => a.kind === "SILENT" && a.title === "GPS jim") && fa(W2.id).some((a: { kind: string }) => a.kind === "STOP") && fa(W3.id).some((a: { kind: string }) => a.kind === "OFF_ROUTE"), [fa(W1.id), fa(W2.id), fa(W3.id)]);

  const rep2 = await gpsWatchTick({ force: true, cleanup: false });
  check("qayta tekshiruv — bu reyslarda yangi ochilish yo'q", !rep2?.opened.some((o) => [W1.id, W2.id, W3.id].includes(o.tripId)), rep2?.opened);
  check("xabar takrorlanmadi", (await pushN("TRIP_SILENT", W1.id)) === 1 && (await pushN("TRIP_STOP", W2.id)) === 1 && (await pushN("TRIP_OFF_ROUTE", W3.id)) === 1);
  check("har holatda bitta ochiq yozuv", (await db.tripAlert.count({ where: { tripId: { in: [W1.id, W2.id, W3.id] }, closedAt: null } })) === 3);
  const skipped = await gpsWatchTick();
  check("daqiqa ichida ikkinchi (force'siz) tekshiruv o'tkazib yuboriladi", skipped === null, skipped && { opened: skipped.opened.length });
  const [p1, p2] = await Promise.all([gpsWatchTick({ force: true, cleanup: false }), gpsWatchTick({ force: true, cleanup: false })]);
  check("parallel ikki tekshiruv — advisory lock: bittasi o'tkazib yuboriladi", p1 === null || p2 === null, { p1: !!p1, p2: !!p2 });

  // Holatlar o'tdi: signal qaytdi va yurdi, mashina yurdi, yo'lga qaytdi
  await db.trip.update({ where: { id: W1.id }, data: { lastSeenAt: new Date() } });
  await db.tripPosition.create({ data: { tripId: W1.id, ...north(BASE, 1000), at: ago(10_000) } });
  await db.tripPosition.create({ data: { tripId: W2.id, ...north(B2, 1000), at: ago(10_000) } });
  await db.tripPosition.create({ data: { tripId: W3.id, ...east(B3, 2600), at: ago(10_000) } });
  const rep3 = await gpsWatchTick({ force: true, cleanup: false });
  const closed = (id: string, k: string) => !!rep3?.closed.some((o) => o.tripId === id && o.kind === k);
  check("holat o'tgach yopildi: SILENT, STOP, OFF_ROUTE", closed(W1.id, "SILENT") && closed(W2.id, "STOP") && closed(W3.id, "OFF_ROUTE"), rep3?.closed);
  check("yopilgandan keyin yangi ochilish yo'q", !rep3?.opened.some((o) => [W1.id, W2.id, W3.id].includes(o.tripId)), rep3?.opened);
  const al = [...await alertsOf(W1.id), ...await alertsOf(W2.id), ...await alertsOf(W3.id)];
  check("TripAlert: openedAt + closedAt saqlangan (tarix)", al.length === 3 && al.every((x) => x.closedAt && x.openedAt < x.closedAt), al.map((x) => [x.kind, !!x.closedAt]));
  // Reys yetib keldi — kuzatuvdan chiqdi: ochiq holat o'zi yopiladi
  await db.trip.update({ where: { id: W1.id }, data: { lastSeenAt: ago(30 * MIN) } });
  await gpsWatchTick({ force: true, cleanup: false });
  check("W1 yana jim → yangi holat ochildi (yangi xabar)", (await pushN("TRIP_SILENT", W1.id)) === 2);
  await db.trip.update({ where: { id: W1.id }, data: { arrivedAt: new Date() } });
  await gpsWatchTick({ force: true, cleanup: false });
  check("obyektga yetib kelgan reysning ochiq holati yopildi", (await db.tripAlert.count({ where: { tripId: W1.id, closedAt: null } })) === 0);
  globalThis.fetch = realFetch;
  console.log = realLog;
  await db.mobileDevice.deleteMany({ where: { deviceId: `qa-gps-${stamp}` } });

  // ─────────────────────────────────────────────────────────────
  section("Logistika sozlamalari: stopAlertMin / offRouteM validatsiyasi");
  process.env.QA_DB ??= process.env.DATABASE_URL;
  const { as, fd } = await import("./b-client.mjs");
  const L = await as("logistika");
  const base = { lateWarnMin: 15, lateCritMin: 45, gpsSilentMin: 15, loadedWarnMin: 30, assignLeadMin: 60, shiftStartHour: 8, shiftEndHour: 20, avgSpeedKmh: 35 };
  const save = (x: Record<string, unknown>) => L.action("(app)/logistika/actions#saveLogisticsSettings", [undefined, fd({ ...base, ...x })], "/logistika/sozlamalar");
  let sr = await save({ stopAlertMin: 25, offRouteM: 800 });
  let cs = await db.companySettings.findUniqueOrThrow({ where: { id: "main" } });
  check("to'g'ri qiymatlar saqlandi (25 daq, 800 m)", sr.ok && cs.stopAlertMin === 25 && cs.offRouteM === 800, { err: sr.error, s: cs.stopAlertMin, o: cs.offRouteM });
  sr = await save({ stopAlertMin: 2, offRouteM: 800 });
  check("stopAlertMin 2 → rad (kamida 5)", !sr.ok && /Uzoq turish kamida 5/.test(sr.error ?? ""), sr.error);
  sr = await save({ stopAlertMin: 20, offRouteM: 99_999 });
  check("offRouteM 99999 → rad", !sr.ok && /5000/.test(sr.error ?? ""), sr.error);
  sr = await save({ stopAlertMin: 20, offRouteM: "abc" });
  check("offRouteM matn → rad", !sr.ok && !!sr.error, sr.error);
  sr = await save({ stopAlertMin: 20.5, offRouteM: 500 });
  check("kasr daqiqa → rad", !sr.ok && !!sr.error, sr.error);
  cs = await db.companySettings.findUniqueOrThrow({ where: { id: "main" } });
  check("rad etilganlar bazani o'zgartirmadi", cs.stopAlertMin === 25 && cs.offRouteM === 800, { s: cs.stopAlertMin, o: cs.offRouteM });
  const page = await L.get("/logistika/sozlamalar");
  check("sozlamalar sahifasida yangi maydonlar", page.status === 200 && page.text.includes('name="stopAlertMin"') && page.text.includes('name="offRouteM"'), page.status);
  sr = await save({ stopAlertMin: 20, offRouteM: 500 });
  check("sukut qiymatlar qaytarildi", sr.ok, sr.error);

  // ─────────────────────────────────────────────────────────────
  section("Tozalash: 90 kundan eski nuqtalar (faqat yakuni bor reyslar)");
  const old = (d: number, i = 0) => new Date(Date.now() - d * 86_400_000 + i * 30_000);
  const X = await mkTrip({ status: "DELIVERED", loadedAt: old(100, -10), departedAt: old(100, -5), deliveredAt: old(100, 40) });
  await db.tripPosition.createMany({ data: Array.from({ length: 11 }, (_, i) => ({ tripId: X.id, ...north(BASE, i * 500), at: old(100, i), speedKmh: 60 })) });
  const Y = await mkTrip({ status: "ON_ROAD" });
  await db.tripPosition.createMany({ data: [0, 1].map((i) => ({ tripId: Y.id, ...north(BASE, i * 300), at: old(100, i) })) });
  const Z = await mkTrip({ status: "DELIVERED", deliveredAt: ago(5 * MIN) });
  await db.tripPosition.createMany({ data: [{ tripId: Z.id, ...BASE, at: old(95) }, { tripId: Z.id, ...north(BASE, 500), at: old(10) }] });
  await saveTripSummary(Z.id);
  const cl = await cleanupPositions();
  const tX = await db.trip.findUniqueOrThrow({ where: { id: X.id } });
  check("yakunsiz eski reysga avval yakun hisoblandi (5 km)", !!tX.summaryAt && tX.distanceKm === 5 && cl.summarized >= 1, { km: tX.distanceKm, cl });
  check("X ning eski nuqtalari o'chirildi", (await count(X.id)) === 0);
  check("ochiq (yakunsiz) reysning eski nuqtalari qoldi", (await count(Y.id)) === 2);
  check("Z: 95 kunligi o'chdi, 10 kunligi qoldi", (await count(Z.id)) === 1);
  const xTrack = await tripTrack(X.id);
  check("o'chirilgandan keyin xaritada saqlangan iz (polyline)", xTrack.length === 2, xTrack.length);
  r = await api("GET", `/api/mobile/trip-track?id=${X.id}`, { token: lg });
  check("trip-track: nuqtalarsiz ham yakundan (5 km, final)", r.status === 200 && r.json?.final && r.json?.distanceKm === 5 && r.json?.line?.length === 2, msg(r));
  const cl2 = await gpsWatchTick({ force: true, cleanup: true });
  check("davriy ish ichida tozalash ishlaydi (cleanup hisoboti)", !!cl2?.cleanup, cl2?.cleanup);

  section("Hisobot va haydovchi km — Trip.distanceKm dan");
  const km = await tripKmMap([X.id, F.id]);
  check("tripKmMap: yakundan (5 va 10 km)", km.get(X.id) === 5 && Math.abs((km.get(F.id) ?? 0) - 10) <= 0.1, [...km]);
  const pay = await tripPayKm([{ id: X.id, distanceKm: 5, summaryAt: new Date(), order: { distanceKm: 4 } }, { id: "yoq", distanceKm: null, summaryAt: new Date(), order: { distanceKm: 7 } }, { id: "yoq2", distanceKm: 1, summaryAt: new Date(), order: { distanceKm: 7 } }]);
  check("haydovchi km: GPS × 2; GPS yo'q yoki chala → taxminiy × 2", pay.get(X.id) === 10 && pay.get("yoq") === 14 && pay.get("yoq2") === 14, [...pay]);
  const W = await mkTrip({ status: "DELIVERED", deliveredAt: ago(MIN) });
  await db.tripPosition.createMany({ data: [0, 1, 2].map((i) => ({ tripId: W.id, ...north(BASE, i * 1000), at: ago(20 * MIN - i * MIN) })) });
  const pay2 = await tripPayKm([{ id: W.id, distanceKm: null, summaryAt: null, order: { distanceKm: 1 } }]);
  const tW = await db.trip.findUniqueOrThrow({ where: { id: W.id } });
  check("yakunsiz yetkazilgan reys: km hisoblanib saqlandi (2 km × 2)", !!tW.summaryAt && tW.distanceKm === 2 && pay2.get(W.id) === 4, { km: tW.distanceKm, pay: pay2.get(W.id) });
  const { logisticsReport } = await import("@/lib/logistics-report");
  const rep = await logisticsReport(new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
  const drvRow = rep.byDriver.find((x) => x.id === drvEmp);
  check("logistika hisoboti: haydovchi km yakunlardan (F 10 km + W 2 km kiradi)", !!drvRow && drvRow.km >= 12 - 0.2, drvRow?.km);

  await db.$disconnect();
  done();
}
void main().catch(async (e) => { console.error(e); check("kutilmagan xato", false, String(e)); done(); });
