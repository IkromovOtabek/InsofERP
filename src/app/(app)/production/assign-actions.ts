"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import type { ActionState } from "@/lib/action";

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

  await db.$transaction(async (tx) => {
    for (const { item, brigadeId } of picks) {
      await tx.orderItem.update({ where: { id: item.id }, data: { brigadeId } });
      const t = await tx.brigadeTask.create({
        data: { taskNo: await nextNo(tx, "brigadeTask", "T"), orderId, orderItemId: item.id, brigadeId, qty: item.qtyM3, dueDate: o.deliveryDate, createdById: s.userId },
      });
      await audit(tx, s.userId, "CREATE", "BrigadeTask", t.id, undefined, t);
    }
  });
  revalidatePath("/production"); revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
