import { requireRoles } from "@/lib/page-guard";
import { isoDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ShipmentForm } from "../shipment-form";
import { shipmentFormData } from "../form-data";

export default async function NewShipmentPage() {
  await requireRoles(["PROCUREMENT"], { module: "stock", actions: ["shipment"] });
  const d = await shipmentFormData();
  return (
    <div>
      <PageHeader back={{ href: "/jonatma", label: "Jo'natmalar" }} title="Yangi jo'natma" subtitle="Olib kelgan mahsulotlar nakladnoyini kiriting va skladga jo'nating — sklad tekshirib qabul qiladi" />
      <ShipmentForm {...d} initial={{ supplierId: "", warehouseId: d.warehouses[0]?.id ?? "", date: isoDate(), waybillNo: "", payment: "", carrier: "", note: "", rows: [] }} />
    </div>
  );
}
