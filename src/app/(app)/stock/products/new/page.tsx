import { db } from "@/lib/db";
import { productCatalog } from "@/lib/product-catalog";
import { canEditProducts } from "@/lib/catalog";
import { canDo } from "@/lib/permissions";
import { requireRoles } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { isoDate } from "@/lib/format";
import { ISSUE_BACK_DAYS } from "@/lib/stock-issue";
import { brigadeLabel } from "@/lib/issue-target";
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
  const [catalog, warehouses, brigades] = await Promise.all([
    productCatalog({ pieceOnly: true }), // hamma joyda bir xil ro'yxat; beton (m³) hovlida saqlanmaydi
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leader: { select: { fullName: true } } } }),
  ]);
  // Sana chegaralari server vaqti bilan (brauzer soati boshqa bo'lsa ham bir xil)
  const today = new Date();
  const min = new Date(today); min.setDate(min.getDate() - ISSUE_BACK_DAYS);
  return (
    <div>
      <PageHeader back={{ href: "/stock?tab=capacity", label: "Sklad" }} title="Tayyor mahsulot qo'shish" subtitle="Dona mahsulotni qo'lda kirim qilish: har qatorda qaysi brigada omboriga va nechta. Bitta mahsulotni bir nechta brigadaga bo'lish — qatordagi «bo'lish» tugmasi. Qoldiq Sklad → Ishlab chiqarish imkoni → «Brigada omborlari» da ko'rinadi." />
      <AddForm
        clientToken={crypto.randomUUID()}
        products={catalog.products}
        groups={catalog.groups}
        // Qator qo'shish ruxsati (`stock.products`) «Yangi mahsulot» va «Nomini tahrirlash»ni ham beradi;
        // tanlagichdagi o'chirish/Excel/birlashtirish — avvalgidek faqat spravochnik rollarida
        canCreateProduct={canEditProducts(s.role) ? true : canDo(s, "stock", "products") ? "add" : false}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        brigades={brigades.map((b) => ({ id: b.id, name: brigadeLabel({ name: b.name, leader: b.leader?.fullName ?? null }) }))}
        today={isoDate(today)}
        minDate={isoDate(min)}
      />
    </div>
  );
}
