"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { customerMergePreview, findMergeTargetsLib, mergeCustomers, type MergePreview, type MergeTarget } from "@/lib/customer-merge";

/**
 * Takror mijozlarni birlashtirish — faqat direktor (SUPERADMIN ham, `effectiveRole`). Yangi ruxsat amali qo'shilmagan:
 * bu kamdan-kam, qaytarib bo'lmaydigan amal (manba karta o'chadi). Qoida — `lib/customer-merge.ts`.
 */

export async function findMergeTargets(sourceId: string, q: string): Promise<MergeTarget[]> {
  await requireSession(["DIRECTOR"]);
  return findMergeTargetsLib(sourceId, String(q ?? ""));
}

export async function previewCustomerMerge(sourceId: string, targetId: string): Promise<MergePreview> {
  await requireSession(["DIRECTOR"]);
  return customerMergePreview(sourceId, targetId);
}

export async function mergeCustomerAction(sourceId: string, targetId: string, reason: string): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = await mergeCustomers(sourceId, targetId, reason, s.userId);
  if (!r.ok) return { error: r.error };
  revalidatePath("/customers"); revalidatePath(`/customers/${targetId}`); revalidatePath("/orders"); revalidatePath("/sales");
  revalidatePath("/payments"); revalidatePath("/invoices"); revalidatePath("/leads");
  return { ok: true, note: r.note };
}
