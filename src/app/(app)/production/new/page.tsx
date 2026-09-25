import { db } from "@/lib/db";
import { customerMarks, markedName } from "@/lib/finance";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { productCatalog } from "@/lib/product-catalog";
import { canEditProducts } from "@/lib/catalog";
import { BatchForm } from "../batch-form";
import { unitLabel, soleUnit } from "@/lib/unit";

export default async function NewBatch() {
  const s = await requireSession(["PRODUCTION"]);
  const [orders, catalog, warehouses] = await Promise.all([
    db.order.findMany({
      where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } },
      orderBy: { deliveryDate: "asc" },
      include: { customer: true, items: { include: { product: true } }, batches: true },
    }),
    productCatalog(), // hamma joyda bir xil mahsulot ro'yxati
    db.warehouse.findMany({ where: { isActive: true } }),
  ]);
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
      />
    </div>
  );
}
