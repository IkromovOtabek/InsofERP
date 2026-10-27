import { db } from "@/lib/db";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { productCatalog } from "@/lib/product-catalog";
import { canEditProducts } from "@/lib/catalog";
import { offerDefaults } from "@/lib/offers";
import { withoutNds } from "@/lib/nds";
import { date } from "@/lib/format";
import { PageHeader, Card } from "@/components/ui";
import { OfferForm, type OfferCustomerOpt, type OfferPrefill } from "../offer-form";

/**
 * Yangi tijorat taklifi. Qayerdan ochilganiga qarab forma oldindan to'ldiriladi:
 *  · `?order=` — zayavka (mijoz, mahsulotlar, narx); `?customer=` — mijoz kartasi;
 *  · `?lead=` — sayt arizasi (ism, telefon, mahsulot); `?copy=` — mavjud taklifdan nusxa (yangilangan narx uchun).
 */
export default async function NewOfferPage({ searchParams }: { searchParams: Promise<{ order?: string; customer?: string; lead?: string; copy?: string }> }) {
  await requirePage("/takliflar");
  const s = await requireRoles(["SALES"], { module: "offers", actions: ["create"] });
  const sp = await searchParams;

  const [catalog, defaults, customers] = await Promise.all([
    productCatalog(),
    offerDefaults(),
    db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true, inn: true, address: true } }),
  ]);
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  const netPrice = (price: unknown, nds: boolean) => (nds ? withoutNds(Number(price)) : Number(price));

  let prefill: OfferPrefill | undefined;
  if (sp.order) {
    const o = await db.order.findUnique({ where: { id: sp.order }, include: { customer: true, items: { include: { product: true } } } });
    if (o && o.kind === "SALE") {
      prefill = {
        customerId: o.customerId, clientName: o.customer.name, clientPhone: o.customer.phone, clientInn: o.customer.inn,
        objectName: o.deliveryAddress, orderId: o.id, note: `${date(o.deliveryDate)} sanali zayavka asosida`,
        items: o.items.map((i) => ({ productId: i.productId, name: i.product.name, unit: i.product.unit, qty: Number(i.qtyM3), price: netPrice(i.price, i.nds) })),
      };
    }
  } else if (sp.copy) {
    const o = await db.commercialOffer.findUnique({ where: { id: sp.copy }, include: { items: { orderBy: { sort: "asc" } } } });
    if (o) {
      prefill = {
        customerId: o.customerId, clientName: o.clientName, clientPhone: o.clientPhone, clientInn: o.clientInn, objectName: o.objectName,
        orderId: o.orderId, leadId: o.leadId, note: `${o.offerNo} dan nusxa`,
        items: o.items.map((i) => ({ productId: i.productId && byId.has(i.productId) ? i.productId : null, name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })),
      };
    }
  } else if (sp.lead) {
    const l = await db.lead.findUnique({ where: { id: sp.lead }, include: { product: true, customer: true } });
    if (l) {
      prefill = {
        customerId: l.customerId, clientName: l.customer?.name ?? l.name, clientPhone: l.phone, clientInn: l.customer?.inn ?? null, objectName: l.address,
        leadId: l.id, note: "Sayt arizasi asosida",
        items: l.product ? [{ productId: l.product.id, name: l.product.name, unit: l.product.unit, qty: l.qty ? Number(l.qty) : 0, price: Number(l.product.price) }] : undefined,
      };
    }
  } else if (sp.customer) {
    const c = customers.find((x) => x.id === sp.customer);
    if (c) prefill = { customerId: c.id, clientName: c.name, clientPhone: c.phone, clientInn: c.inn, objectName: c.address };
  }

  return (
    <>
      <PageHeader back={{ href: "/takliflar", label: "Tijorat takliflari" }} title="Yangi tijorat taklifi" subtitle="Zayavka shart emas — potensial mijozga ham tuziladi. Saqlangach A4 hujjat va QR havolasi tayyor bo'ladi." />
      <Card>
        <OfferForm customers={customers as OfferCustomerOpt[]} products={catalog.products} groups={catalog.groups} defaults={defaults} prefill={prefill} canCreateProduct={canEditProducts(s.role)} />
      </Card>
    </>
  );
}
