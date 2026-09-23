import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { SupplyForm, type SupplyOpt } from "../supply-form";

/**
 * Sklad → «Kerakli mahsulotlar». Jadval tuziladi va bitta hujjat bo'lib zanjirga tushadi:
 * snabjeniye narx qo'yadi → ma'sul xodim tasdiqlaydi → moliya pul ajratadi → mol kelgach sklad kirimi.
 */
export default async function NewSupplyRequestPage() {
  await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION"]);
  const [warehouses, materials, sums] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, minStock: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
  ]);
  const bal = new Map(sums.map((s) => [s.materialId, Number(s._sum.qty ?? 0)]));
  const options: SupplyOpt[] = materials.map((m) => ({
    id: m.id, name: m.name, code: m.code, unit: m.unit,
    balance: bal.get(m.id) ?? 0, minStock: Number(m.minStock),
  }));
  const low = options.filter((o) => o.minStock > 0 && o.balance < o.minStock);

  return (
    <div>
      <PageHeader back={{ href: "/stock", label: "Sklad" }} title="Kerakli mahsulotlar jadvali"
        subtitle="Skladga nima kerakligini yozasiz — jadval snabjeniyega ketadi, u narx qo'yadi va jami summa chiqadi." />
      <Card><SupplyForm options={options} low={low} warehouses={warehouses} /></Card>
    </div>
  );
}
