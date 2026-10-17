"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { assignOrderBrigades } from "@/lib/production-assign";
import type { ActionState } from "@/lib/action";

/**
 * Tasdiqlash: tanlangan brigadalar qatorlarga yoziladi va har qator uchun topshiriq yaratiladi.
 * Faqat shu tugma bosilganda brigadalarga yuboriladi. Brigada tanlanmagan qatorlar keyinga qoladi.
 * Qoida `lib/production-assign.ts` da — mobil ilova ham shuni chaqiradi.
 */
export async function assignBrigades(orderId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("production", "assign");
  const picks: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("brigade_") && typeof v === "string") picks[k.slice(8)] = v;
  const r = await assignOrderBrigades(orderId, picks, s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/production"); revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
