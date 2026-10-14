import { fmtNum } from "@/lib/format";

/**
 * Davomat geozonasi: xodim "Keldim / Ketdim" ni ish hududidan (zavod nuqtasi + radius) tashqarida bosganda nima bo'ladi.
 *
 * Qoida (`lib/self-attendance.ts` → `markSelfAttendance` shu funksiyani chaqiradi):
 *   · hudud ichida — oddiy belgi, joy rasmi e'tiborsiz qoldiriladi;
 *   · tashqarida, xodimga ruxsat yo'q (`Employee.attendanceAnywhere = false`) — `OUT_OF_RANGE` (avvalgidek);
 *   · tashqarida, ruxsat bor (komandirovka / obyektda ishlovchi) — joy rasmi (orqa kamera) majburiy:
 *     yo'q bo'lsa `PLACE_PHOTO_REQUIRED`, bor bo'lsa belgi "hududdan tashqarida" deb yoziladi.
 * Yuz tekshiruvi, soxta GPS, aniqlik, soat va nonce qoidalari bunga bog'liq emas — ular har holda ishlaydi.
 *
 * Toza funksiya (bazasiz) — sinovda alohida tekshiriladi.
 */
export type ZoneDecision =
  | { ok: true; outside: boolean }
  | { ok: false; code: "OUT_OF_RANGE" | "PLACE_PHOTO_REQUIRED"; message: string; status: number };

export const PLACE_PHOTO_REQUIRED_MSG = "Ish hududidan tashqaridasiz — atrofingiz (joy) rasmini oling";

export function zoneDecision(distanceM: number, radiusM: number, anywhere: boolean, hasPlacePhoto: boolean): ZoneDecision {
  if (distanceM <= radiusM) return { ok: true, outside: false };
  if (!anywhere) {
    return { ok: false, code: "OUT_OF_RANGE", status: 403, message: `Siz ish joyidan ${distanceText(distanceM)} uzoqdasiz (ruxsat: ${radiusM} m). Ish joyiga kelib qayta urining` };
  }
  if (!hasPlacePhoto) return { ok: false, code: "PLACE_PHOTO_REQUIRED", status: 400, message: PLACE_PHOTO_REQUIRED_MSG };
  return { ok: true, outside: true };
}

/** Masofa matni: "850 m", "2,4 km" (format.ts orqali — server va brauzerda bir xil). */
export function distanceText(m: number): string {
  return m < 1000 ? `${fmtNum(Math.round(m))} m` : `${fmtNum(m / 1000, 1)} km`;
}

/** Nuqtani xaritada ochish — loyihada hamma joyda Yandex (zayavka obyekti, jonli haydovchilar). */
export function mapUrl(lat: number, lng: number): string {
  return `https://yandex.uz/maps/?pt=${lng},${lat}&z=16&l=map`;
}
