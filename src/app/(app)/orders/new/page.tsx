import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { customersCredit, customersHistory, contractedIds, defaultCreditLimit } from "@/lib/finance";
import { stockSnapshot } from "@/lib/stock";
import { PageHeader } from "@/components/ui";
import { StockSnapshotCard } from "@/components/stock-snapshot";
import { OrderForm, type CustomerOpt, type OrderPrefill, type ProductStock } from "../order-form";
import { StockOrderForm } from "../stock-order-form";
import { NewOrderMode } from "../new-order-mode";
import { STOCK_ORDER_ROLES } from "@/lib/stock-orders";
import { canDo } from "@/lib/permissions";
import { geoSearchEnabled } from "@/lib/geo";
import { CONTRACT_ACCEPT } from "@/lib/uploads";
import { productCatalog } from "@/lib/product-catalog";
import { canEditProducts } from "@/lib/catalog";
import { getCompany } from "@/lib/company";
import { OFFER_DEFAULT_INTRO } from "@/lib/offers";
import { PrintHeaderArt, brandTitle } from "@/components/print-header-art";

/** Blanka sarlavhasi — chop etiladigan zayavka (`orders/[id]/print`) bilan bir xil: nom, kran-bino rasmi, rekvizitlar. */
async function DocHeader() {
  const c = await getCompany();
  const phones = [c.phone, c.phone2].filter(Boolean) as string[];
  const intro = c.offerIntro ?? OFFER_DEFAULT_INTRO;
  return (
    <div>
      <div className="text-center font-serif italic text-[#2f6fc9]">
        <div className="text-[30px] font-bold leading-none tracking-wide">{brandTitle(c)}</div>
        <div className="mt-1 text-[17px] font-semibold">Temir-beton mahsulotlari</div>
      </div>
      <div className="mt-2 grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <PrintHeaderArt className="mx-auto h-auto w-full max-w-[300px]" />
        <div className="text-center font-serif text-[13px] italic leading-relaxed text-slate-900">
          {c.address && <div>{c.address}</div>}
          {c.bankAccount && <div>H/r № {c.bankAccount}</div>}
          {c.bankName && <div>{c.bankName}</div>}
          <div className="flex flex-wrap justify-center gap-x-4">
            {c.mfo && <span>MFO: {c.mfo}</span>}
            {c.inn && <span>INN: {c.inn}</span>}
            {c.oked && <span>OKED: {c.oked}</span>}
          </div>
          {c.vatRegNo && <div>QQS ro&apos;yxat № {c.vatRegNo}</div>}
          {phones.map((ph) => <div key={ph}>Telefon: {ph}</div>)}
        </div>
      </div>
      {intro && <p className="mx-auto mt-3 max-w-[70ch] border-t-2 border-slate-900 pt-2 text-center font-serif text-xs italic leading-relaxed text-slate-600">{intro}</p>}
    </div>
  );
}

/**
 * Yangi zayavka ikki xil bo'ladi:
 *  — Mijoz uchun: odatdagi sotuv formasi (narx, to'lov, shartnoma, yetkazish);
 *  — Sklad uchun: zaxiraga ishlab chiqarish — mijozsiz, narxsiz; tayyor mahsulot
 *    hovlida erkin qoldiq bo'lib turadi (`lib/stock-orders.ts`).
 * `?tur=sklad` bilan to'g'ridan-to'g'ri sklad formasi ochiladi.
 * Sotuvdan tashqari rollar (sklad, ishlab chiqarish) faqat sklad zayavkasini ocha oladi.
 */
export default async function NewOrder({ searchParams }: { searchParams: Promise<{ customer?: string; tur?: string; lead?: string; amo?: string }> }) {
  // Direktor "create" yoki "stock" ruxsatini bergan xodim ham kiradi (rol ro'yxatida bo'lmasa ham)
  const s = await requireRoles([...STOCK_ORDER_ROLES], { module: "orders", actions: ["create", "stock"] });
  const { customer: customerParam, tur, lead: leadId, amo: amoId } = await searchParams;
  const canSale = canDo(s, "orders", "create");
  const canStockOrder = canDo(s, "orders", "stock");

  const [catalog, stock, lead, amoDeal] = await Promise.all([
    productCatalog(), // hamma joyda bir xil mahsulot ro'yxati
    stockSnapshot(),
    // Sayt arizasidan ochilgan zayavka: mahsulot, hajm va manzil arizadan olinadi
    canSale && leadId ? db.lead.findUnique({ where: { id: leadId }, select: { productId: true, qty: true, address: true, message: true, customerId: true } }) : null,
    // amoCRM kelishuvidan: mijoz, manzil va sdelka nomi; zayavka sdelkaga bog'lanadi (`lib/amocrm/sync.ts`)
    canSale && amoId ? db.amoDeal.findFirst({ where: { id: amoId, state: { in: ["READY", "ORDERED", "IN_AMO"] } }, select: { id: true, name: true, amoLeadId: true, address: true, customerId: true, lead: { select: { productId: true, qty: true } } } }) : null,
  ]);
  const customer = amoDeal?.customerId ?? customerParam;
  const prefill: OrderPrefill | undefined = amoDeal
    ? { productId: amoDeal.lead?.productId, qty: amoDeal.lead?.qty != null ? Number(amoDeal.lead.qty) : null, address: amoDeal.address, note: `amoCRM sdelka #${amoDeal.amoLeadId}: ${amoDeal.name}`, amoDealId: amoDeal.id }
    : lead && (!customer || lead.customerId === customer)
    ? { productId: lead.productId, qty: lead.qty != null ? Number(lead.qty) : null, address: lead.address, note: ["Sayt arizasidan", lead.message].filter(Boolean).join(": ") }
    : undefined;

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
        back={{ href: tur === "sklad" || !canSale ? "/orders?tur=sklad" : "/orders", label: "Zayavkalar" }}
        title="Yangi zayavka"
        subtitle={canSale
          ? "Mijoz uchun — sotuv zayavkasi; Sklad uchun — zaxiraga ishlab chiqarish. Saqlangandan keyin “Qabul qilish” bosiladi."
          : "Sklad zayavkasi: zaxiraga ishlab chiqarish. Saqlangandan keyin “Qabul qilish” bosiladi va ishlab chiqarishga tushadi."}
      />
      {/* Blanka keng (QQS ustunli jadval) — to'liq kenglikda; sklad qoldig'i pastda */}
      <div className="space-y-5">
        <div>
          <NewOrderMode
            initial={tur === "sklad" || !canSale ? "stock" : "sale"}
            sale={canSale ? (
              <OrderForm docHeader={<DocHeader />} managerName={s.fullName} customers={opts} products={catalog.products} groups={catalog.groups} canCreateProduct={canEditProducts(s.role)} stock={productStock} preselectCustomer={customer} prefill={prefill} contractAccept={CONTRACT_ACCEPT} geoSearch={geoSearchEnabled()} newCustomerLimit={await defaultCreditLimit()} />
            ) : null}
            stock={canStockOrder ? <StockOrderForm products={pieceProducts} groups={catalog.groups} canCreateProduct={canEditProducts(s.role)} stock={productStock} /> : null}
          />
        </div>
        <div>
          {/* Uzun jadval formani siqib qo'ymasligi uchun bo'limlar yig'iladi */}
          <StockSnapshotCard compact collapsible />
        </div>
      </div>
    </div>
  );
}
