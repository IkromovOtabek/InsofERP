"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { taskCancel, taskProgress, taskSubstitute } from "@/lib/tasks";
import { parseForm, zOpt, zStr, type ActionState } from "@/lib/action";

const schema = z.object({
  qty: z.coerce.number({ message: "Miqdorni raqam bilan yozing" }).positive("miqdor 0 dan katta bo'lsin"),
  note: zOpt,
});

/** Brigada bajargan miqdorni qayd qilish. doneQty oshadi, qoldiq = qty − doneQty; to'liq bo'lsa DONE. */
export async function addProgress(taskId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("tasks", "progress");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  // Qoida `lib/tasks.ts` da — mobil ilova ham shuni chaqiradi
  const res = await taskProgress(taskId, d.qty, s.userId, d.note);
  if (res.error) return { error: res.error };
  // Bajarilgan miqdor brigada xomashyosini kamaytiradi — sklad va brigada sahifalari ham yangilanadi
  revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath("/stock"); revalidatePath("/production"); revalidatePath(`/orders/${res.orderId}`);
  return { ok: true, note: res.note };
}

export async function cancelTask(taskId: string) {
  const s = await requireAction("tasks", "cancel");
  const res = await taskCancel(taskId, s.userId);
  revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath(`/orders/${res.orderId}`);
}

const subSchema = z.object({
  productId: zStr("O'rinbosar mahsulotni tanlang"),
  qty: z.coerce.number({ message: "Miqdorni raqam bilan yozing" }).int("miqdor butun son bo'lsin").positive("miqdor 0 dan katta bo'lsin"),
  brigadeId: zOpt,
  reason: zOpt,
});

/**
 * «Qolganini boshqa o'lchamda bajardim» → «O'tkazish»: qoldiq o'rinbosar mahsulotga yangi topshiriq bo'lib o'tadi,
 * zayavka qatori bo'linadi (asl narxda). `done` belgilangan bo'lsa — yangi topshiriq darhol bajarildi deb qayd qilinadi.
 */
export async function substituteTask(taskId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("tasks", "progress");
  const r = parseForm(subSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const res = await taskSubstitute(taskId, { productId: d.productId, qty: d.qty, brigadeId: d.brigadeId, reason: d.reason, done: fd.get("done") === "on" }, s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath("/stock"); revalidatePath("/production"); revalidatePath(`/orders/${res.orderId}`);
  return { ok: true, note: res.note };
}
