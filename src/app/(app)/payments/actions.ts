"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { addPayment } from "@/lib/payments";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  customerId: zStr("Mijoz tanlanmagan"),
  invoiceId: zOpt,
  cashAccountId: zStr("Kassa/hisob tanlanmagan"),
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin"),
  date: zStr("Sana kerak"),
  note: zOpt,
});

/** To'lov. Schyot ko'rsatilsa — uning holati yangilanadi; to'liq to'lansa zayavka CLOSED. */
export async function createPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["CASHIER", "ACCOUNTING"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  // Qoida `lib/payments.ts` da — mobil ilovadagi kassa ham shuni chaqiradi
  await addPayment({ customerId: d.customerId, invoiceId: d.invoiceId, cashAccountId: d.cashAccountId, amount: d.amount, date: new Date(d.date), note: d.note }, s.userId);
  revalidatePath("/payments"); revalidatePath("/invoices"); revalidatePath("/orders"); revalidatePath("/");
  return { ok: true };
}
