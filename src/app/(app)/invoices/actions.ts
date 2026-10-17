"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { cancelInvoice as cancelInvoiceLib, createInvoice as create } from "@/lib/invoices";
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

/** Schyotni bekor qilish — tasdiq tugmasi (`ConfirmButton`) orqali, sabab auditga yoziladi. Qoida `lib/invoices.ts` da (mobil ham). */
export async function cancelInvoice(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("sales", "invoice_cancel");
  const res = await cancelInvoiceLib(id, reason, s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/invoices"); revalidatePath("/customers"); revalidatePath("/sales"); revalidatePath("/");
  if (res.orderId) revalidatePath(`/orders/${res.orderId}`);
  return { ok: true, note: "Schyot bekor qilindi" };
}
