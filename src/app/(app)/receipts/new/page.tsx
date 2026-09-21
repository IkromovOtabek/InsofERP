import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ReceiptForm } from "../receipt-form";

export default async function NewReceipt() {
  await requireSession(["PROCUREMENT", "WAREHOUSE"]);
  const [suppliers, warehouses, materials, accounts, balances, costs] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { isActive: true } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } }),
    // Qoldiq va oxirgi narx — spravochnikda ko'rinadi va tanlanganda narx qatorga tushadi
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: { in: ["RECEIPT", "ADJUSTMENT"] }, unitCost: { not: null }, materialId: { not: null } }, _avg: { unitCost: true } }),
  ]);
  const bal = new Map(balances.map((b) => [b.materialId, Number(b._sum.qty ?? 0)]));
  const avg = new Map(costs.map((c) => [c.materialId, Number(c._avg.unitCost ?? 0)]));
  return (
    <div>
      <PageHeader title="Yangi kirim" subtitle="Saqlanganda sklad qoldig'i darhol oshadi" />
      <ReceiptForm suppliers={suppliers.map((x) => ({ id: x.id, name: x.name }))} warehouses={warehouses.map((x) => ({ id: x.id, name: x.name }))} materials={materials.map((m) => ({ id: m.id, name: m.name, code: m.code, unit: m.unit, price: avg.get(m.id) ?? 0, balance: bal.get(m.id) ?? 0 }))} accounts={accounts} />
    </div>
  );
}
