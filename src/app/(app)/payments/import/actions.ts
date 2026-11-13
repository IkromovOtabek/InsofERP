"use server";

import { revalidatePath } from "next/cache";
import { getSession, requireAction } from "@/lib/auth";
import { notSignedIn } from "@/lib/access-denied";
import { canDo } from "@/lib/permissions";
import { rollbackCashImport } from "@/lib/cash-import";
import type { ActionState } from "@/lib/action";

/**
 * Kassa / bank Excel importini butunligicha qaytarish — qoidalar `lib/cash-import.ts` → `rollbackCashImport`.
 * Ruxsat: `cashflow.delete` (yozuvni o'chirish) — har qanday importni; `payments.import` — faqat o'zi yuklaganini.
 */
export async function rollbackCashImportAction(batchId: string, reason: string): Promise<ActionState> {
  if (typeof batchId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(batchId)) return { error: "Noto'g'ri so'rov" };
  const s = await getSession();
  if (!s) throw notSignedIn();
  const any = canDo(s, "cashflow", "delete");
  if (!any) await requireAction("payments", "import");
  const r = await rollbackCashImport(batchId, String(reason ?? ""), { userId: s.userId, ownOnly: !any });
  if (r.error) return { error: r.error };
  revalidatePath("/payments"); revalidatePath("/payments/import"); revalidatePath("/cashflow"); revalidatePath("/"); revalidatePath("/moliya", "layout");
  return { ok: true, note: r.note };
}
