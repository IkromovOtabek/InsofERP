import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date, dateTime, money } from "@/lib/format";
import { MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";
import { getShipment, shipmentRights, SHIPMENT_STATUS_COLOR, SHIPMENT_STATUS_LABEL } from "@/lib/shipments";
import { Badge, Callout, Card, CardHeader, DL, LinkButton, PageHeader, StatusSteps } from "@/components/ui";
import { ItemsPanel } from "./items-panel";
import { ShipmentButtons } from "./shipment-buttons";

const STEPS = [
  { key: "DRAFT", label: "Kiritildi" },
  { key: "SENT", label: "Skladga jo'natildi" },
  { key: "PARTIAL", label: "Qabul qilinmoqda" },
  { key: "DONE", label: "Yakunlandi" },
];

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRoles(["PROCUREMENT", "WAREHOUSE"], { module: "stock" });
  const { id } = await params;
  const sh = await getShipment(id);
  if (!sh) notFound();
  // Snabjenets — faqat o'zinikini; qoralamani sklad ko'rmaydi
  const own = sh.createdById === s.userId;
  if ((s.role === "PROCUREMENT" && !own) || (sh.status === "DRAFT" && !own && s.role !== "DIRECTOR")) notFound();

  const can = shipmentRights(sh, { userId: s.userId, role: s.role }, { send: canDo(s, "stock", "shipment"), accept: canDo(s, "stock", "shipment_accept") });
  const accepted = sh.items.filter((i) => i.status === "ACCEPTED").length;
  const rejected = sh.items.filter((i) => i.status === "REJECTED").length;
  const pending = sh.items.length - accepted - rejected;
  const receipts = [...new Map(sh.items.filter((i) => i.receipt).map((i) => [i.receipt!.id, i.receipt!])).values()];

  return (
    <div>
      <PageHeader
        back={{ href: "/jonatma", label: "Jo'natmalar" }}
        eyebrow={`${sh.supplier.name} · ${date(sh.date)}`}
        title={`Jo'natma ${sh.docNo}`}
        subtitle={`${sh.items.length} qator · ${sh.createdBy.fullName}`}
        action={can.edit ? <LinkButton href={`/jonatma/${sh.id}/edit`} variant="secondary"><Pencil size={16} /> Tahrirlash</LinkButton> : undefined}
      />

      {sh.status !== "CANCELLED" && <div className="mb-4"><StatusSteps steps={STEPS} current={sh.status} /></div>}

      {can.accept && pending > 0 && (
        <Callout tone="warning" title="Yangi mahsulotlar keldi — qabul qiling">
          Mahsulotlarni sanab tekshiring. Hammasi to&apos;g&apos;ri bo&apos;lsa «Hammasini qabul qilish», aks holda faqat kelganlarini belgilang va
          fakt miqdorni yozing. Qabul qilingan qatorlar shu zahoti sklad qoldig&apos;iga kirim bo&apos;lib tushadi.
        </Callout>
      )}
      {sh.status === "DRAFT" && <Callout tone="info" title="Qoralama">Skladga hali ko&apos;rinmaydi — tekshirib, «Skladga jo&apos;natish»ni bosing.</Callout>}
      {sh.status === "CANCELLED" && <Callout tone="danger" title="Qaytarib olingan">{sh.cancelledAt ? dateTime(sh.cancelledAt) : ""}{sh.note ? ` · ${sh.note}` : ""}</Callout>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <ItemsPanel shipmentId={sh.id} canAccept={can.accept} items={sh.items.map((i) => ({
            id: i.id, name: i.material?.name ?? i.name, code: i.material?.code ?? null, isNew: !i.materialId, category: MATERIAL_CATEGORY_LABEL[i.category],
            unit: i.unit, qty: Number(i.qty), price: Number(i.price), status: i.status,
            acceptedQty: i.acceptedQty == null ? null : Number(i.acceptedQty), rejectReason: i.rejectReason,
            receipt: i.receipt, decidedBy: i.decidedBy?.fullName ?? null, decidedAt: i.decidedAt ? dateTime(i.decidedAt) : null,
          }))} />
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Nakladnoy" />
            <DL items={[
              { k: "Holat", v: <Badge color={SHIPMENT_STATUS_COLOR[sh.status]}>{SHIPMENT_STATUS_LABEL[sh.status]}</Badge> },
              { k: "Yetkazuvchi", v: sh.supplier.name },
              { k: "Sklad", v: sh.warehouse.name },
              { k: "Sana", v: date(sh.date) },
              { k: "Nakladnoy №", v: sh.waybillNo },
              { k: "To'lov", v: sh.payment === "BANK" ? "Perechisleniye" : sh.payment === "CASH" ? "Naqd" : null },
              { k: "Kim olib keldi", v: sh.carrier },
              { k: "Snabjenets", v: sh.createdBy.fullName },
              { k: "Jo'natildi", v: sh.sentAt ? dateTime(sh.sentAt) : null },
              { k: "Qatorlar", v: `${accepted} qabul · ${rejected} rad · ${pending} kutmoqda` },
              { k: "Summa", v: money(sh.items.reduce((a, i) => a + Number(i.qty) * Number(i.price), 0)) },
            ]} />
            {sh.note && sh.status !== "CANCELLED" && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{sh.note}</p>}
          </Card>
          {receipts.length > 0 && (
            <Card>
              <CardHeader title="Skladga kirim" description="Qabul qilingan qatorlar shu hujjatlar bilan kirim bo'ldi" />
              <ul className="space-y-1 text-sm">{receipts.map((r) => <li key={r.id}><a href={`/receipts/${r.id}`} className="font-medium underline">{r.docNo}</a></li>)}</ul>
            </Card>
          )}
          {(can.send || can.cancel) && <ShipmentButtons id={sh.id} canSend={can.send} canCancel={can.cancel} />}
        </div>
      </div>
    </div>
  );
}
