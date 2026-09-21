import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Brigada topshiriqlari — yagona joy (veb "Topshiriqlar" sahifasi ham, mobil ilova ham).
 * Sessiya/ruxsat tekshiruvi va `revalidatePath` — chaqiruvchida.
 */
export type TaskResult = { changed: boolean; orderId: string; status?: string; error?: string };

/** Brigada bajargan miqdorni qayd qilish. doneQty oshadi; to'liq bo'lsa DONE. */
export async function taskProgress(taskId: string, qty: number, userId: string, note?: string | null): Promise<TaskResult> {
  const t = await db.brigadeTask.findUniqueOrThrow({ where: { id: taskId } });
  if (["DONE", "CANCELLED"].includes(t.status)) return { changed: false, orderId: t.orderId, error: "Topshiriq yopilgan" };
  const remaining = Number(t.qty) - Number(t.doneQty);
  if (qty > remaining + 0.0005) return { changed: false, orderId: t.orderId, error: `Qoldiqdan ko'p: qoldiq ${remaining}` };

  const done = Number(t.doneQty) + qty;
  const status = done >= Number(t.qty) - 0.0005 ? "DONE" : "IN_PROGRESS";
  await db.$transaction(async (tx) => {
    await tx.taskProgress.create({ data: { taskId, qty, note: note ?? undefined, createdById: userId } });
    await tx.brigadeTask.update({ where: { id: taskId }, data: { doneQty: done, status } });
    await audit(tx, userId, "UPDATE", "BrigadeTask", taskId, { doneQty: t.doneQty, status: t.status }, { doneQty: done, status, added: qty });
  });
  return { changed: true, orderId: t.orderId, status };
}

export async function taskCancel(taskId: string, userId: string): Promise<TaskResult> {
  const t = await db.brigadeTask.findUniqueOrThrow({ where: { id: taskId } });
  if (t.status === "DONE" || t.status === "CANCELLED") return { changed: false, orderId: t.orderId, error: "Topshiriq allaqachon yopilgan" };
  await db.$transaction(async (tx) => {
    await tx.brigadeTask.update({ where: { id: taskId }, data: { status: "CANCELLED" } });
    await audit(tx, userId, "STATUS_CHANGE", "BrigadeTask", taskId, { status: t.status }, { status: "CANCELLED" });
  });
  return { changed: true, orderId: t.orderId, status: "CANCELLED" };
}
