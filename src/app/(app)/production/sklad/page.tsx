import { redirect } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { stockSnapshot } from "@/lib/stock";
import { productCatalog } from "@/lib/product-catalog";
import { productCreateLevel } from "@/lib/catalog";
import { PageHeader } from "@/components/ui";
import { StockSnapshotCard } from "@/components/stock-snapshot";
import type { ProductStock } from "../../orders/order-form";
import { StockOrderForm } from "../stock-order-form";

/**
 * Ishlab chiqarish → «Skladga zayavka»: zaxiraga ishlab chiqarish (mijozsiz, narxsiz; `lib/stock-orders.ts`).
 * Saqlangach zayavka darhol qabul qilinadi va `/production?order=…` da brigada tayinlash ochiladi —
 * matritsa va doskada ham ko'rinadi. Ochish ruxsati — `orders` → `stock` (sklad zayavkasini qabul qilish ham shu).
 */
export default async function NewStockOrder() {
  const s = await requirePage("/production/sklad");
  if (!canDo(s, "orders", "stock")) redirect("/production");
  const [catalog, stock] = await Promise.all([productCatalog(), stockSnapshot()]);

  // Mahsulot yonidagi izoh: hovlida erkin nechta bor va xomashyodan yana qancha chiqadi
  const productStock: ProductStock = Object.fromEntries(
    stock.pieces.map((p) => [p.id, { free: p.free, total: p.total, owned: p.owned, canMake: p.make?.canMake ?? null, by: p.last?.by ?? null, kind: "piece" as const }] as const),
  );
  // Zaxiraga faqat dona mahsulot qo'yiladi: beton zakaz olingandan keyin tayyorlanadi
  const pieceProducts = catalog.products.filter((p) => p.rawUnit !== "m3");

  return (
    <div>
      <PageHeader
        back={{ href: "/production", label: "Ishlab chiqarish" }}
        title="Skladga zayavka"
        subtitle="Zaxiraga ishlab chiqarish: mahsulot hovlida erkin qoldiq bo'lib turadi. Saqlangach brigadaga tayinlaysiz."
      />
      <div className="space-y-5">
        <StockOrderForm products={pieceProducts} groups={catalog.groups} canCreateProduct={productCreateLevel(s.role)} stock={productStock} />
        {/* Uzun jadval formani siqib qo'ymasligi uchun bo'limlar yig'iladi */}
        <StockSnapshotCard compact collapsible />
      </div>
    </div>
  );
}
