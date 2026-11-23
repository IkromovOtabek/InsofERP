import { db } from "./db";
import { audit } from "./audit";
import { isMonthKey, monthKeyOf } from "./fin-report/period";
import { PERIOD_SECTIONS, isPeriodSection, periodMonthLabel, periodSectionLabel, type PeriodSection } from "./period-sections";

/**
 * Oy yopish / ochish — veb (Moliya → Oy yopish) va mobil ilova bitta qoida bilan. Ruxsat chaqiruvchida tekshiriladi
 * (`moliya.period_close` / `moliya.period_reopen`). Har amal AuditLog'da: entity "PeriodClose", id "bo'lim:oy".
 */
export type PeriodResult = { ok: true; note: string } | { error: string };

/** Faqat o'tgan oylar: joriy (yoki kelgusi) oyda hali yozuvlar kiritilmoqda. */
export function periodMonthError(month: string): string | null {
  if (!isMonthKey(month)) return "Oy noto'g'ri";
  if (month >= monthKeyOf(new Date())) return "Joriy va kelgusi oyni yopib bo'lmaydi — faqat tugagan oylar";
  return null;
}

/** `section` — bitta bo'lim yoki "all" (oyning hali ochiq barcha bo'limlari). */
export async function closePeriod(userId: string, section: string, month: string): Promise<PeriodResult> {
  const bad = periodMonthError(month);
  if (bad) return { error: bad };
  if (section !== "all" && !isPeriodSection(section)) return { error: "Bo'lim noto'g'ri" };
  const keys: PeriodSection[] = section === "all" ? PERIOD_SECTIONS.map((x) => x.key) : [section as PeriodSection];
  const closed = await db.$transaction(async (tx) => {
    const have = new Set((await tx.periodClose.findMany({ where: { month, section: { in: keys } }, select: { section: true } })).map((r) => r.section));
    const fresh = keys.filter((k) => !have.has(k));
    if (!fresh.length) return [];
    await tx.periodClose.createMany({ data: fresh.map((k) => ({ section: k, month, closedById: userId })), skipDuplicates: true });
    for (const k of fresh) await audit(tx, userId, "STATUS_CHANGE", "PeriodClose", `${k}:${month}`, { closed: false }, { closed: true, section: k, month });
    return fresh;
  });
  if (!closed.length) return { ok: true, note: "Allaqachon yopilgan" };
  return { ok: true, note: closed.length === 1 ? `${periodMonthLabel(month)} — «${periodSectionLabel(closed[0])}» yopildi` : `${periodMonthLabel(month)} — ${closed.length} ta bo'lim yopildi` };
}

export async function reopenPeriod(userId: string, section: string, month: string, reason: string): Promise<PeriodResult> {
  if (!isMonthKey(month) || !isPeriodSection(section)) return { error: "Bo'lim yoki oy noto'g'ri" };
  const why = reason.trim();
  if (why.length < 3) return { error: "Ochish sababini yozing" };
  const n = await db.$transaction(async (tx) => {
    const row = await tx.periodClose.findUnique({ where: { section_month: { section, month } } });
    if (!row) return 0;
    await tx.periodClose.delete({ where: { id: row.id } });
    await audit(tx, userId, "STATUS_CHANGE", "PeriodClose", `${section}:${month}`, { closed: true, closedById: row.closedById, closedAt: row.closedAt }, { closed: false, section, month, reason: why });
    return 1;
  });
  return { ok: true, note: n ? `${periodMonthLabel(month)} — «${periodSectionLabel(section)}» ochildi` : "Oy allaqachon ochiq" };
}
