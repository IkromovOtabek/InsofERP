import { db } from "@/lib/db";
import { productCatalog } from "@/lib/product-catalog";
import { canEditProducts } from "@/lib/catalog";
import { requireSession } from "@/lib/auth";
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
  const [catalog, warehouses] = await Promise.all([
    productCatalog({ pieceOnly: true }), // hamma joyda bir xil ro'yxat; beton (m³) hovlida saqlanmaydi
    db.warehouse.findMany({ where: { isActive: true } }),
  ]);
  return (
    <div>
      <PageHeader back={{ href: "/stock?tab=capacity", label: "Sklad" }} title="Tayyor mahsulot qo'shish" subtitle="Hovliga chiqarilgan dona mahsulotni qo'lda kirim qilish. Qoldiq Sklad → Ishlab chiqarish imkoni bo'limida ko'rinadi; retsept bo'yicha zames qilmoqchi bo'lsangiz — Ishlab chiqarish sahifasi." />
      <AddForm
        products={catalog.products}
        groups={catalog.groups}
        canCreateProduct={canEditProducts(s.role)}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
      />
    </div>
  );
}
