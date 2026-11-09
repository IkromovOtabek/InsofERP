import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { brigadeNames } from "@/lib/brigade-products";
import { DistributeForm } from "./distribute-form";

/**
 * Sklad → Hovli → «Brigadalarga ajratish»: tayyor dona mahsulotni bir ombordan (odatda umumiy hovlidan — avvalgi kirimlar)
 * brigada omboriga bir yo'la ko'p mahsulot bilan o'tkazish. Sklad jami o'zgarmaydi (`lib/brigade-products.ts`).
 * Ruxsat — «Tayyor mahsulot qo'shish» bilan bir xil (`stock` → `products`, perm-buttons «hovli» oynasi `/stock/products`).
 */
export default async function DistributePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireRoles(["WAREHOUSE", "PRODUCTION"], { module: "stock", actions: ["products"] });
  const sp = await searchParams;
  const [sums, products, brigades, names, warehouses] = await Promise.all([
    db.stockMove.groupBy({ by: ["warehouseId", "productId", "ownerBrigadeId"], where: { productId: { not: null }, product: { unit: { not: "m3" } } }, _sum: { qty: true } }),
    db.product.findMany({ where: { unit: { not: "m3" } }, select: { id: true, name: true, unit: true } }),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true } }),
    brigadeNames(),
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  const meta = new Map(products.map((p) => [p.id, p]));
  const balances = sums
    .map((x) => ({ warehouseId: x.warehouseId, productId: x.productId!, owner: x.ownerBrigadeId ?? "umumiy", qty: Math.round(Number(x._sum.qty ?? 0) * 1000) / 1000 }))
    .filter((x) => x.qty > 0.0005 && meta.has(x.productId));
  // Manba bo'la oladigan omborlar nomi: nofaol brigadada qoldiq qolgan bo'lsa ham undan olib chiqish mumkin
  const ownerNames = Object.fromEntries([...new Set(balances.map((b) => b.owner))].filter((o) => o !== "umumiy").map((o) => [o, names.get(o) ?? "Brigada"]));
  return (
    <div>
      <PageHeader back={{ href: "/stock?bolim=hovli#hovli", label: "Hovli" }} title="Brigadalarga ajratish"
        subtitle="Hovlidagi tayyor mahsulotni brigada omborlariga bo'lish: qayerdan (odatda umumiy hovli) va qaysi brigadaga, keyin har mahsulotga nechta. Sklad jami o'zgarmaydi — faqat qaysi brigada javobgarligida turgani." />
      <DistributeForm
        clientToken={crypto.randomUUID()}
        balances={balances}
        products={Object.fromEntries(balances.map((b) => [b.productId, { name: meta.get(b.productId)!.name, unit: meta.get(b.productId)!.unit }]))}
        brigades={brigades.map((b) => ({ id: b.id, name: names.get(b.id) ?? "Brigada" }))}
        ownerNames={ownerNames}
        warehouses={warehouses}
        initialFrom={sp.from ?? "umumiy"}
        initialTo={sp.to ?? ""}
      />
    </div>
  );
}
