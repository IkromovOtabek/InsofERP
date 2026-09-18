import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { OrderForm } from "../order-form";
import { unitLabel } from "@/lib/unit";

export default async function NewOrder() {
  await requireSession(["SALES"]);
  const [customers, products] = await Promise.all([
    db.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Yangi zayavka" subtitle="Saqlangandan keyin tasdiqlash tugmasi orqali ishlab chiqarishga yuboriladi" />
      <OrderForm customers={customers} products={products.map((p) => ({ id: p.id, code: p.code, name: p.name, price: p.price.toString(), unit: unitLabel(p.unit) }))} />
    </div>
  );
}
