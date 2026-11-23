"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { ActionState } from "@/lib/action";
import { isMonthKey, monthKeyOf } from "@/lib/fin-report/period";
import { PERIOD_SECTIONS, isPeriodSection, periodMonthLabel, periodSectionLabel } from "@/lib/period-sections";

/**
 * Oy yopish — `moliya.period_close` (buxgalteriya), ochish — `moliya.period_reopen` (faqat belgilanganlar, sabab majburiy).
 * Himoyaning o'zi bazada (trigger); bu yerda faqat ro'yxat yuritiladi. Har amal AuditLog'da: entity "PeriodClose", id "bo'lim:oy".
 */
const refresh = () => revalidatePath("/moliya/oy-yopish");

/** Faqat o'tgan oylar: joriy (yoki kelgusi) oyda hali yozuvlar kiritilmoqda. */
function checkMonth(month: string): string | null {
  if (!isMonthKey(month)) return "Oy noto'g'ri";
  if (month >= monthKeyOf(new Date())) return "Joriy va kelgusi oyni yopib bo'lmaydi — faqat tugagan oylar";
  return null;
}

/** `section` — bitta bo'lim yoki "all" (oyning hali ochiq barcha bo'limlari). */
export async function closePeriodAction(section: string, month: string): Promise<ActionState> {
  const s = await requireAction("moliya", "period_close");
  const bad = checkMonth(month);
  if (bad) return { error: bad };
  if (section !== "all" && !isPeriodSection(section)) return { error: "Bo'lim noto'g'ri" };
  const keys = section === "all" ? PERIOD_SECTIONS.map((x) => x.key) : [section];
  const closed = await db.$transaction(async (tx) => {
    const have = new Set((await tx.periodClose.findMany({ where: { month, section: { in: keys } }, select: { section: true } })).map((r) => r.section));
    const fresh = keys.filter((k) => !have.has(k));
    if (!fresh.length) return [];
    await tx.periodClose.createMany({ data: fresh.map((k) => ({ section: k, month, closedById: s.userId })), skipDuplicates: true });
    for (const k of fresh) await audit(tx, s.userId, "STATUS_CHANGE", "PeriodClose", `${k}:${month}`, { closed: false }, { closed: true, section: k, month });
    return fresh;
  });
  refresh();
  if (!closed.length) return { ok: true, note: "Allaqachon yopilgan" };
  return { ok: true, note: closed.length === 1 ? `${periodMonthLabel(month)} — «${periodSectionLabel(closed[0])}» yopildi` : `${periodMonthLabel(month)} — ${closed.length} ta bo'lim yopildi` };
}

export async function reopenPeriodAction(section: string, month: string, reason: string): Promise<ActionState> {
  const s = await requireAction("moliya", "period_reopen");
  if (!isMonthKey(month) || !isPeriodSection(section)) return { error: "Bo'lim yoki oy noto'g'ri" };
  const why = reason.trim();
  if (why.length < 3) return { error: "Ochish sababini yozing" };
  const n = await db.$transaction(async (tx) => {
    const row = await tx.periodClose.findUnique({ where: { section_month: { section, month } } });
    if (!row) return 0;
    await tx.periodClose.delete({ where: { id: row.id } });
    await audit(tx, s.userId, "STATUS_CHANGE", "PeriodClose", `${section}:${month}`, { closed: true, closedById: row.closedById, closedAt: row.closedAt }, { closed: false, section, month, reason: why });
    return 1;
  });
  refresh();
  return n ? { ok: true, note: `${periodMonthLabel(month)} — «${periodSectionLabel(section)}» ochildi` } : { ok: true, note: "Oy allaqachon ochiq" };
}
