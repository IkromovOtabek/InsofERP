import { cache } from "react";
import { db } from "@/lib/db";
import { isoDate } from "@/lib/format";

/**
 * Zavod ish kalendari — hisobot va prognozlardagi «ish kuni» (realizatsiya, reja nazorati, Egasi paneli, logistika).
 * Haftalik tartib `CompanySettings.restDays` (6/1 — yakshanba dam), istisnolar `WorkCalendarDay`:
 * bayram (HOLIDAY) — ish kuni emas, ko'chirilgan ish kuni (WORKDAY) — dam olish kuni bo'lsa ham ishlanadi.
 * Davomat va ish haqi bunga bog'lanmagan — ular xodim grafigi bo'yicha (`lib/hr/shifts.ts`).
 * Sozlash: Otdel kadr → «Ish tartibi va bayramlar» (`/settings/ish-tartibi`).
 */
export type WorkCalendar = {
  restDays: ReadonlySet<number>;
  holidays: ReadonlyMap<string, string>; // "YYYY-MM-DD" → nomi
  workdays: ReadonlySet<string>;
  /** Qo'lda kiritilgan oydagi ish kuni: "YYYY-MM" → son (`WorkMonth`) */
  monthDays: ReadonlyMap<string, number>;
  workStart: string; workEnd: string; lunchStart: string | null; lunchEnd: string | null;
};

/** Hafta kunlari nomlari — klient formasi ham ishlatadi, shuning uchun bazasiz faylda. */
export { WEEKDAY_NAMES, WEEK_ORDER } from "./work-calendar-days";

/** O'zbekistonning sanasi o'zgarmaydigan bayramlari (Mehnat kodeksi). Ramazon va Qurbon hayit har yili e'lon qilinadi — qo'lda. */
export const UZ_FIXED_HOLIDAYS: { md: string; name: string }[] = [
  { md: "01-01", name: "Yangi yil" },
  { md: "03-08", name: "Xotin-qizlar kuni" },
  { md: "03-21", name: "Navro'z" },
  { md: "05-09", name: "Xotira va qadrlash kuni" },
  { md: "09-01", name: "Mustaqillik kuni" },
  { md: "10-01", name: "O'qituvchi va murabbiylar kuni" },
  { md: "12-08", name: "Konstitutsiya kuni" },
];

/** `@db.Date` qiymati (UTC yarim tun) → "YYYY-MM-DD". */
export const dbDateKey = (d: Date) => d.toISOString().slice(0, 10);
/** "YYYY-MM-DD" → `@db.Date` uchun Date. */
export const dbDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Bir so'rov ichida bir marta o'qiladi. */
export const workCalendar = cache(async (): Promise<WorkCalendar> => {
  const [c, days, months] = await Promise.all([
    db.companySettings.findUnique({ where: { id: "main" }, select: { restDays: true, workStart: true, workEnd: true, lunchStart: true, lunchEnd: true } }),
    db.workCalendarDay.findMany({ select: { date: true, kind: true, name: true } }),
    db.workMonth.findMany({ select: { year: true, month: true, workDays: true } }),
  ]);
  return {
    restDays: new Set(c?.restDays ?? [0]),
    holidays: new Map(days.filter((d) => d.kind === "HOLIDAY").map((d) => [dbDateKey(d.date), d.name ?? "Bayram"])),
    workdays: new Set(days.filter((d) => d.kind === "WORKDAY").map((d) => dbDateKey(d.date))),
    monthDays: new Map(months.map((m) => [monthKey(m.year, m.month), m.workDays])),
    workStart: c?.workStart ?? "08:00", workEnd: c?.workEnd ?? "18:00", lunchStart: c?.lunchStart ?? null, lunchEnd: c?.lunchEnd ?? null,
  };
});

/** Kun ish kunimi (mahalliy sana bo'yicha). */
export function isWorkDay(cal: WorkCalendar, d: Date): boolean {
  const k = isoDate(d);
  if (cal.workdays.has(k)) return true;
  if (cal.holidays.has(k)) return false;
  return !cal.restDays.has(d.getDay());
}

/** [from, to) oralig'idagi ish kunlari soni. */
export function countWorkDays(cal: WorkCalendar, from: Date, to: Date): number {
  let n = 0;
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) if (isWorkDay(cal, d)) n++;
  return n;
}

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Oydagi ish kuni (`month` 1–12): qo'lda kiritilgani, bo'lmasa kalendardan (dam olish va bayramlarsiz). */
export function monthWorkDays(cal: WorkCalendar, year: number, month: number): number {
  return cal.monthDays.get(monthKey(year, month)) ?? countWorkDays(cal, new Date(year, month - 1, 1), new Date(year, month, 1));
}

const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
/** Kunlik ish soati: tugash − boshlanish − tushlik. */
export function dayHours(cal: Pick<WorkCalendar, "workStart" | "workEnd" | "lunchStart" | "lunchEnd">): number {
  let m = mins(cal.workEnd) - mins(cal.workStart);
  if (m <= 0) m += 24 * 60; // tungi smena
  if (cal.lunchStart && cal.lunchEnd) m -= Math.max(0, mins(cal.lunchEnd) - mins(cal.lunchStart));
  return Math.max(0, m) / 60;
}

/** "6/1" — haftada nechta ish, nechta dam olish kuni. */
export const weekLabel = (restDays: ReadonlySet<number> | readonly number[]) => {
  const n = restDays instanceof Set ? restDays.size : (restDays as readonly number[]).length;
  return `${7 - n}/${n}`;
};
