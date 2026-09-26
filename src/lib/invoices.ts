import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";

/**
 * Schyot yozish qoidasi — veb (`app/(app)/invoices/actions.ts`) ham, mobil ilova ham shu
 * funksiyani chaqiradi: tasdiqlanmagan zayavkaga schyot yo'q, bitta zayavkaga bitta schyot,
 * oldindan olingan avans schyotga bog'lanadi.
 */
export type InvoiceResult = { id?: string; invoiceNo?: string; status?: string; error?: string };

export async function createInvoice(input: { orderId: string; amount: number; date: Date }, userId: string): Promise<InvoiceResult> {
  if (!(input.amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  const o = await db.order.findUnique({ where: { id: input.orderId }, include: { invoices: { where: { status: { not: "CANCELLED" } } } } });
  if (!o) return { error: "Zayavka topilmadi" };
  if (["DRAFT", "BLOCKED", "CANCELLED"].includes(o.status)) return { error: "Tasdiqlanmagan zayavkaga schyot yozib bo'lmaydi" };
  if (o.invoices.length) return { error: "Bu zayavkaga schyot allaqachon yozilgan" };

  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.create({ data: { invoiceNo: await nextNo(tx, "invoice", "S"), date: input.date, customerId: o.customerId, orderId: o.id, amount: input.amount } });
    await audit(tx, userId, "CREATE", "Invoice", inv.id, undefined, inv);
    // Zayavka ochilganda olingan oldindan to'lov (avans) shu schyotga bog'lanadi
    const advances = await tx.payment.findMany({ where: { orderId: o.id, invoiceId: null } });
    let status = "OPEN";
    if (advances.length) {
      await tx.payment.updateMany({ where: { id: { in: advances.map((a) => a.id) } }, data: { invoiceId: inv.id } });
      const paid = advances.reduce((x, a) => x + Number(a.amount), 0);
      status = paid >= input.amount - 0.005 ? "PAID" : paid > 0 ? "PARTIAL" : "OPEN";
      if (status !== "OPEN") await tx.invoice.update({ where: { id: inv.id }, data: { status: status as "PAID" | "PARTIAL" } });
      await audit(tx, userId, "UPDATE", "Invoice", inv.id, { status: "OPEN" }, { status, advances: paid });
    }
    return { id: inv.id, invoiceNo: inv.invoiceNo, status };
  });
}
