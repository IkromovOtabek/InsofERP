"use server";

import { requireAction } from "@/lib/auth";
import { dayFleet } from "@/lib/trip-plan-day";
import type { DayFleet } from "@/lib/trip-plan";

/** Zayavka formasi: tanlangan kunda transport bandligi («Reys va transport hisobi» paneli). */
export async function loadDayFleet(day: string, excludeOrderId?: string): Promise<DayFleet | null> {
  await requireAction("orders", "create");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return dayFleet(day, excludeOrderId);
}
