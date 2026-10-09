import { haversineMeters } from "@/lib/geo";

/**
 * GPS izining sof hisob-kitobi (baza va vaqtsiz — testlanadi): masofa, harakat vaqti, tezlik,
 * izni soddalashtirish (Douglas-Peucker), polyline kodlash, turish / jimlik / yo'ldan chiqish qarorlari.
 *
 * Algoritm Insof ECO bilan BIR XIL (`apps/api/src/modules/shipments/shipment-track.ts` va
 * `shipment-alerts.ts`): pudratchi haydovchi ECO'da, zavod haydovchisi ERP'da yuradi — ikkala
 * joyda bir reys uchun bir xil km chiqishi kerak. Konstantani o'zgartirsangiz, ECO'dagisini ham.
 */

export type LatLng = { lat: number; lng: number };
export type GpsPoint = LatLng & { at: Date; speedKmh?: number | null };

/** Bundan yaqin nuqta — GPS drifti yoki turgan mashina: chiziqqa ham, masofaga ham qo'shilmaydi. */
export const MIN_STEP_M = 15;
/** Bundan tez "harakat" — GPS sakrashi (shahar ichida yuk mashinasi bunday yurmaydi). */
export const MAX_KMH = 180;
/** Harakat vaqti: shundan sekin bo'lgan oraliq — turish. */
export const MOVING_KMH = 4;
/** Harakat vaqti: shundan uzun bo'shliq — aloqa/GPS uzilgan, vaqt hisobga olinmaydi. */
export const MAX_GAP_MS = 5 * 60_000;
/** Saqlanadigan / xaritaga yuboriladigan izning soddalashtirish aniqligi, metr. */
export const LINE_TOLERANCE_M = 10;

/** Koordinata yaroqlimi: son, diapazonda va (0,0) emas (GPS hali tutmagan telefon shuni beradi). */
export const validPoint = (p: LatLng) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);

/**
 * Izni bosqichma-bosqich yig'uvchi — `summarizeTrack` ning o'zi, faqat nuqtalarni bittalab qabul qiladi.
 *
 * Nega: ochiq reysning xaritasi har 12 s da so'raladi; har safar butun izni bazadan o'qib qayta hisoblash
 * o'rniga yangi kelgan nuqtalar mavjud holatga qo'shiladi (`lib/trip-summary.ts` keshi). Natija to'liq
 * qayta hisoblash bilan aynan bir xil — chunki filtr faqat oldingi QABUL QILINGAN nuqtaga qaraydi.
 */
export class TrackAccumulator {
  kept: GpsPoint[] = [];
  meters = 0;
  movingMs = 0;
  maxSpeed: number | null = null;
  first: GpsPoint | null = null;
  last: GpsPoint | null = null;
  raw = 0;

  push(p: GpsPoint) {
    this.raw++;
    if (!validPoint(p)) return;
    if (!this.first) this.first = p;
    this.last = p;
    const prev = this.kept[this.kept.length - 1];
    if (!prev) { this.kept.push(p); return; }
    const step = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);
    if (step < MIN_STEP_M) return;
    const dtMs = p.at.getTime() - prev.at.getTime();
    const kmh = dtMs > 0 ? (step / 1000) / (dtMs / 3_600_000) : Infinity;
    if (kmh > MAX_KMH) return; // sakrash — keyingi nuqta oldingi ishonchli nuqtaga solishtiriladi
    this.kept.push(p);
    this.meters += step;
    if (kmh >= MOVING_KMH && dtMs <= MAX_GAP_MS) this.movingMs += dtMs;
    if (p.speedKmh != null && p.speedKmh <= MAX_KMH && (this.maxSpeed == null || p.speedKmh > this.maxSpeed)) this.maxSpeed = p.speedKmh;
  }

  summary(): TrackSummary {
    const meters = Math.round(this.meters);
    const movingSec = Math.round(this.movingMs / 1000);
    const totalSec = this.first && this.last ? Math.max(0, Math.round((this.last.at.getTime() - this.first.at.getTime()) / 1000)) : 0;
    return {
      meters,
      distanceKm: Math.round(meters / 100) / 10,
      movingMinutes: Math.round(this.movingMs / 60_000),
      movingSec,
      totalSec,
      maxSpeedKmh: this.maxSpeed != null ? Math.round(this.maxSpeed) : null,
      avgSpeedKmh: movingSec >= 60 ? Math.round((meters / 1000) / (movingSec / 3600) * 10) / 10 : null,
      firstAt: this.first?.at ?? null,
      lastAt: this.last?.at ?? null,
      rawPoints: this.raw,
    };
  }
}

