import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "../invoice-form";

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  await requireSession(["ACCOUNTING", "SALES"]);
  const { orderId } = await searchParams;
  const orders = await db.order.findMany({
    where: { status: { in: ["CONFIRMED", "IN_PRODUCTION", "DELIVERED"] }, invoices: { none: { status: { not: "CANCELLED" } } } },
    orderBy: { deliveryDate: "desc" },
    include: { customer: true, items: true, trips: { where: { status: "DELIVERED" } } },
  });
  const opts = orders.map((o) => {
    const price = Number(o.items[0]?.price ?? 0);
    const totalM3 = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const deliveredM3 = o.trips.reduce((s, t) => s + Number(t.qtyM3), 0);
    return { id: o.id, orderNo: o.orderNo, customer: o.customer.name, totalM3, deliveredM3, deliveredSum: deliveredM3 * price, totalSum: o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0) };
  });
  return (
    <div>
      <PageHeader title="Yangi schyot" subtitle="Schyot yozilgach summa mijoz debitorkasiga tushadi" />
      <InvoiceForm orders={opts} preselect={orderId} />
    </div>
  );
}
