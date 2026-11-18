import type { Prisma } from "@/generated/prisma";
import { MAX_SHIFT_MINUTES, isoDay, toMinutes, workedMinutes } from "@/lib/davomat";

/* Davomatdan ish soati — tabel (`tabel.ts`) va brigada varag'i (`brigade-sheet.ts`) uchun umumiy. */

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Hozirgi mahalliy vaqt «HH:MM» (bugun ishda davom etayotganlar soati uchun). */
const nowHHMM = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/**
 * Davomatdan (Face ID, kelish-ketish vaqti) ish soati — tabel va brigada varag'i uchun:
 *   · qo'lda yozilgan soat (`hours`) — o'sha;
 *   · kelgan-ketgan vaqti bor — oraliq (chorak soatga yaxlitlab);
 *   · kelgan, ketgani yozilmagan: o'tgan kun — smena oxirigacha (ish haqi hisobi kabi), bugun — hozirgacha
 *     («davom etmoqda», `live`);
 *   · vaqtsiz «keldi» — null (1 kun hisoblanadi).
 */
export function attendanceHours(a: { date: Date; hours?: Prisma.Decimal | number | null; checkIn: string | null; checkOut: string | null }, planEnd: string | null | undefined, nowIso: string): { h: number | null; live?: boolean } {
  if (a.hours != null) return { h: Number(a.hours) };
  const q = (m: number | null) => (m != null ? Math.round((m / 60) * 4) / 4 : null);
  const m = workedMinutes(a.checkIn, a.checkOut);
  if (m != null) return { h: q(m) };
  if (!a.checkIn) return { h: null };
  const iso = isoDay(a.date);
  if (iso < nowIso) {
    // Smena oxirigacha; kelgan vaqt smena oxiridan keyin bo'lsa (16 soatdan uzun «tungi smena» chiqadi) — noma'lum
    const pm = planEnd ? workedMinutes(a.checkIn, planEnd) : null;
    return { h: pm != null && pm <= MAX_SHIFT_MINUTES ? q(pm) : null };
  }
  if (iso === nowIso) {
    const now = nowHHMM();
    // Kelgan vaqtdan oldin (soat farqi / xato vaqt) — hali 0
    const lm = (toMinutes(now) ?? 0) >= (toMinutes(a.checkIn) ?? 0) ? workedMinutes(a.checkIn, now) ?? 0 : 0;
    return { h: q(Math.min(lm, MAX_SHIFT_MINUTES)), live: true };
  }
  return { h: null };
}
