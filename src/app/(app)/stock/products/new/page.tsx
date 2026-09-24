import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { unitLabel } from "@/lib/unit";
import { PageHeader } from "@/components/ui";
import { AddForm } from "./add-form";

/**
 * Sklad → Tayyor mahsulot qo'shish. Mahsulot zayavkadagi bilan bir xil 1C uslubidagi
 * spravochnikdan tanlanadi (papkalar, qidiruv, yangi mahsulot qo'shish) — shuning uchun
 * zayavkada ochilgan mahsulot shu yerda ham darrov ko'rinadi.
 * Beton (m³) hovlida saqlanmaydi, shuning uchun ro'yxatga tushmaydi.
 */
export default async function AddStockPage() {
  const s = await requireSession(["WAREHOUSE", "PRODUCTION"]);
  const [products, groups, warehouses] = await Promise.all([
    db.product.findMany({ where: { isActive: true, unit: { not: "m3" } }, orderBy: { code: "asc" } }),
    db.productGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    db.warehouse.findMany({ where: { isActive: true } }),
  ]);
  return (
    <div>
      <PageHeader back={{ href: "/stock?tab=capacity", label: "Sklad" }} title="Tayyor mahsulot qo'shish" subtitle="Hovliga chiqarilgan dona mahsulotni qo'lda kirim qilish. Qoldiq Sklad → Ishlab chiqarish imkoni bo'limida ko'rinadi; retsept bo'yicha zames qilmoqchi bo'lsangiz — Ishlab chiqarish sahifasi." />
      <AddForm
        products={products.map((p) => ({ id: p.id, code: p.code, name: p.name, kind: p.kind, groupId: p.groupId, price: p.price.toString(), unit: unitLabel(p.unit) }))}
        groups={groups}
        canCreateProduct={["WAREHOUSE", "PRODUCTION", "DIRECTOR"].includes(s.role)}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
      />
    </div>
  );
}
