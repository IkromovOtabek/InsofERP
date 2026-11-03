import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { productCatalog } from "@/lib/product-catalog";
import { productCreateLevel } from "@/lib/catalog";
import { geoSearchEnabled } from "@/lib/geo";
import { unitLabel } from "@/lib/unit";
import { isoDate } from "@/lib/format";
import { withoutNds } from "@/lib/nds";
import { isEditable } from "@/lib/orders";
import { OrderEditForm, type OrderEditData } from "./edit-form";

/**
 * Ochilgan zayavkani tahrirlash — ishlab chiqarish boshlanguncha (qoralama, bloklangan, tasdiqlangan; zames va reys yo'q).
 * Mijoz zayavkasi — sotuv va ish boshqaruvchi («orders → edit»), sklad zayavkasi — «orders → stock».
 * Qoida va cheklovlar `lib/orders.ts` → `orderEdit` da; bu sahifa faqat formani to'ldirib beradi.
 */
export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePage("/orders");
  const o = await db.order.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      items: { include: { product: { select: { id: true, code: true, name: true, unit: true, price: true, groupId: true } }, tasks: { select: { qty: true, doneQty: true, status: true } } } },
      batches: { where: { cancelledAt: null }, select: { id: true } },
      trips: { select: { id: true } },
      invoices: { where: { status: { not: "CANCELLED" } }, select: { invoiceNo: true } },
      payments: { select: { amount: true } },
    },
  });
  if (!o) notFound();
  const isStock = o.kind === "STOCK";
  if (!canDo(s, "orders", isStock ? "stock" : "edit") || !isEditable(o)) redirect(`/orders/${id}`);

  const [catalog, sites] = await Promise.all([
    productCatalog(isStock ? { pieceOnly: true } : {}),
    isStock ? [] : db.site.findMany({ where: { customerId: o.customerId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, address: true, lat: true, lng: true } }),
  ]);
  // Arxivlangan mahsulot qatorda qolgan bo'lsa ham ro'yxatda ko'rinsin
  const products = [...catalog.products];
  for (const i of o.items) {
    if (!products.some((p) => p.id === i.productId)) {
      products.push({ id: i.product.id, code: i.product.code, name: i.product.name, kind: null, unit: unitLabel(i.product.unit), price: i.product.price.toString(), groupId: i.product.groupId, rawUnit: i.product.unit, hasRecipe: false });
    }
  }

  const data: OrderEditData = {
    id: o.id, kind: o.kind, status: o.status, customerName: o.customer.name,
    items: o.items.map((i) => ({
      id: i.id, productId: i.productId, qty: Number(i.qtyM3),
      // Formada narx NDS'siz turadi — saqlashda «QQS 12%» belgilangan qatorga soliq qayta qo'shiladi
      price: i.nds ? withoutNds(Number(i.price)) : Number(i.price), nds: i.nds,
      // Brigadaga berilgan qator: o'chmaydi, mahsuloti almashmaydi, soni berilgan/bajarilganidan kam bo'lmaydi
      locked: i.tasks.length > 0,
      min: Math.max(i.tasks.filter((t) => t.status !== "CANCELLED").reduce((a, t) => a + Number(t.qty), 0), i.tasks.reduce((a, t) => a + Number(t.doneQty), 0)),
    })),
    deliveryDate: isoDate(o.deliveryDate), dateUnknown: o.dateUnknown,
    deliveryAddress: o.deliveryAddress, lat: o.lat, lng: o.lng,
    needsPump: o.needsPump, needsDelivery: o.needsDelivery, deliveryFee: Number(o.deliveryFee), isUrgent: o.isUrgent, note: o.note ?? "",
    onCredit: o.onCredit, prepayAmount: Number(o.prepayAmount ?? 0), payMethod: o.payMethod,
    advance: o.payments.reduce((a, p) => a + Number(p.amount), 0),
    invoices: o.invoices.map((i) => i.invoiceNo),
  };

  return (
    <div>
      <PageHeader back={{ href: `/orders/${id}`, label: "Zayavka" }} title={isStock ? "Sklad zayavkasini tahrirlash" : "Zayavkani tahrirlash"} subtitle={isStock ? "Zaxiraga ishlab chiqarish" : o.customer.name} />
      <OrderEditForm data={data} products={products} groups={catalog.groups} canCreateProduct={productCreateLevel(s.role)} sites={sites} geoSearch={geoSearchEnabled()} />
    </div>
  );
}
