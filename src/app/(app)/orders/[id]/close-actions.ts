"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { orderCloseAtDelivered } from "@/lib/orders";
import type { ActionState } from "@/lib/action";

/**
 * «Yetkazilganicha yopish»: mijoz qolgan qismidan voz kechdi — zayavka yetkazilgan miqdorda yopiladi.
 * Ruxsat bekor qilish bilan bir xil: mijoz zayavkasi — «orders → cancel», sklad zayavkasi — «orders → stock».
 * Qoida (reyslar, topshiriqlar, schyot, summa, audit) — `lib/orders.ts` → `orderCloseAtDelivered`.
 */
export async function closeOrderAtDelivered(id: string, reason: string): Promise<ActionState> {
  const ord = await db.order.findUnique({ where: { id }, select: { kind: true } });
  if (!ord) return { error: "Zayavka topilmadi" };
  const s = await requireAction("orders", ord.kind === "STOCK" ? "stock" : "cancel");
  const r = await orderCloseAtDelivered(id, reason, s.userId);
  if (r.error) return { error: r.error };
  revalidatePath(`/orders/${id}`); revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
  revalidatePath("/tasks"); revalidatePath("/brigades"); revalidatePath("/production"); revalidatePath("/payments");
  return { ok: true, note: r.note };
}
