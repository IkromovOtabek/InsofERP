"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
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

  await db.$transaction(async (tx) => {
    const p = await tx.payment.create({ data: { customerId: d.customerId, invoiceId: d.invoiceId, cashAccountId: d.cashAccountId, amount: d.amount, date: new Date(d.date), note: d.note } });
    await audit(tx, s.userId, "CREATE", "Payment", p.id, undefined, p);
    if (d.invoiceId) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: d.invoiceId }, include: { payments: true } });
      const paid = inv.payments.reduce((x, y) => x + Number(y.amount), 0);
      const status = paid >= Number(inv.amount) - 0.005 ? "PAID" : paid > 0 ? "PARTIAL" : "OPEN";
      await tx.invoice.update({ where: { id: inv.id }, data: { status } });
      if (status === "PAID" && inv.orderId) {
        const others = await tx.invoice.count({ where: { orderId: inv.orderId, status: { in: ["OPEN", "PARTIAL"] } } });
        if (others === 0) await tx.order.updateMany({ where: { id: inv.orderId, status: "DELIVERED" }, data: { status: "CLOSED" } });
      }
    }
  });
  revalidatePath("/payments"); revalidatePath("/invoices"); revalidatePath("/orders"); revalidatePath("/");
  return { ok: true };
}
