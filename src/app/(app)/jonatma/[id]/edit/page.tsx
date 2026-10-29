import { notFound, redirect } from "next/navigation";
import { requireRoles } from "@/lib/page-guard";
import { getShipment } from "@/lib/shipments";
import { PageHeader } from "@/components/ui";
import { ShipmentForm } from "../../shipment-form";
import { shipmentFormData } from "../../form-data";

export default async function EditShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRoles(["PROCUREMENT"], { module: "stock", actions: ["shipment"] });
  const { id } = await params;
  const [sh, d] = await Promise.all([getShipment(id), shipmentFormData()]);
  if (!sh) notFound();
  // Faqat o'z qoralamasi tahrirlanadi — jo'natilganini sklad ko'rmoqda
  if (sh.status !== "DRAFT" || (s.role !== "DIRECTOR" && sh.createdById !== s.userId)) redirect(`/jonatma/${id}`);
  return (
    <div>
      <PageHeader back={{ href: `/jonatma/${id}`, label: sh.docNo }} title={`${sh.docNo} — tahrirlash`} subtitle="Qoralama — skladga hali ko'rinmaydi" />
      <ShipmentForm {...d} initial={{
        id: sh.id, supplierId: sh.supplierId, warehouseId: sh.warehouseId, date: sh.date.toISOString().slice(0, 10), waybillNo: sh.waybillNo ?? "",
        payment: sh.payment ?? "", carrier: sh.carrier ?? "", note: sh.note ?? "",
        rows: sh.items.map((i, n) => ({ key: n + 1, category: i.category, isNew: !i.materialId, materialId: i.materialId ?? "", name: i.materialId ? "" : i.name, unit: i.unit, qty: String(Number(i.qty)), price: String(Number(i.price)) })),
      }} />
    </div>
  );
}
