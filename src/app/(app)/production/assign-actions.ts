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
  // brigade.<n>.<qator> — n-qism brigadasi, qty.<n>.<qator> — unga beriladigan miqdor (bo'sh — qolganining hammasi).
  // Bir qator «Qator qo'shish» bilan bir nechta brigadaga bo'linadi; eski `brigade_<qator>` / `qty_<qator>` ham qabul qilinadi.
  const picks: Record<string, AssignPick[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    const m = /^brigade\.(\d+)\.(.+)$/.exec(k);
    const id = m ? m[2]! : k.startsWith("brigade_") ? k.slice(8) : null;
    if (!id) continue;
    const raw = String(fd.get(m ? `qty.${m[1]}.${id}` : `qty_${id}`) ?? "").replace(/\s+/g, "").replace(",", ".");
    // Son bo'lmagan miqdor «qolganining hammasi» bo'lib ketmasin — 0 sifatida rad etiladi
    (picks[id] ??= []).push({ brigadeId: v, qty: raw ? (Number.isFinite(Number(raw)) ? Number(raw) : 0) : null });
  }
  const r = await assignOrderBrigades(orderId, picks, s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/production"); revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
