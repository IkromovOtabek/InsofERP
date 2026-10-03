import Link from "next/link";
import { notFound } from "next/navigation";
import { History, MapPin, Package, Timer } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { geoSearchEnabled } from "@/lib/geo";
import { minutesLabel, orderLogistics, tripPhase } from "@/lib/logistics";
import { dateTime, deliveryAt, qty } from "@/lib/format";
import { Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { SiteForm } from "../site-form";
import { OrderLogiBadge, PhaseBadge, TripLink } from "../../ui";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRoles(["LOGISTICS", "SALES"], { module: "logistika" });
  const { id } = await params;
  const s = await db.site.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      orders: {
        orderBy: { deliveryDate: "desc" }, take: 50,
        include: {
          items: { select: { qtyM3: true, product: { select: { unit: true, name: true } } } },
          trips: { include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, issues: { select: { resolvedAt: true } } }, orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!s) notFound();
  const customers = await db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const trips = s.orders.flatMap((o) => o.trips.map((t) => ({ ...t, orderNo: o.orderNo })));
  const delivered = trips.filter((t) => t.status === "DELIVERED");
  const durations = delivered.filter((t) => t.loadedAt && t.deliveredAt).map((t) => (t.deliveredAt!.getTime() - t.loadedAt!.getTime()) / 60000);
  const unload = delivered.filter((t) => t.arrivedAt && t.deliveredAt).map((t) => (t.deliveredAt!.getTime() - t.arrivedAt!.getTime()) / 60000);
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

  return (
    <div>
      <PageHeader back={{ href: "/logistika/obyektlar", label: "Obyektlar" }} title={s.name}
        subtitle={<><Link href={`/customers/${s.customer.id}`} className="hover:underline">{s.customer.name}</Link> · {s.address}</>} />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Zayavkalar" value={s.orders.length} icon={History} />
        <StatCard label="Yetkazilgan" value={qty(delivered.reduce((a, t) => a + Number(t.qtyM3), 0))} hint={`${delivered.length} reys`} icon={Package} tone="success" />
        <StatCard label="O'rtacha yo'l" value={minutesLabel(avg(durations))} hint="yuklashdan topshirishgacha" icon={Timer} />
        <StatCard label="O'rtacha tushirish" value={minutesLabel(avg(unload))} hint="yetib kelgandan topshirishgacha" icon={MapPin} />
      </div>
      <Card className="mb-5"><CardHeader title="Obyekt kartasi" icon={MapPin} /><SiteForm customers={customers} searchEnabled={geoSearchEnabled()} s={{ id: s.id, customerId: s.customerId, name: s.name, address: s.address, lat: s.lat, lng: s.lng, contactName: s.contactName, contactPhone: s.contactPhone, deliveryHours: s.deliveryHours, instructions: s.instructions, isActive: s.isActive }} /></Card>

      <Card padded={false} className="mb-5">
        <div className="px-5 pt-5"><CardHeader title="Buyurtmalar" icon={History} /></div>
        <Table>
          <thead><tr><Th>Zayavka</Th><Th>Mahsulot</Th><Th right>Hajm</Th><Th>Yetkazish</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {s.orders.length === 0 && <Empty text="Zayavka yo'q" />}
            {s.orders.map((o) => { const l = orderLogistics(o); return (
              <Tr key={o.id}><Td><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link></Td><Td className="text-sm">{o.items.map((i) => i.product.name).join(", ")}</Td><Td right className="tabular">{qty(l.total)}</Td><Td className="text-sm tabular">{deliveryAt(o.deliveryDate, o.deliveryTime)}</Td><Td><OrderLogiBadge status={l.status} late={l.late} problem={l.problem} /></Td></Tr>
            ); })}
          </tbody>
        </Table>
      </Card>

      <Card padded={false}>
        <div className="px-5 pt-5"><CardHeader title="Yetkazib berish tarixi" icon={Package} /></div>
        <Table>
          <thead><tr><Th>Nakladnoy</Th><Th>Transport</Th><Th right>Hajm</Th><Th right>Qabul</Th><Th>Bosqich</Th><Th>Yetkazildi</Th><Th>Qabul qildi</Th></tr></thead>
          <tbody>
            {trips.length === 0 && <Empty text="Reys yo'q" />}
            {trips.map((t) => (
              <Tr key={t.id}>
                <Td><TripLink id={t.id} noteNo={t.deliveryNoteNo} /><div className="text-xs text-slate-500">{t.orderNo}</div></Td>
                <Td className="text-sm"><span className="tabular">{t.vehicle.plate}</span><div className="text-xs text-slate-500">{t.driver.fullName}</div></Td>
                <Td right className="tabular">{qty(t.qtyM3)}</Td>
                <Td right className="tabular">{t.acceptedQty != null ? qty(t.acceptedQty) : "—"}</Td>
                <Td><PhaseBadge phase={tripPhase(t)} /></Td>
                <Td className="text-sm tabular">{t.deliveredAt ? dateTime(t.deliveredAt) : "—"}</Td>
                <Td className="text-sm">{t.receiverName ?? "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
