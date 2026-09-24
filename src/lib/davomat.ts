/** Otdel kadr davomati (tabel) — belgilar, soat hisobi va kun/oy kalitlari. */

import type { AttendanceStatus } from "@/generated/prisma";
import type { BadgeColor } from "@/components/ui";

export type AttendanceMark = {
  value: AttendanceStatus;
  label: string;
  /** Oylik tabeldagi bitta harf. */
  short: string;
  color: BadgeColor;
  /** Katak rangi — oylik jadvalda. */
  cell: string;
  /** Ish kuni sifatida sanaladimi (soat shu belgida yoziladi). */
  worked: boolean;
};

export const ATTENDANCE_MARKS: AttendanceMark[] = [
  { value: "PRESENT", label: "Keldi",     short: "+", color: "green", cell: "bg-emerald-50 text-emerald-700 ring-emerald-200", worked: true },
  { value: "ABSENT",  label: "Kelmadi",   short: "H", color: "red",   cell: "bg-red-50 text-red-600 ring-red-200",             worked: false },
  { value: "LEAVE",   label: "Ta'til",    short: "T", color: "blue",  cell: "bg-sky-50 text-sky-700 ring-sky-200",             worked: false },
  { value: "SICK",    label: "Kasal",     short: "K", color: "amber", cell: "bg-amber-50 text-amber-700 ring-amber-200",       worked: false },
  { value: "DAYOFF",  label: "Dam olish", short: "D", color: "slate", cell: "bg-slate-100 text-slate-500 ring-slate-200",      worked: false },
];

export const markOf = (s: AttendanceStatus) => ATTENDANCE_MARKS.find((m) => m.value === s) ?? ATTENDANCE_MARKS[0];
export const isAttendanceStatus = (v: string): v is AttendanceStatus => ATTENDANCE_MARKS.some((m) => m.value === v);

/** Smena bo'yicha odatiy vaqt — "Hammasi keldi" tugmasi shuni qo'yadi. */
export const DEFAULT_SHIFT = { checkIn: "08:00", checkOut: "17:00" };

/* ───────────────────────── Soat hisobi ───────────────────────── */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" → yarim tundan boshlab daqiqa. Noto'g'ri matn — `null`. */
export function toMinutes(hhmm: string | null | undefined): number | null {
  const m = hhmm?.trim().match(HHMM);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Ishlangan daqiqa. Ketish vaqti kelishdan oldin bo'lsa — tungi smena (ertasi kuniga o'tgan),
 * shuning uchun 24 soat qo'shiladi: 20:00 → 06:00 = 10 soat.
 */
export function workedMinutes(checkIn: string | null | undefined, checkOut: string | null | undefined): number | null {
  const a = toMinutes(checkIn);
  const b = toMinutes(checkOut);
  if (a === null || b === null) return null;
  return b > a ? b - a : b + 24 * 60 - a;
}

/** Daqiqa → "8,5 soat" ko'rinishidagi qisqa yozuv. */
export const hoursText = (min: number) => `${(min / 60).toFixed(1).replace(".", ",").replace(",0", "")} soat`;
/** Daqiqa → jadval katagidagi raqam ("8", "8,5"). */
export const hoursShort = (min: number) => (min / 60).toFixed(1).replace(".0", "").replace(".", ",");

/* ───────────────────────── Kun va oy kalitlari ───────────────────────── */

/**
 * Sana ustuni `@db.Date` — Prisma uni UTC yarim tuni bilan qaytaradi. Shuning uchun
 * kun kaliti hamma joyda UTC bo'yicha olinadi, aks holda +5 mintaqada kun surilib ketadi.
 */
export const dayUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const pad = (n: number) => String(n).padStart(2, "0");

/** Bugungi kun mahalliy vaqt bo'yicha — "YYYY-MM-DD". */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** "YYYY-MM-DD" ± n kun. */
export function shiftDay(iso: string, n: number) {
  const d = dayUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

/** "YYYY-MM-DD" → "YYYY-MM". */
export const monthOf = (iso: string) => iso.slice(0, 7);
/** "YYYY-MM" ± n oy. */
export function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Oydagi barcha kunlar: [{ iso, day, weekend }]. */
export function monthDays(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, i + 1));
    return { iso: isoDay(d), day: i + 1, weekend: d.getUTCDay() === 0 };
  });
}

const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];

export const monthTitle = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const dayTitle = (iso: string) => {
  const d = dayUtc(iso);
  return `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()].toLowerCase()}, ${WEEKDAYS[d.getUTCDay()].toLowerCase()}`;
};

/** "YYYY-MM-DD" ko'rinishida ekanini tekshiradi — searchParams ishonchsiz. */
export const validDay = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
export const validMonth = (v: string | undefined) => (v && /^\d{4}-\d{2}$/.test(v) ? v : null);

/* ───────────────────────── Bo'shatish sabablari ───────────────────────── */

/** "Ishdan bo'shatish" formasidagi tayyor sabablar — boshqasi qo'lda yoziladi. */
export const DISMISSAL_REASONS: string[] = [
  "O'z arizasiga ko'ra",
  "Shartnoma muddati tugadi",
  "Sinov muddatidan o'tmadi",
  "Intizom buzilishi",
  "Ishga chiqmay qo'ydi",
  "Tomonlar kelishuviga ko'ra",
  "Shtat qisqarishi",
];
