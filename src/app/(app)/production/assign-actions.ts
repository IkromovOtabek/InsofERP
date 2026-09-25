"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import type { ActionState } from "@/lib/action";
import { notifyAfter, notifyEmployees } from "@/lib/notify";

/**
 * Tasdiqlash: tanlangan brigadalar qatorlarga yoziladi va har qator uchun topshiriq yaratiladi.
 * Faqat shu tugma bosilganda brigadalarga yuboriladi. Brigada tanlanmagan qatorlar keyinga qoladi.
 */
export async function assignBrigades(orderId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION"]);
  const o = await db.order.findUnique({ where: { id: orderId }, include: { items: { include: { task: true } } } });
  if (!o) return { error: "Zayavka topilmadi" };
  if (!["DRAFT", "CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return { error: "Bu zayavkaga brigada tayinlab bo'lmaydi (bloklangan, bekor yoki yakunlangan)" };

  const picks = o.items
    .filter((i) => !i.task)
    .map((i) => ({ item: i, brigadeId: String(fd.get(`brigade_${i.id}`) ?? "").trim() }))
    .filter((x) => x.brigadeId);
  if (picks.length === 0) return { error: "Kamida bitta qator uchun brigada tanlang" };

  const made = await db.$transaction(async (tx) => {
    const rows: { taskId: string; taskNo: string; brigadeId: string; qty: number }[] = [];
    for (const { item, brigadeId } of picks) {
      await tx.orderItem.update({ where: { id: item.id }, data: { brigadeId } });
      const t = await tx.brigadeTask.create({
        data: { taskNo: await nextNo(tx, "brigadeTask", "T"), orderId, orderItemId: item.id, brigadeId, qty: item.qtyM3, dueDate: o.deliveryDate, createdById: s.userId },
      });
      await audit(tx, s.userId, "CREATE", "BrigadeTask", t.id, undefined, t);
      rows.push({ taskId: t.id, taskNo: t.taskNo, brigadeId, qty: Number(item.qtyM3) });
    }
    return rows;
  });

  // Brigadir topshiriq berilganini bilishi kerak — u sexda, ekran oldida emas
  notifyAfter(async () => {
    const brigades = await db.brigade.findMany({ where: { id: { in: made.map((r) => r.brigadeId) } }, select: { id: true, name: true, leaderId: true } });
    const byId = new Map(brigades.map((b) => [b.id, b]));
    for (const r of made) {
      const b = byId.get(r.brigadeId);
      if (!b?.leaderId) continue;
      await notifyEmployees([b.leaderId], {
        type: "TASK_ASSIGNED",
        title: `Yangi topshiriq — ${r.taskNo}`,
        body: `${b.name} · ${r.qty} · muddat ${o.deliveryDate.toLocaleDateString("ru-RU")}`,
        link: { key: "tasks", id: r.taskId },
      });
    }
  });
  revalidatePath("/production"); revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
