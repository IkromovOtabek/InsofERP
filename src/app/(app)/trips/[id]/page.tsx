import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer, PackageCheck, Navigation, XCircle, Truck, Package, Clock, MapPin } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { qty, date, dateTime } from "@/lib/format";
import { Button, Card, CardHeader, DL, LinkButton, PageHeader, StatCard, StatusSteps } from "@/components/ui";
import { TripStatusBadge } from "../status";
import { markLoaded, markOnRoad, cancelTrip } from "../actions";
import { DeliverForm } from "./deliver-form";

const STEPS = [{ key: "PLANNED", label: "Rejalashtirildi" }, { key: "LOADED", label: "Yuklandi" }, { key: "ON_ROAD", label: "Yo'lda" }, { key: "DELIVERED", label: "Yetkazildi" }];
const dt = (d: Date | null) => d ? dateTime(d) : "—";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const t = await db.trip.findUnique({ where: { id }, include: { order: { include: { customer: true, items: { include: { product: true } } } }, vehicle: true, driver: true } });
  if (!t || !s) notFound();
  const canLog = ["LOGISTICS", "DIRECTOR"].includes(s.role);
  const canLoad = canLog || s.role === "PRODUCTION";

  return (
    <div>
      <PageHeader
        back={{ href: "/trips", label: "Reyslar" }}
        title={`Nakladnoy ${t.deliveryNoteNo}`}
        subtitle={`Zayavka ${t.order.orderNo} · ${t.order.customer.name}`}
        action={
          <>
            <LinkButton href={`/trips/${id}/print`} variant="secondary"><Printer size={16} /> Chop etish</LinkButton>
            {t.status === "PLANNED" && canLoad && <form action={markLoaded.bind(null, id)}><Button><PackageCheck size={16} /> Yuklandi</Button></form>}
            {t.status === "LOADED" && canLog && <form action={markOnRoad.bind(null, id)}><Button><Navigation size={16} /> Yo'lga chiqdi</Button></form>}
            {t.status === "PLANNED" && canLog && <form action={cancelTrip.bind(null, id)}><Button variant="ghost" className="text-red-600 hover:bg-red-50"><XCircle size={16} /> Bekor</Button></form>}
          </>
        }
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <StatusSteps steps={STEPS} current={t.status === "CANCELLED" ? "PLANNED" : t.status} failed={t.status === "CANCELLED"} />
          <TripStatusBadge status={t.status} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Hajm" value={`${qty(t.qtyM3)} m³`} hint={t.order.items[0]?.product.name} icon={Package} tone="brand" />
        <StatCard label="Mikser" value={<span className="tabular">{t.vehicle.plate}</span>} hint={t.driver.fullName} icon={Truck} />
        <StatCard label="Yuklandi" value={<span className="text-base">{dt(t.loadedAt)}</span>} icon={Clock} />
        <StatCard label="Yetkazildi" value={<span className="text-base">{dt(t.deliveredAt)}</span>} hint={t.receiverName ? `qabul qildi: ${t.receiverName}` : undefined} icon={Clock} tone={t.deliveredAt ? "success" : "default"} />
      </div>

      {["LOADED", "ON_ROAD"].includes(t.status) && canLog && (
        <Card className="mt-5 border-emerald-200 bg-emerald-50/40"><CardHeader title="Yetkazishni tasdiqlash" description="Obyektda qabul qilgan shaxsni yozing — nakladnoy yopiladi" icon={PackageCheck} /><DeliverForm tripId={id} /></Card>
      )}

      <Card className="mt-5">
        <CardHeader title="Yetkazish" icon={MapPin} action={<Link href={`/orders/${t.orderId}`} className="text-sm text-slate-500 hover:text-slate-900">Zayavkaga o'tish →</Link>} />
        <DL items={[
          { k: "Manzil", v: t.order.deliveryAddress },
          { k: "Sana", v: date(t.order.deliveryDate) },
          { k: "Mijoz telefoni", v: t.order.customer.phone },
          ...(t.receiverName ? [{ k: "Qabul qildi", v: t.receiverName }] : []),
          ...(t.note ? [{ k: "Izoh", v: t.note }] : []),
        ]} />
      </Card>
    </div>
  );
}
