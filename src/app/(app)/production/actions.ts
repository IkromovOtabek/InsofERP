"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, type ActionState } from "@/lib/action";
import { batchSchema, createProductionBatch } from "@/lib/production-batch";
import { cancelBatch } from "@/lib/storno";

/**
 * Zames qaydi: retsept bo'yicha xomashyo sarfi, tayyor mahsulot kirimi, zayavka → IN_PRODUCTION.
 * Qoida `lib/production-batch.ts` da — mobil ilova ham shuni chaqiradi.
 */
export async function createBatch(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("production", "batch");
  const r = parseForm(batchSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await createProductionBatch(r.data, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/production"); revalidatePath("/orders"); revalidatePath("/");
  redirect(`/production/${res.id}`);
}

/**
 * Zamesni storno qilish — faqat direktor (yoki direktor "Zamesni storno qilish" amalini bergan xodim).
 * Qoida `lib/storno.ts` da: xomashyo qaytadi, mahsulot chiqariladi; mahsulot jo'natilgan bo'lsa rad.
 */
export async function stornoBatch(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("production", "batch_storno");
  const r = await cancelBatch(id, String(reason ?? "").slice(0, 300), s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/production"); revalidatePath(`/production/${id}`); revalidatePath("/orders"); revalidatePath("/stock"); revalidatePath("/trips"); revalidatePath("/");
  return { ok: true, note: r.note };
}
