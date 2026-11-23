"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { closePeriod, reopenPeriod } from "@/lib/period-close";

/**
 * Oy yopish — `moliya.period_close` (buxgalteriya), ochish — `moliya.period_reopen` (faqat belgilanganlar, sabab majburiy).
 * Himoyaning o'zi bazada (trigger); qoida — `lib/period-close.ts` (mobil ilova ham shu).
 */
const refresh = () => revalidatePath("/moliya/oy-yopish");

/** `section` — bitta bo'lim yoki "all" (oyning hali ochiq barcha bo'limlari). */
export async function closePeriodAction(section: string, month: string): Promise<ActionState> {
  const s = await requireAction("moliya", "period_close");
  const r = await closePeriod(s.userId, section, month);
  if ("error" in r) return { error: r.error };
  refresh();
  return { ok: true, note: r.note };
}

export async function reopenPeriodAction(section: string, month: string, reason: string): Promise<ActionState> {
  const s = await requireAction("moliya", "period_reopen");
  const r = await reopenPeriod(s.userId, section, month, reason);
  if ("error" in r) return { error: r.error };
  refresh();
  return { ok: true, note: r.note };
}
