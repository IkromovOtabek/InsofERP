"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { taskCancel, taskProgress } from "@/lib/tasks";
import { parseForm, zOpt, type ActionState } from "@/lib/action";

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
