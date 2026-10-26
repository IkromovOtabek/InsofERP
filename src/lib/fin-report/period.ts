/** Oy kaliti "2026-10" — moliyaviy hisobotlar ustunlari. Sana server mahalliy vaqtida (ish haqi, BI bilan bir xil). */
export type MonthKey = string;

export const monthKeyOf = (d: Date): MonthKey => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function monthStart(key: MonthKey): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y!, m! - 1, 1);
}

/** Oyning keyingi oy boshi (oraliq `[monthStart, monthEnd)`). */
export function monthEnd(key: MonthKey): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y!, m!, 1);
}

export function addMonths(key: MonthKey, n: number): MonthKey {
  const [y, m] = key.split("-").map(Number);
  return monthKeyOf(new Date(y!, m! - 1 + n, 1));
}

/** `from` dan boshlab `count` ta oy. */
export const monthRange = (from: MonthKey, count: number): MonthKey[] => Array.from({ length: count }, (_, i) => addMonths(from, i));

/** Ustun sarlavhasi: "10.2026" (jadvaldagidek). */
export const monthLabel = (key: MonthKey) => `${key.slice(5)}.${key.slice(0, 4)}`;

export const isMonthKey = (s: unknown): s is MonthKey => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Ikki oy kaliti orasidagi farq (b − a), oylarda. */
export function monthDiff(a: MonthKey, b: MonthKey): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}
