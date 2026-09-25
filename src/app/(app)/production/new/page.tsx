import { db } from "@/lib/db";
import { customerMarks, markedName } from "@/lib/finance";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { productCatalog } from "@/lib/product-catalog";
import { canEditProducts } from "@/lib/catalog";
import { BatchForm, type OpenTask } from "../batch-form";
import { unitLabel, soleUnit } from "@/lib/unit";

export default async function NewBatch() {
  const s = await requireSession(["PRODUCTION"]);
  const [orders, catalog, warehouses, tasks] = await Promise.all([
    db.order.findMany({
      where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } },
      orderBy: { deliveryDate: "asc" },
      include: { customer: true, items: { include: { product: true } }, batches: true },
    }),
    productCatalog(), // hamma joyda bir xil mahsulot ro'yxati
    db.warehouse.findMany({ where: { isActive: true } }),
    // Ochiq brigada topshiriqlari — faqat DONA mahsulot bo'yicha: brigada qayd qilganda
    // shunday mahsulot hovliga o'zi kirim bo'ladi, ustiga zames yozilsa ikki marta hisoblanadi.
    // Beton (m³) bunga kirmaydi — uning yagona kirim yo'li shu zames.
    db.brigadeTask.findMany({
      where: { status: { in: ["NEW", "IN_PROGRESS"] }, orderItem: { product: { unit: { not: "m3" } } } },
      include: { brigade: { select: { name: true } }, order: { select: { orderNo: true } }, orderItem: { select: { productId: true, product: { select: { unit: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const openTasks: Record<string, OpenTask[]> = {};
  for (const t of tasks) {
    (openTasks[t.orderItem.productId] ??= []).push({
      taskNo: t.taskNo, brigade: t.brigade.name, orderNo: t.order.orderNo,
      qty: Number(t.qty), doneQty: Number(t.doneQty), unit: unitLabel(t.orderItem.product.unit),
    });
  }
  const marks = await customerMarks(orders.map((o) => o.customerId));
  // Sodda holat: zayavkada bitta marka deb olamiz (ko'p markali zayavka bo'lsa — birinchisi)
  const orderOpts = orders.map((o) => {
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const done = o.batches.reduce((s, b) => s + Number(b.qtyM3), 0);
    return { id: o.id, orderNo: o.orderNo, customer: markedName(o.customer.name, o.customerId, marks), productId: o.items[0]?.productId ?? "", remainingM3: Math.max(0, total - done), unit: unitLabel(soleUnit(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) ?? "m3") };
  }).filter((o) => o.remainingM3 > 0);

  return (
    <div>
      <PageHeader title="Yangi zames" subtitle="Saqlanganda retsept bo'yicha xomashyo skladdan avtomatik yozib olinadi" />
      <BatchForm
        orders={orderOpts}
        products={catalog.products}
        groups={catalog.groups}
        canCreateProduct={canEditProducts(s.role)}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        openTasks={openTasks}
      />
    </div>
  );
}
