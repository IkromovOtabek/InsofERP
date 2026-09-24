import { db } from "@/lib/db";
import { customerMarks, markedName } from "@/lib/finance";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { BatchForm } from "../batch-form";
import { unitLabel, soleUnit } from "@/lib/unit";

export default async function NewBatch() {
  const s = await requireSession(["PRODUCTION"]);
  const [orders, products, groups, warehouses] = await Promise.all([
    db.order.findMany({
      where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } },
      orderBy: { deliveryDate: "asc" },
      include: { customer: true, items: { include: { product: true } }, batches: true },
    }),
    db.product.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, include: { recipes: { where: { isActive: true }, select: { id: true } } } }),
    db.productGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
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
        products={products.map((p) => ({ id: p.id, code: p.code, name: p.name, kind: p.kind, groupId: p.groupId, price: p.price.toString(), unit: unitLabel(p.unit), hasRecipe: p.recipes.length > 0 }))}
        groups={groups}
        canCreateProduct={["PRODUCTION", "DIRECTOR"].includes(s.role)}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
      />
    </div>
  );
}
