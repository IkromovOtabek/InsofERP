/**
 * INN tekshiruvi (mijoz va yetkazuvchi): yuridik shaxs STIR — 9 raqam, jismoniy shaxs JSHSHIR (PINFL) — 14 raqam.
 * Bo'sh joylar (oddiy va bo'linmas) olib tashlanadi; qolganida faqat raqam bo'lishi shart.
 * Faqat yaratish / tahrirlash / importda chaqiriladi — bazadagi eski yozuvlar tekshirilmaydi.
 */
export const INN_ERROR = "INN 9 yoki 14 raqamdan iborat bo'lishi kerak";

/** Bo'sh → `{ inn: null }`; to'g'ri → `{ inn: "305123456" }`; noto'g'ri → `{ error }`. */
export function parseInn(v: unknown): { inn: string | null; error?: undefined } | { error: string; inn?: undefined } {
  const s = v == null ? "" : String(v).replace(/\s+/g, "");
  if (!s) return { inn: null };
  if (!/^\d+$/.test(s) || (s.length !== 9 && s.length !== 14)) return { error: INN_ERROR };
  return { inn: s };
}
