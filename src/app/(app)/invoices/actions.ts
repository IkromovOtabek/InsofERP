"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
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
  const o = await db.order.findUnique({ where: { id: d.orderId }, include: { invoices: { where: { status: { not: "CANCELLED" } } } } });
  if (!o) return { error: "Zayavka topilmadi" };
  if (["DRAFT", "BLOCKED", "CANCELLED"].includes(o.status)) return { error: "Tasdiqlanmagan zayavkaga schyot yozib bo'lmaydi" };
  if (o.invoices.length) return { error: "Bu zayavkaga schyot allaqachon yozilgan" };

  const id = await db.$transaction(async (tx) => {
    const inv = await tx.invoice.create({ data: { invoiceNo: await nextNo(tx, "invoice", "S"), date: new Date(d.date), customerId: o.customerId, orderId: o.id, amount: d.amount } });
    await audit(tx, s.userId, "CREATE", "Invoice", inv.id, undefined, inv);
    return inv.id;
  });
  revalidatePath("/invoices"); revalidatePath(`/orders/${o.id}`); revalidatePath("/");
  redirect(`/invoices?created=${id}`);
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
