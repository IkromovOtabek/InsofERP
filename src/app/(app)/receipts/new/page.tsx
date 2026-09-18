import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ReceiptForm } from "../receipt-form";

export default async function NewReceipt() {
  await requireSession(["PROCUREMENT", "WAREHOUSE"]);
  const [suppliers, warehouses, materials] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { isActive: true } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Yangi kirim" subtitle="Saqlanganda sklad qoldig'i darhol oshadi" />
      <ReceiptForm suppliers={suppliers.map((x) => ({ id: x.id, name: x.name }))} warehouses={warehouses.map((x) => ({ id: x.id, name: x.name }))} materials={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))} />
    </div>
  );
}
