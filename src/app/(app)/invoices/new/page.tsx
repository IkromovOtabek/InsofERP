import { db } from "@/lib/db";
import { customerMarks, markedName } from "@/lib/finance";
import { requireRoles } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "../invoice-form";
import { unitLabel, soleUnit } from "@/lib/unit";

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  await requireRoles(["ACCOUNTING", "SALES"], { module: "sales", actions: ["invoice"] });
  const { orderId } = await searchParams;
  const orders = await db.order.findMany({
    where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION", "DELIVERED"] }, invoices: { none: { status: { not: "CANCELLED" } } } },
    orderBy: { deliveryDate: "desc" },
    include: { customer: true, items: { include: { product: true } }, trips: { where: { status: "DELIVERED" } } },
  });
  const marks = await customerMarks(orders.map((o) => o.customerId));
  const opts = orders.map((o) => {
    const totalM3 = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const totalSum = o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
    // Mijoz qabul qilgan miqdor (bo'lmasa — reysdagi miqdor)
    const deliveredM3 = o.trips.reduce((s, t) => s + Number(t.acceptedQty ?? t.qtyM3), 0);
    // Reysda mahsulot yozilmaydi: bitta mahsulot (yoki hamma qatorda narx bir xil) bo'lsa yetkazilgan summa
    // shu narx bo'yicha; turli narxli ko'p mahsulotda reys qaysi mahsulotniki ekani noma'lum — zayavka jami taklif qilinadi
    const prices = [...new Set(o.items.map((i) => Number(i.price)))];
    const deliveredSum = prices.length === 1 ? Math.min(totalSum, deliveredM3 * prices[0]) : null;
    // Hajm zayavkadagi mahsulot birligida ko'rsatiladi (beton m³, ustun/blok dona)
    const u = soleUnit(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })));
    return { id: o.id, orderNo: o.orderNo, customer: markedName(o.customer.name, o.customerId, marks), totalM3, deliveredM3, deliveredSum, totalSum, unit: unitLabel(u ?? "m3"), mixed: prices.length > 1 };
  });
  return (
    <div>
      <PageHeader title="Yangi schyot" subtitle="Schyot yozilgach summa mijoz debitorkasiga tushadi" />
      <InvoiceForm orders={opts} preselect={orderId} />
    </div>
  );
}