export type TrackSummary = {
  /** Bosib o'tilgan yo'l, metr (iz bo'yicha, to'g'ri chiziq emas). */
  meters: number;
  /** Shu, km (0.1 aniqlikda) — ECO `distanceKm` bilan bir xil yaxlitlash. */
  distanceKm: number;
  /** Harakatda o'tgan vaqt, daqiqa (ECO `movingMinutes`). */
  movingMinutes: number;
  movingSec: number;
  /** Birinchi va oxirgi (filtrlanmagan) nuqta orasidagi vaqt, soniya. */
  totalSec: number;
  maxSpeedKmh: number | null;
  /** Harakatdagi o'rtacha tezlik, km/soat (harakat 1 daqiqadan kam bo'lsa null). */
  avgSpeedKmh: number | null;
  firstAt: Date | null;
  lastAt: Date | null;
  rawPoints: number;
};

/**
 * GPS izidan statistika — ECO `summarizeTrack` (shipment-track.ts) bilan bir xil filtr va natija.
 * Nuqtalar vaqt bo'yicha tartiblangan bo'lishi kerak.
 *
 * Filtr: oldingi QABUL QILINGAN nuqtadan 15 m dan yaqini tashlanadi (turganda ham GPS bir necha metr
 * "yuradi"), 180 km/soat dan tez sakrash ham tashlanadi. Masofa — qolgan nuqtalar orasidagi haversine
 * yig'indisi; uzoq aloqa uzilishidan keyingi kesma ham qo'shiladi (oraliq yo'l noma'lum, to'g'ri chiziq —
 * eng kichik baho), lekin harakat VAQTIGA 5 daqiqadan uzun bo'shliq va 4 km/soat dan sekin oraliq kirmaydi.
 */
export function summarizeTrack(points: GpsPoint[]): TrackSummary & { kept: GpsPoint[] } {
  const acc = new TrackAccumulator();
  for (const p of points) acc.push(p);
  return { ...acc.summary(), kept: acc.kept };
}

// ───────────────────────── Soddalashtirish va polyline ─────────────────────────

/** Kichik masofalarda tekis proeksiya (nuqta kengligida) — metr. Haversine'dan arzon, xato < 0.1 %. */
function project(o: LatLng) {
  const R = 6_371_000, k = Math.cos((o.lat * Math.PI) / 180);
  return (q: LatLng) => ({ x: ((q.lng - o.lng) * Math.PI / 180) * k * R, y: ((q.lat - o.lat) * Math.PI / 180) * R });
}

/** Nuqtadan kesmagacha masofa, metr (ECO `pointToSegmentMeters`). */
export function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const xy = project(p);
  const A = xy(a), B = xy(b);
  const dx = B.x - A.x, dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / len2)) : 0;
  return Math.hypot(A.x + t * dx, A.y + t * dy);
}

/** Nuqtadan siniq chiziqqacha eng qisqa masofa, metr. Chiziq bo'sh bo'lsa — Infinity. */
export function distanceToPolyline(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineMeters(p.lat, p.lng, line[0]!.lat, line[0]!.lng);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = pointToSegmentMeters(p, line[i - 1]!, line[i]!);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Douglas-Peucker: chiziqdan `toleranceM` metrdan kam og'adigan oraliq nuqtalar tashlanadi.
 * Boshi va oxiri doim qoladi. Rekursiyasiz (uzun izda stek to'lmasin).
 */
export function simplifyLine<T extends LatLng>(points: T[], toleranceM = LINE_TOLERANCE_M): T[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let worst = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointToSegmentMeters(points[i]!, points[s]!, points[e]!);
      if (d > worst) { worst = d; idx = i; }
    }
    if (idx > 0 && worst > toleranceM) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Google "encoded polyline" (5 xona aniqlik, ~1 m) — Google/Mapbox/`@mapbox/polyline` kutubxonalari
 * bilan mos. 1000 nuqtali iz JSON'da ~40 KB, shu formatda ~6 KB.
 */
export function encodePolyline(points: LatLng[]): string {
  let out = "", pLat = 0, pLng = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) { out += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; }
    out += String.fromCharCode(x + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5), lng = Math.round(p.lng * 1e5);
    enc(lat - pLat); enc(lng - pLng);
    pLat = lat; pLng = lng;
  }
  return out;
}

