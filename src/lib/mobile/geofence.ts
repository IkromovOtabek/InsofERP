import { haversineMeters } from "@/lib/geo";
import { ListError } from "./list";

/**
 * Haydovchi ilovasidagi "obyektdaman" amallari (`trip.arrived`, `trip.unloading`, `trip.delivered`)
 * uchun joy tekshiruvi — Insof ECO API'dagi `assertAtSite` qoidasining aynan o'zi.
 *
 * Qoida:
 *  - zayavkada obyekt koordinatasi bo'lmasa (yoki 0,0) — tekshirib bo'lmaydi, o'tkazamiz;
 *  - aks holda amal so'rovining `payload`ida haydovchining HOZIRGI joylashuvi bo'lishi shart:
 *    `{ lat: number, lng: number }` (ixtiyoriy `accuracy`, `at` — faqat auditga);
 *  - obyektgacha to'g'ri chiziq bo'yicha 300 m dan uzoq bo'lsa — rad etiladi.
 *
 * Orqaga moslik: eski ilova `lat/lng` yubormaydi (u nuqtani oldin `/api/mobile/track`ga yuborib,
 * server oxirgi saqlangan nuqtaga qarardi). Bunday so'rov "ilovani yangilang" xabari bilan rad
 * etiladi — `code: "APP_UPDATE_REQUIRED"`, HTTP 426. O'tish davrida (yangi ilova do'konga
 * chiqquncha) `MOBILE_SITE_COORDS_REQUIRED=false` bilan vaqtincha o'chirib qo'yish mumkin: u holda
 * koordinatasiz so'rov eski qoidaga (`tripArrival` — saqlangan GPS izi, 1 km) qoladi.
 *
 * Bu tekshiruv `tripArrival` (saqlangan GPS izi: yangilik, radiusda ≥2 nuqta va ≥60 s) ni
 * almashtirmaydi — ikkalasi ham o'tishi kerak: payload'dagi nuqta soxta bo'lishi mumkin,
 * saqlangan iz esa mock-GPS'ning bir zumda "ko'chishi"ni ushlaydi.
 */
export const SITE_RADIUS_M = 300;

export type SiteFix = { lat: number; lng: number; accuracy: number | null };

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Koordinata talab qilinadimi (env bilan o'tish davrida o'chiriladi). */
export const coordsRequired = () => (process.env.MOBILE_SITE_COORDS_REQUIRED ?? "true").toLowerCase() !== "false";

/** Obyekt nuqtasi haqiqiymi: null, (0,0) yoki diapazondan tashqari — zayavkada belgilanmagan. */
export function knownPoint(lat: number | null | undefined, lng: number | null | undefined): { lat: number; lng: number } | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if ((lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const label = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/**
 * Payload'dagi joylashuvni tekshiradi. Qaytaradi: tekshirilgan nuqta yoki null (obyekt nuqtasi
 * noma'lum / o'tish davrida koordinatasiz eski ilova). Rad etsa — `ListError`.
 */
export function assertAtSite(payload: Record<string, unknown>, dest: { lat: number; lng: number } | null, action: string): SiteFix | null {
  if (!dest) return null;
  const lat = num(payload.lat), lng = num(payload.lng);
  if (lat == null && lng == null && payload.lat === undefined && payload.lng === undefined) {
    if (!coordsRequired()) return null;
    throw new ListError("APP_UPDATE_REQUIRED", `«${action}» uchun joylashuv yuborilmadi. Ilovani yangilang (Play Market / App Store) va qayta urinib ko'ring`, 426);
  }
  // Diapazondan tashqari qiymat formulada NaN beradi va `NaN > 300` = false — tekshiruv chetlab o'tilardi
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    throw new ListError("LOCATION_INVALID", `«${action}» uchun joylashuv aniqlanmadi — GPS yoqib, qayta urinib ko'ring`, 400);
  }
  const distanceM = Math.round(haversineMeters(lat, lng, dest.lat, dest.lng));
  if (!(distanceM <= SITE_RADIUS_M)) {
    throw new ListError("TOO_FAR", `Obyektgacha ${label(distanceM)} — «${action}» faqat obyektdan ${SITE_RADIUS_M} m ichida belgilanadi`, 400);
  }
  return { lat, lng, accuracy: num(payload.accuracy) };
}
