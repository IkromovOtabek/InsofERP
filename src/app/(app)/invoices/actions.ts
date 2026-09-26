"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createInvoice as create } from "@/lib/invoices";
import { parseForm, zStr, type ActionState } from "@/lib/action";

const schema = z.object({
  orderId: zStr("Zayavka tanlanmagan"),
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin"),
  date: zStr("Sana kerak"),
});

export async function createInvoice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["ACCOUNTING", "SALES"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  // Qoida `lib/invoices.ts` da — mobil ilova ham shu funksiyani chaqiradi
  const res = await create({ orderId: d.orderId, amount: d.amount, date: new Date(d.date) }, s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/invoices"); revalidatePath("/payments"); revalidatePath(`/orders/${d.orderId}`); revalidatePath("/");
  redirect(`/invoices?created=${res.id}`);
}

export async function cancelInvoice(id: string) {
  const s = await requireSession(["ACCOUNTING"]);
  const inv = await db.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
  if (inv.payments.length) throw new Error("To'lov bor — bekor qilib bo'lmaydi");
  if (inv.status !== "OPEN") return;
  await db.invoice.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(db, s.userId, "STATUS_CHANGE", "Invoice", id, { status: "OPEN" }, { status: "CANCELLED" });
  revalidatePath("/invoices"); revalidatePath("/");
}
