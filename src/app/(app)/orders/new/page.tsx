import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { customersCredit, customersHistory, contractedIds } from "@/lib/finance";
import { stockSnapshot } from "@/lib/stock";
import { PageHeader } from "@/components/ui";
import { StockSnapshotCard } from "@/components/stock-snapshot";
import { OrderForm, type CustomerOpt, type ProductStock } from "../order-form";
import { StockOrderForm } from "../stock-order-form";
import { NewOrderMode } from "../new-order-mode";
import { STOCK_ORDER_ROLES } from "@/lib/stock-orders";
import { geoSearchEnabled } from "@/lib/geo";
import { CONTRACT_ACCEPT } from "@/lib/uploads";
import { productCatalog } from "@/lib/product-catalog";
import { canEditProducts } from "@/lib/catalog";

/**
 * Yangi zayavka ikki xil bo'ladi:
 *  — Mijoz uchun: odatdagi sotuv formasi (narx, to'lov, shartnoma, yetkazish);
 *  — Sklad uchun: zaxiraga ishlab chiqarish — mijozsiz, narxsiz; tayyor mahsulot
 *    hovlida erkin qoldiq bo'lib turadi (`lib/stock-orders.ts`).
 * `?tur=sklad` bilan to'g'ridan-to'g'ri sklad formasi ochiladi.
 * Sotuvdan tashqari rollar (sklad, ishlab chiqarish) faqat sklad zayavkasini ocha oladi.
 */
export default async function NewOrder({ searchParams }: { searchParams: Promise<{ customer?: string; tur?: string }> }) {
  const s = await requireSession([...STOCK_ORDER_ROLES]);
  const { customer, tur } = await searchParams;
  const canSale = ["SALES", "DIRECTOR"].includes(s.role);

  const [catalog, stock, cashAccounts] = await Promise.all([
    productCatalog(), // hamma joyda bir xil mahsulot ro'yxati
    stockSnapshot(),
    canSale
      ? db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], distinct: ["name"], select: { id: true, name: true, type: true } })
      : [],
  ]);

  // Zayavka qabul qilayotgan xodim har mahsulot bo'yicha nima borligini ko'rishi uchun:
  // hovlidagi dona mahsulot va beton — ikkalasi ham, xomashyodan yana qancha chiqishi bilan.
  const productStock: ProductStock = Object.fromEntries([
    ...stock.pieces.map((p) => [p.id, { free: p.free, total: p.total, owned: p.owned, canMake: p.make?.canMake ?? null, by: p.last?.by ?? null, kind: "piece" as const }] as const),
    ...stock.concrete.map((p) => [p.id, { free: p.free, total: p.total, owned: 0, canMake: p.make?.canMake ?? null, by: p.last?.by ?? null, kind: "concrete" as const }] as const),
  ]);

  let opts: CustomerOpt[] = [];
  if (canSale) {
    const credit = await customersCredit();
    const [customers, history, contracted] = await Promise.all([
      db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true, inn: true, address: true, createdAt: true } }),
      customersHistory(undefined, credit),
      contractedIds(),
    ]);
    opts = customers.map((c) => {
      const cr = credit.get(c.id);
      const h = history.get(c.id);
      return {
        id: c.id, name: c.name, phone: c.phone, inn: c.inn, address: c.address, since: c.createdAt.getTime(),
        limit: cr?.limit ?? 0, used: cr?.used ?? 0, free: cr?.free ?? 0, debt: cr?.debt ?? 0, blacklisted: cr?.blacklisted ?? false, contracted: contracted.has(c.id),
        bought: h?.bought ?? 0, orders: h?.orders ?? 0, paid: h?.paid ?? 0, lastOrderAt: h?.lastOrderAt?.getTime() ?? null,
        stars: h?.stars ?? 0, label: h?.label ?? "Yangi mijoz",
      };
    });
  }

  // Zaxiraga faqat dona mahsulot qo'yiladi: beton zakaz olingandan keyin tayyorlanadi
  const pieceProducts = catalog.products.filter((p) => p.rawUnit !== "m3");

  return (
    <div>
      <PageHeader
        title="Yangi zayavka"
        subtitle={canSale
          ? "Mijoz uchun — sotuv zayavkasi; Sklad uchun — zaxiraga ishlab chiqarish. Saqlangandan keyin “Qabul qilish” bosiladi."
          : "Sklad zayavkasi: zaxiraga ishlab chiqarish. Saqlangandan keyin “Qabul qilish” bosiladi va ishlab chiqarishga tushadi."}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <NewOrderMode
            initial={tur === "sklad" ? "stock" : "sale"}
            sale={canSale ? (
              <OrderForm customers={opts} products={catalog.products} groups={catalog.groups} canCreateProduct={canEditProducts(s.role)} stock={productStock} cashAccounts={cashAccounts} preselectCustomer={customer} contractAccept={CONTRACT_ACCEPT} geoSearch={geoSearchEnabled()} />
            ) : null}
            stock={<StockOrderForm products={pieceProducts} groups={catalog.groups} canCreateProduct={canEditProducts(s.role)} stock={productStock} />}
          />
        </div>
        <div className="xl:col-span-2">
          {/* Uzun jadval formani siqib qo'ymasligi uchun bo'limlar yig'iladi */}
          <StockSnapshotCard compact collapsible />
        </div>
      </div>
    </div>
  );
}
