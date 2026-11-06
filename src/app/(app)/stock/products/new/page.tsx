import { db } from "@/lib/db";
import { productCatalog } from "@/lib/product-catalog";
import { canEditProducts } from "@/lib/catalog";
import { requireRoles } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { isoDate } from "@/lib/format";
import { ISSUE_BACK_DAYS } from "@/lib/stock-issue";
import { AddForm } from "./add-form";

/**
 * Sklad → Tayyor mahsulot qo'shish. Mahsulot zayavkadagi bilan bir xil 1C uslubidagi
 * spravochnikdan tanlanadi (papkalar, qidiruv, yangi mahsulot qo'shish) — shuning uchun
 * zayavkada ochilgan mahsulot shu yerda ham darrov ko'rinadi.
 * Beton (m³) hovlida saqlanmaydi, shuning uchun ro'yxatga tushmaydi.
 * Bir formada bir nechta qator va sana: kirim tanlangan kunga yoziladi (bugun yoki o'tgan 31 kun).
 */
export default async function AddStockPage() {
  const s = await requireRoles(["WAREHOUSE", "PRODUCTION"], { module: "stock", actions: ["products"] });
  const [catalog, warehouses] = await Promise.all([
    productCatalog({ pieceOnly: true }), // hamma joyda bir xil ro'yxat; beton (m³) hovlida saqlanmaydi
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  // Sana chegaralari server vaqti bilan (brauzer soati boshqa bo'lsa ham bir xil)
  const today = new Date();
  const min = new Date(today); min.setDate(min.getDate() - ISSUE_BACK_DAYS);
  return (
    <div>
      <PageHeader back={{ href: "/stock?tab=capacity", label: "Sklad" }} title="Tayyor mahsulot qo'shish" subtitle="Hovliga chiqarilgan dona mahsulotni qo'lda kirim qilish — bir yo'la bir nechta qator, tanlangan sanaga. Qoldiq Sklad → Ishlab chiqarish imkoni bo'limida ko'rinadi; retsept bo'yicha zames qilmoqchi bo'lsangiz — Ishlab chiqarish sahifasi." />
      <AddForm
        clientToken={crypto.randomUUID()}
        products={catalog.products}
        groups={catalog.groups}
        canCreateProduct={canEditProducts(s.role)}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        today={isoDate(today)}
        minDate={isoDate(min)}
      />
    </div>
  );
}
