"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { assignOrderBrigades, type AssignPick } from "@/lib/production-assign";
import type { ActionState } from "@/lib/action";

/**
 * Tasdiqlash: tanlangan brigada va miqdor bo'yicha har qator uchun topshiriq yaratiladi (qatorning bir qismi ham bo'lishi mumkin).
 * Faqat shu tugma bosilganda brigadalarga yuboriladi. Brigada tanlanmagan qatorlar keyinga qoladi.
 * Qoida `lib/production-assign.ts` da — mobil ilova ham shuni chaqiradi.
 */
export async function assignBrigades(orderId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("production", "assign");
  // brigade_<qator> — brigada, qty_<qator> — shu brigadaga beriladigan miqdor (bo'sh — qolganining hammasi)
  const picks: Record<string, AssignPick> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("brigade_") || typeof v !== "string") continue;
    const id = k.slice(8), raw = String(fd.get(`qty_${id}`) ?? "").replace(/\s+/g, "").replace(",", ".");
    picks[id] = { brigadeId: v, qty: raw ? Number(raw) : null };
  }
  const r = await assignOrderBrigades(orderId, picks, s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/production"); revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
