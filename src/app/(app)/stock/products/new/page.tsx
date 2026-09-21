import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { unitLabel } from "@/lib/unit";
import { PageHeader } from "@/components/ui";
import { AddForm } from "./add-form";

export default async function AddStockPage() {
  await requireSession(["WAREHOUSE", "PRODUCTION"]);
  const [products, warehouses] = await Promise.all([
    db.product.findMany({ where: { isActive: true, unit: { not: "m3" } }, orderBy: { code: "asc" } }),
    db.warehouse.findMany({ where: { isActive: true } }),
  ]);
  return (
    <div>
      <PageHeader back={{ href: "/stock?tab=capacity", label: "Sklad" }} title="Tayyor mahsulot qo'shish" subtitle="Hovliga chiqarilgan dona mahsulotni qo'lda kirim qilish. Qoldiq Sklad → Ishlab chiqarish imkoni bo'limida ko'rinadi; retsept bo'yicha zames qilmoqchi bo'lsangiz — Ishlab chiqarish sahifasi." />
      <AddForm products={products.map((p) => ({ id: p.id, name: p.name, unit: unitLabel(p.unit) }))} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} />
    </div>
  );
}
