"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createInvoice as create } from "@/lib/invoices";
import { parseForm, zStr, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";

const schema = z.object({
  orderId: zStr("Zayavka tanlanmagan"),
  amount: z.coerce.number({ message: "Summa raqam bo'lsin" }).positive("Summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "Summa juda katta"),
  date: zStr("Sana kerak").refine(validDate, "Sana noto'g'ri"),
});

export async function createInvoice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("sales", "invoice");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  // Qoida `lib/invoices.ts` da — mobil ilova ham shu funksiyani chaqiradi
  const res = await create({ orderId: d.orderId, amount: d.amount, date: new Date(d.date) }, s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/invoices"); revalidatePath("/payments"); revalidatePath(`/orders/${d.orderId}`); revalidatePath("/");
  redirect(`/invoices?created=${res.id}`);
}

/** Schyotni bekor qilish — tasdiq tugmasi (`ConfirmButton`) orqali, sabab auditga yoziladi. */
export async function cancelInvoice(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("sales", "invoice_cancel");
  const inv = await db.invoice.findUnique({ where: { id }, include: { payments: true } });
  if (!inv) return { error: "Schyot topilmadi" };
  // Boshlang'ich qoldiq schyoti faqat o'z bo'limidan (direktor) bekor qilinadi — u yerda qoldiq yozuvi ham yopiladi
  if (inv.isOpening) return { error: "Bu boshlang'ich qoldiq — uni «Boshlang'ich qoldiqlar» bo'limidan direktor bekor qiladi" };
  if (inv.payments.length) return { error: "To'lov bor — bekor qilib bo'lmaydi" };
  if (inv.status !== "OPEN") return { error: "Faqat ochiq schyot bekor qilinadi" };
  // Shart bilan: tekshiruvdan keyin to'lov kelib qolgan bo'lsa bekor qilinmaydi
  const r = await db.invoice.updateMany({ where: { id, status: "OPEN", isOpening: false, payments: { none: {} } }, data: { status: "CANCELLED" } });
  if (!r.count) return { error: "Schyotga hozirgina to'lov tushdi — bekor qilib bo'lmaydi" };
  await audit(db, s.userId, "STATUS_CHANGE", "Invoice", id, { status: "OPEN" }, { status: "CANCELLED", reason: String(reason ?? "").trim().slice(0, 300) || undefined });
  revalidatePath("/invoices"); revalidatePath("/customers"); revalidatePath("/sales"); revalidatePath("/");
  if (inv.orderId) revalidatePath(`/orders/${inv.orderId}`);
  return { ok: true, note: "Schyot bekor qilindi" };
}