export function decodePolyline(s: string | null | undefined): LatLng[] {
  if (!s) return [];
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  const dec = () => {
    let shift = 0, res = 0, b: number;
    do {
      if (i >= s.length) return null;
      b = s.charCodeAt(i++) - 63;
      res |= (b & 0x1f) << shift; shift += 5;
    } while (b >= 0x20);
    return res & 1 ? ~(res >> 1) : res >> 1;
  };
  while (i < s.length) {
    const dLat = dec(), dLng = dec();
    if (dLat == null || dLng == null) break; // buzilgan satr — o'qilgancha
    lat += dLat; lng += dLng;
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

// ───────────────────────── Turish, jimlik, yo'ldan chiqish (ECO shipment-alerts.ts) ─────────────────────────

/**
 * "Joyidan siljimagan" radiusi. Turgan telefonning GPS'i 20–80 m "yuradi"; 150 m — shahar ichidagi
 * xato sig'adi, lekin mashina bir ko'chadan ikkinchisiga o'tsa harakat deb hisoblanadi.
 */
export const STOP_RADIUS_M = 150;
/** "Turibdi" tezligi (km/soat). */
export const STILL_KMH = 3;
/** iOS'da turgan telefon nuqta bermaydi — jimlik chegarasi shuncha kutiladi. */
export const IOS_STILL_SILENT_MIN = 30;
/** Yo'lga shundan yaqin qaytsa — "yo'ldan chiqdi" holati tugadi. Chegara va bu oraliqda — o'zgarmaydi. */
export const BACK_ON_ROUTE_M = 300;
/** Chetlashish shuncha davom etsa xabar beriladi (bitta sakrash yoki qisqa aylanib o'tish emas). */
export const OFF_ROUTE_MIN_MS = 2 * 60_000;
export const OFF_ROUTE_MIN_FIXES = 3;
/** Oxirgi nuqta bundan eski bo'lsa yo'ldan chiqish baholanmaydi (GPS jim — u alohida ogohlantirish). */
export const OFF_ROUTE_FRESH_MS = 10 * 60_000;

/**
 * Mashina qachondan beri shu joyda turibdi: oxirgi nuqtadan orqaga — `radiusM` ichidagi uzluksiz
 * nuqtalarning eng birinchisi vaqti. Nuqtalar vaqt bo'yicha tartiblangan. Nuqta yo'q — null.
 */
export function standingSince(points: GpsPoint[], radiusM = STOP_RADIUS_M): Date | null {
  const pts = points.filter(validPoint);
  const last = pts[pts.length - 1];
  if (!last) return null;
  let since = last.at;
  for (let i = pts.length - 2; i >= 0; i--) {
    const p = pts[i]!;
    if (haversineMeters(p.lat, p.lng, last.lat, last.lng) > radiusM) break;
    since = p.at;
  }
  return since;
}

/** Oxirgi ikki nuqta mashina turganini ko'rsatadimi (iOS jimlik chegarasi uchun). */
export function lastSeenStationary(points: GpsPoint[], radiusM = STOP_RADIUS_M): boolean {
  const pts = points.filter(validPoint);
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  if (!last || !prev) return false;
  if (last.speedKmh != null && last.speedKmh >= STILL_KMH) return false;
  return haversineMeters(prev.lat, prev.lng, last.lat, last.lng) <= radiusM;
}

export type WatchInput = {
  now: Date;
  /** Kuzatuv boshlangan payt (yo'lga chiqdi / yuklandi) — hali hech narsa kelmagan bo'lsa jimlik shundan. */
  departedAt: Date | null;
  /** Telefondan oxirgi aloqa (nuqta yoki "tirikman"). */
  lastSeenAt: Date | null;
  iosStill?: boolean;
  standingSince: Date | null;
  silentMin: number;
  stopMin: number;
  silentOpen: boolean;
  stopOpen: boolean;
};
export type WatchDecision = { silentMin: number | null; stoppedMin: number | null; silent: "open" | "close" | null; stop: "open" | "close" | null };

/**
 * Jimlik va turish bo'yicha qaror (ECO `decideWatch`; chegaralar sozlamadan).
 * GPS jim bo'lsa "turibdi" baholanmaydi va uning holati ham yopilmaydi (turganini bilmaymiz).
 */
export function decideWatch(s: WatchInput): WatchDecision {
  const now = s.now.getTime();
  const ref = s.lastSeenAt ?? s.departedAt;
  const silentMs = ref ? now - ref.getTime() : 0;
  const limit = Math.max(s.silentMin, s.iosStill ? IOS_STILL_SILENT_MIN : 0) * 60_000;
  const isSilent = !!ref && silentMs >= limit;
  const standMs = s.standingSince ? now - s.standingSince.getTime() : 0;
  const isStopped = !isSilent && !!s.standingSince && standMs >= s.stopMin * 60_000;
  return {
    silentMin: isSilent ? Math.floor(silentMs / 60_000) : null,
    stoppedMin: isStopped ? Math.floor(standMs / 60_000) : null,
    silent: isSilent ? (s.silentOpen ? null : "open") : s.silentOpen ? "close" : null,
    stop: isStopped ? (s.stopOpen ? null : "open") : !isSilent && s.stopOpen ? "close" : null,
  };
}

export type OffRouteDecision = { distanceM: number | null; since: Date | null; action: "open" | "close" | null };

/**
 * Yo'ldan chiqish (ECO `decideOffRoute`): oxirgi nuqtadan orqaga — yo'ldan `offRouteM` dan uzoq
 * uzluksiz nuqtalar; kamida 3 ta va 2 daqiqadan uzoq bo'lsa — ochiladi. Oxirgi nuqta yo'lga 300 m dan
 * yaqin (chegara 300 dan kichik bo'lsa — chegaradan yaqin) — yopiladi. Eski (10 daq+) ma'lumotda qaror yo'q.
 */
export function decideOffRoute(s: { now: Date; route: LatLng[]; points: GpsPoint[]; offRouteM: number; open: boolean }): OffRouteDecision {
  const pts = s.points.filter(validPoint);
  const last = pts[pts.length - 1];
  if (s.route.length < 2 || !last || s.now.getTime() - last.at.getTime() > OFF_ROUTE_FRESH_MS) return { distanceM: null, since: null, action: null };
  const back = Math.min(BACK_ON_ROUTE_M, s.offRouteM);
  const lastD = distanceToPolyline(last, s.route);
  if (lastD <= back) return { distanceM: Math.round(lastD), since: null, action: s.open ? "close" : null };
  if (lastD <= s.offRouteM || s.open) return { distanceM: Math.round(lastD), since: null, action: null };
  let first = last, n = 0;
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    if (distanceToPolyline(p, s.route) <= s.offRouteM) break;
    first = p; n++;
  }
  const off = n >= OFF_ROUTE_MIN_FIXES && last.at.getTime() - first.at.getTime() >= OFF_ROUTE_MIN_MS;
  return { distanceM: Math.round(lastD), since: off ? first.at : null, action: off ? "open" : null };
}

/**
 * Yangi rejadagi yo'l qabul qilinadimi (ECO `acceptPlannedRoute`). Haydovchi ilovasi yo'ldan chiqqanda
 * yo'lni yangi joydan QAYTA QURADI — u darhol saqlansa, chetlashish hech qachon aniqlanmasdi:
 *  - saqlangan yo'l yo'q, joy noma'lum yoki mashina saqlangan yo'lda (300 m) — qabul;
 *  - "yo'ldan chiqdi" allaqachon ochilgan (dispetcher xabar olgan) — qabul, yangi yo'l endi asos;
 *  - aks holda (chetlashish hali baholanmoqda) — rad, eski yo'l qoladi.
 */
export function acceptPlannedRoute(s: { stored: LatLng[]; pos: LatLng | null; offRouteOpen: boolean }): boolean {
  if (s.stored.length < 2 || !s.pos) return true;
  if (distanceToPolyline(s.pos, s.stored) <= BACK_ON_ROUTE_M) return true;
  return s.offRouteOpen;
}

/**
 * To'xtashlar: shu radiusda shuncha vaqt turgan joylar (monitoring sahifasi). Bir o'tishda — O(n):
 * har nuqta faqat bir marta "langar" bilan solishtiriladi.
 */
export function findStops(points: GpsPoint[], radiusM: number, minMs: number): { lat: number; lng: number; from: Date; to: Date; minutes: number }[] {
  const out: { lat: number; lng: number; from: Date; to: Date; minutes: number }[] = [];
  let i = 0;
  while (i < points.length) {
    const a = points[i]!;
    let j = i + 1;
    while (j < points.length && haversineMeters(a.lat, a.lng, points[j]!.lat, points[j]!.lng) <= radiusM) j++;
    const last = points[j - 1]!;
    const ms = last.at.getTime() - a.at.getTime();
    if (ms >= minMs) out.push({ lat: a.lat, lng: a.lng, from: a.at, to: last.at, minutes: Math.round(ms / 60000) });
    i = j; // keyingi guruh shu yerdan — har nuqta bir marta ko'riladi
  }
  return out;
}

/** Ro'yxatni kalit bo'yicha guruhlash — O(n) (`[...arr, x]` bilan har qadamda nusxa olish O(n²) edi). */
export function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return m;
}
