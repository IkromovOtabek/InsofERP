import { notFound, redirect } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { DELIVERY_EDIT_STATUSES, isEditable } from "@/lib/orders";
import { geoSearchEnabled } from "@/lib/geo";
import { isoDate, qty } from "@/lib/format";
import { lastEdits } from "@/lib/audit";
import { Callout, LinkButton, PageHeader } from "@/components/ui";
import { EditedMark } from "@/components/edited-mark";
import { DeliveryForm } from "./delivery-form";

export const dynamic = "force-dynamic";

/**
 * «Buyurtmalar» qatoridagi qalamcha — alohida sahifa (shu tabda). Logistika yetkazish ma'lumotlarini o'zgartiradi;
 * mahsulot/miqdor/narx — sotuvning to'liq tahriri (ruxsat bo'lsa va ishlab chiqarish boshlanmagan bo'lsa havola chiqadi).
 */
export default async function EditDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireRoles(["LOGISTICS"], { module: "logistika" });
  if (!canDo(s, "logistika", "order_edit")) redirect("/logistika/buyurtmalar");
  const o = await db.order.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { name: true, unit: true } } } },
      batches: { where: { cancelledAt: null }, select: { id: true } }, trips: { select: { id: true } },
    },
  });
  if (!o) notFound();
  if (o.kind === "STOCK" || !(DELIVERY_EDIT_STATUSES as readonly string[]).includes(o.status)) redirect("/logistika/buyurtmalar");
  const [sites, edits] = await Promise.all([
    db.site.findMany({ where: { customerId: o.customerId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, address: true, lat: true, lng: true } }),
    lastEdits("Order", [id]),
  ]);
  const fullEdit = isEditable(o) && canDo(s, "orders", "edit");

  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/logistika/buyurtmalar", label: "Buyurtmalar" }} title="Buyurtmani tahrirlash"
        subtitle={<>{o.customer.name} · {o.orderNo} · {o.items.map((i) => `${i.product.name} ${qty(i.qtyM3)}`).join(", ")} <EditedMark edit={edits.get(id)} full /></>} />
      {fullEdit
        ? <div className="mb-4"><LinkButton href={`/orders/${id}/edit`} variant="secondary"><PackageCheck size={16} /> To&apos;liq tahrirlash (mahsulot, miqdor, narx, to&apos;lov)</LinkButton></div>
        : <Callout tone="info">Mahsulot, miqdor va narx bu yerda o&apos;zgarmaydi — ularni sotuv bo&apos;limi zayavkaning to&apos;liq tahririda o&apos;zgartiradi.</Callout>}
      <DeliveryForm geoSearch={geoSearchEnabled()} sites={sites} data={{
        id, deliveryDate: isoDate(o.deliveryDate), dateUnknown: o.dateUnknown, deliveryTime: o.deliveryTime ?? "",
        deliveryAddress: o.deliveryAddress, lat: o.lat, lng: o.lng, needsPump: o.needsPump, isUrgent: o.isUrgent, note: o.note ?? "",
      }} />
    </div>
  );
}
