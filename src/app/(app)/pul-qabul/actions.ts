"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAccessDenied } from "@/lib/access-denied";
import { METHOD_ACTION, receivePaymentRequest } from "@/lib/payment-requests";
import { parseForm, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";

const schema = z.object({
  requestId: zStr("So'rov tanlanmagan"),
  cashAccountId: zStr("Kassa/hisob tanlanmagan"),
  amount: z.coerce.number({ message: "summa raqam bo'lsin" }).positive("summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "summa juda katta"),
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  docRef: zOpt,
  note: zOpt,
});

/**
 * «Pul qabul qilish» — zayavka bosh to'lovi bo'yicha so'rovni qabul qilish.
 * Ruxsat usulga qarab: naqd — `payments.receive_cash` (kassa), perechisleniye — `payments.receive_bank` (buxgalteriya).
 * Hisob turi, qolgan summa, dublikat (60 s) va so'rov holati — `receivePaymentRequest` → `addPayment` ichida.
 */
export async function receiveRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const req = await db.paymentRequest.findUnique({ where: { id: d.requestId }, select: { method: true } });
  if (!req) return { error: "So'rov topilmadi" };
  let s;
  try {
    s = await requireAction("payments", METHOD_ACTION[req.method]);
  } catch (e) {
    if (isAccessDenied(e)) return { error: req.method === "CASH" ? "Naqd pulni Kassa xodimi qabul qiladi" : "Perechisleniyeni Buxgalter tasdiqlaydi" };
    throw e;
  }
  const res = await receivePaymentRequest({ requestId: d.requestId, cashAccountId: d.cashAccountId, amount: d.amount, date: new Date(d.date), note: d.note, docRef: req.method === "BANK" ? d.docRef : null }, s);
  if (res.error) return { error: res.error };
  for (const p of ["/pul-qabul", "/payments", "/cashflow", "/orders", "/dashboard", "/sales"]) revalidatePath(p);
  return { ok: true, note: `${res.docNo} qabul qilindi — ${req.method === "CASH" ? "kassa" : "bank"} qoldig'i yangilandi` };
}
