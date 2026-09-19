"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  qty: z.coerce.number().positive("miqdor 0 dan katta bo'lsin"),
  note: zOpt,
});

/** Brigada bajargan miqdorni qayd qilish. doneQty oshadi, qoldiq = qty − doneQty; to'liq bo'lsa DONE. */
export async function addProgress(taskId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION", "LOGISTICS"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const t = await db.brigadeTask.findUniqueOrThrow({ where: { id: taskId } });
  if (["DONE", "CANCELLED"].includes(t.status)) return { error: "Topshiriq yopilgan" };
  const remaining = Number(t.qty) - Number(t.doneQty);
  if (d.qty > remaining + 0.0005) return { error: `Qoldiqdan ko'p: qoldiq ${remaining}` };

  await db.$transaction(async (tx) => {
    await tx.taskProgress.create({ data: { taskId, qty: d.qty, note: d.note, createdById: s.userId } });
    const done = Number(t.doneQty) + d.qty;
    const status = done >= Number(t.qty) - 0.0005 ? "DONE" : "IN_PROGRESS";
    await tx.brigadeTask.update({ where: { id: taskId }, data: { doneQty: done, status } });
    await audit(tx, s.userId, "UPDATE", "BrigadeTask", taskId, { doneQty: t.doneQty, status: t.status }, { doneQty: done, status, added: d.qty });
  });
  revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath(`/orders/${t.orderId}`);
  return { ok: true };
}

export async function cancelTask(taskId: string) {
  const s = await requireSession(["PRODUCTION", "SALES"]);
  const t = await db.brigadeTask.findUniqueOrThrow({ where: { id: taskId } });
  if (t.status === "DONE" || t.status === "CANCELLED") return;
  await db.$transaction(async (tx) => {
    await tx.brigadeTask.update({ where: { id: taskId }, data: { status: "CANCELLED" } });
    await audit(tx, s.userId, "STATUS_CHANGE", "BrigadeTask", taskId, { status: t.status }, { status: "CANCELLED" });
  });
  revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath(`/orders/${t.orderId}`);
}
