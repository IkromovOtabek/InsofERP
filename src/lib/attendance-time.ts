/**
 * Davomat vaqti — smena (xodim kartasidagi "Ish grafigi"), kechikish, erta ketish va ishlangan soat.
 *
 * Bitta qoida hamma yo'l uchun: sex boshlig'i / brigadir belgilashi, "Hammasi keldi", otdel kadr veb tabeli,
 * ERP yuz skaneri va xodimning o'zi ("Keldim"). Fayl brauzerda ham ishlaydi (db yo'q) — veb tabel
 * kechikishni kiritish paytida shu funksiyalar bilan ko'rsatadi.
 *
 * `self-attendance.ts` dagi `shiftOf` / `lateBy` / `earlyBy` bilan aynan bir xil natija beradi.
 */

import { DEFAULT_SHIFT, toMinutes, workedMinutes } from "@/lib/davomat";

const HHMM_RE = /([01]?\d|2[0-3])[:.]([0-5]\d)/g;

export type Shift = { start: string; end: string };

/** "08:00–20:00, 2/2" → { start: "08:00", end: "20:00" }; grafik yozilmagan bo'lsa — zavod standarti 08:00–17:00. */
export function shiftOf(workSchedule: string | null | undefined): Shift {
  const m = [...(workSchedule ?? "").matchAll(HHMM_RE)].map((x) => `${x[1]!.padStart(2, "0")}:${x[2]}`);
  return { start: m[0] ?? DEFAULT_SHIFT.checkIn, end: m[1] ?? DEFAULT_SHIFT.checkOut };
}

const HHMM_ONE = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;
/** "8:00" / "08.00" → "08:00"; vaqt bo'lmasa null. */
export function normTime(v: string | null | undefined): string | null {
  const m = HHMM_ONE.exec((v ?? "").trim());
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : null;
}

/**
 * Ish vaqti formasi uchun: "08:00–17:00, 5/2" → { start: "08:00", end: "17:00", note: "5/2" }.
 * Vaqt yozilmagan bo'lsa start/end — null (davomat zavod standartini oladi), izohda vaqt oralig'i takrorlanmaydi.
 */
export function parseSchedule(workSchedule: string | null | undefined): { start: string | null; end: string | null; note: string } {
  const ws = workSchedule ?? "";
  const m = [...ws.matchAll(HHMM_RE)].map((x) => `${x[1]!.padStart(2, "0")}:${x[2]}`);
  const note = ws
    .replace(/([01]?\d|2[0-3])[:.]([0-5]\d)\s*[–—-]\s*([01]?\d|2[0-3])[:.]([0-5]\d)/g, "")
    .replace(/^[\s,;–—-]+|[\s,;–—-]+$/g, "")
    .replace(/\s{2,}/g, " ");
  return { start: m[0] ?? null, end: m[1] ?? null, note };
}

/** Formadan: boshlanishi, tugashi va izoh → "08:00–17:00, 5/2" (`shiftOf` shu matndan o'qiydi). Hammasi bo'sh — null. */
export function buildSchedule(start: string | null, end: string | null, note: string | null): string | null {
  const range = start && end ? `${start}–${end}` : "";
  return [range, (note ?? "").trim()].filter(Boolean).join(", ") || null;
}

/**
 * Ish vaqti maydonlarini tekshiradi: ikkalasi birga yoziladi, bir xil bo'lmaydi.
 * Tugashi boshlanishidan oldin bo'lsa — tungi smena (masalan 20:00–08:00), bu ruxsat.
 */
export function scheduleProblem(start: string | null | undefined, end: string | null | undefined): string | null {
  const s = (start ?? "").trim(), e = (end ?? "").trim();
  if (!s && !e) return null;
  if (!s || !e) return "Ish vaqtining boshlanishi va tugashini birga kiriting";
  const a = normTime(s), b = normTime(e);
  if (!a || !b) return "Ish vaqtini SS:DD ko'rinishida kiriting (masalan 08:00)";
  if (a === b) return "Ish vaqtining boshlanishi va tugashi bir xil bo'lmasin";
  return null;
}

/** Kechikish (daqiqa): smena boshidan keyin kelgan bo'lsa; 8 soatdan ortiq farq — boshqa smena, hisoblanmaydi. */
export function lateBy(checkIn: string | null | undefined, start: string): number | null {
  const a = toMinutes(checkIn), s = toMinutes(start);
  if (a === null || s === null) return null;
  const d = a - s;
  return d > 0 && d < 8 * 60 ? d : null;
}

/**
 * Bazaga yoziladigan kechikish (`Attendance.lateMinutes`): kelish vaqti bor bo'lsa — kechikmagani 0 bo'lib saqlanadi.
 * null faqat "noma'lum" (eski yozuv yoki vaqtsiz) degani: shunda tabel joriy smenadan hisoblaydi. Aks holda keyin
 * ish grafigi o'zgarsa, o'z vaqtida kelgan eski kunlar "kechikdi" bo'lib qolardi.
 */
export function lateToStore(checkIn: string | null | undefined, start: string): number | null {
  return toMinutes(checkIn) === null ? null : lateBy(checkIn, start) ?? 0;
}

/** Erta ketish (daqiqa): smena tugashidan oldin ketgan bo'lsa. */
export function earlyBy(checkOut: string | null | undefined, end: string): number | null {
  const a = toMinutes(checkOut), e = toMinutes(end);
  if (a === null || e === null) return null;
  const d = e - a;
  return d > 0 && d < 8 * 60 ? d : null;
}

export type DayTimes = { minutes: number | null; lateMin: number | null; earlyMin: number | null };

/**
 * Bir kunlik yozuv bo'yicha ish haqi asosi: ishlangan daqiqa (tungi smena ham), kechikish va erta ketish.
 * `storedLate` — bazadagi `Attendance.lateMinutes` (belgilangan paytdagi smena bo'yicha); bo'lmasa hisoblanadi.
 */
export function dayTimes(
  r: { status: string | null; checkIn: string | null; checkOut: string | null; lateMinutes?: number | null } | null | undefined,
  shift: Shift,
): DayTimes {
  if (!r || r.status !== "PRESENT") return { minutes: null, lateMin: null, earlyMin: null };
  return {
    minutes: workedMinutes(r.checkIn, r.checkOut),
    lateMin: r.lateMinutes != null ? r.lateMinutes || null : lateBy(r.checkIn, shift.start),
    earlyMin: r.checkOut ? earlyBy(r.checkOut, shift.end) : null,
  };
}

/** 75 → "1 s 15 daq", 40 → "40 daq". */
export const lateText = (min: number) => (min < 60 ? `${min} daq` : `${Math.floor(min / 60)} s${min % 60 ? ` ${min % 60} daq` : ""}`);

/** `Attendance.source` → jadvaldagi qisqa yozuv. */
export function sourceLabel(source: string | null | undefined, opts: { face?: boolean; markerRole?: string | null }): string {
  if (source === "SELF_FACE" || source === "SELF_BIOMETRIC") return "O'zi · yuz";
  if (source === "FACE_ID") return "Skaner · yuz";
  if (opts.face) return "Rahbar · yuz";
  if (opts.markerRole === "HR" || opts.markerRole === "DIRECTOR") return "Qo'lda";
  return "Rahbar";
}
