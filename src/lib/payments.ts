import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { money } from "@/lib/format";
import { notifyAfter, notifyRoles } from "@/lib/notify";

/**
 * To'lov qabul qilish — yagona joy (veb kassa sahifasi ham, mobil ilova ham shu yerdan).
 * Schyot ko'rsatilsa uning holati qayta hisoblanadi; zayavkaning hamma schyoti yopilsa — zayavka CLOSED.
 */
export type PaymentInput = {
  customerId: string;
  invoiceId?: string | null;
  cashAccountId: string;
  amount: number;
  date: Date;
  note?: string | null;
};

export async function addPayment(input: PaymentInput, userId: string): Promise<{ id: string; invoiceStatus?: string }> {
  const res = await db.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        customerId: input.customerId,
        invoiceId: input.invoiceId ?? undefined,
        cashAccountId: input.cashAccountId,
        amount: input.amount,
        date: input.date,
        note: input.note ?? undefined,
      },
    });
    await audit(tx, userId, "CREATE", "Payment", p.id, undefined, p);

    if (!input.invoiceId) return { id: p.id };

    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId }, include: { payments: true } });
    const paid = inv.payments.reduce((x, y) => x + Number(y.amount), 0);
    const status = paid >= Number(inv.amount) - 0.005 ? "PAID" : paid > 0 ? "PARTIAL" : "OPEN";
    await tx.invoice.update({ where: { id: inv.id }, data: { status } });
    if (status === "PAID" && inv.orderId) {
      const others = await tx.invoice.count({ where: { orderId: inv.orderId, status: { in: ["OPEN", "PARTIAL"] } } });
      if (others === 0) await tx.order.updateMany({ where: { id: inv.orderId, status: "DELIVERED" }, data: { status: "CLOSED" } });
    }
    return { id: p.id, invoiceStatus: status };
  });

  // To'lov mijozning limitini bo'shatadi — sotuv va buxgalteriya buni kutib turadi
  notifyAfter(async () => {
    const c = await db.customer.findUnique({ where: { id: input.customerId }, select: { name: true } });
    await notifyRoles(["SALES", "ACCOUNTING", "DIRECTOR"], {
      type: "PAYMENT_RECEIVED",
      title: `To'lov: ${money(input.amount)}`,
      body: `${c?.name ?? "Mijoz"}${res.invoiceStatus === "PAID" ? " · schyot yopildi" : ""}`,
      link: input.invoiceId ? { key: "invoices", id: input.invoiceId } : undefined,
      channel: "oddiy",
    }, { except: userId });
  });
  return res;
}
