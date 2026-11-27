/**
 * CRM sanalari — `yyyy-mm-dd` matni ko'rinishida (Toshkent kuni). Bazadagi `@db.Date` ustunlari UTC yarim tunida saqlanadi.
 * Fayl brauzerda ham ishlatiladi (forma tezkor tugmalari) — server va brauzer bir xil hisoblasin.
 */

const TZ = "Asia/Tashkent";

/** Bugungi sana Toshkent bo'yicha: `2026-11-27` */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(now);
}

/** `yyyy-mm-dd` → bazaga yoziladigan Date (UTC yarim tun) */
export const isoToDb = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** Bazadagi `@db.Date` → `yyyy-mm-dd` */
export const dbToIso = (d: Date) => d.toISOString().slice(0, 10);

export function addDaysIso(iso: string, n: number): string {
  const d = isoToDb(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return dbToIso(d);
}
export function addMonthsIso(iso: string, n: number): string {
  const d = isoToDb(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return dbToIso(d);
}

export const isSunday = (iso: string) => isoToDb(iso).getUTCDay() === 0;
/** Yakshanba bo'lsa — dushanba (CRM_SPEC 4.2) */
export const skipSunday = (iso: string) => (isSunday(iso) ? addDaysIso(iso, 1) : iso);

/** `2026-11-22` → `22.11` (yil joriy bo'lsa) yoki `22.11.2025` */
export function shortIso(iso: string, today = todayIso()): string {
  const [y, m, d] = iso.split("-");
  return y === today.slice(0, 4) ? `${d}.${m}` : `${d}.${m}.${y}`;
}
export function fullIso(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Natijaning standart keyingi aloqa sanasi: +N kun, 30 kun — bir oy; yakshanba — dushanba */
export function defaultNext(days: number | null, today = todayIso()): string | null {
  if (days == null) return null;
  return skipSunday(days === 30 ? addMonthsIso(today, 1) : addDaysIso(today, days));
}

/** Hisobot davri (Voronka, Aloqalar): Bugun · Hafta (dushanbadan) · Oy (1-sanadan) · O'zim tanlayman (`dan`..`gacha`) */
export function period(sp: { davr?: string; dan?: string; gacha?: string }, today = todayIso()): { from: string; to: string; key: string } {
  if (sp.davr === "hafta") {
    const dow = (isoToDb(today).getUTCDay() + 6) % 7; // dushanba = 0
    return { from: addDaysIso(today, -dow), to: today, key: "hafta" };
  }
  if (sp.davr === "oy") return { from: `${today.slice(0, 8)}01`, to: today, key: "oy" };
  const ok = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");
  if (sp.davr === "tanlov" && ok(sp.dan) && ok(sp.gacha)) {
    const [a, b] = [sp.dan!, sp.gacha!].sort();
    return { from: a, to: b, key: "tanlov" };
  }
  return { from: today, to: today, key: "bugun" };
}
