import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer, PackageCheck, Navigation, XCircle, Truck, Package, Clock, MapPin, MapPinned, Smartphone, History } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { getSession } from "@/lib/auth";
import { qty, date, dateTime } from "@/lib/format";
import { Badge, Button, Callout, Card, CardHeader, DL, LinkButton, PageHeader, StatCard, StatusSteps } from "@/components/ui";
import { TripStatusBadge } from "../status";
import { markLoaded, markOnRoad, cancelTrip } from "../actions";
import { tripSteps } from "@/lib/trips";
import { unitLabel, soleUnit } from "@/lib/unit";
import { DeliverButton } from "./deliver-form";
import { PickupForm } from "./pickup-form";
import { EcoSyncButtons } from "./eco-sync";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { geoSearchEnabled } from "@/lib/geo";

const STEPS = [{ key: "PLANNED", label: "Rejalashtirildi" }, { key: "LOADED", label: "Yuklandi" }, { key: "ON_ROAD", label: "Yo'lda" }, { key: "DELIVERED", label: "Yetkazildi" }];
const dt = (d: Date | null) => d ? dateTime(d) : "—";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const t = await db.trip.findUnique({ where: { id }, include: { order: { include: { customer: true, items: { include: { product: true } } } }, vehicle: true, driver: true } });
  if (!t || !s) notFound();
  const marks = await customerMarks([t.order.customerId]);
  const steps = await tripSteps(id);
  // Yuk olgan joyi hali belgilanmagan bo'lsa zavod ko'rsatiladi — reyslarning ko'pchiligi zavoddan chiqadi
  const plant = await db.companySettings.findUnique({ where: { id: "main" }, select: { name: true, address: true, lat: true, lng: true } });
  const blacklisted = marks.black.has(t.order.customerId);
  const canLog = ["LOGISTICS", "DIRECTOR"].includes(s.role);
  const canLoad = canLog || s.role === "PRODUCTION";
  // Reys miqdori zayavkadagi mahsulot birligida ko'rsatiladi (beton m³, dona mahsulot dona)
  const tripUnit = soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })));

  return (
    <div>
      <PageHeader
        back={{ href: "/trips", label: "Reyslar" }}
        title={`Nakladnoy ${t.deliveryNoteNo}`}
        subtitle={<>Zayavka {t.order.orderNo} · <CustomerName name={t.order.customer.name} blacklisted={blacklisted} contracted={marks.contract.has(t.order.customerId)} href={`/customers/${t.order.customerId}`} /></>}
        action={
          <>
            <LinkButton href={`/trips/${id}/print`} variant="secondary"><Printer size={16} /> Chop etish</LinkButton>
            {t.status === "PLANNED" && canLoad && <form action={markLoaded.bind(null, id)}><Button><PackageCheck size={16} /> Yuklandi</Button></form>}
            {t.status === "LOADED" && canLog && <form action={markOnRoad.bind(null, id)}><Button><Navigation size={16} /> Yo'lga chiqdi</Button></form>}
            {["LOADED", "ON_ROAD"].includes(t.status) && canLog && <DeliverButton tripId={id} />}
            {t.status === "PLANNED" && canLog && <form action={cancelTrip.bind(null, id)}><Button variant="ghost" className="text-red-600 hover:bg-red-50"><XCircle size={16} /> Bekor</Button></form>}
          </>
        }
      />

      {blacklisted && t.status !== "CANCELLED" && t.status !== "DELIVERED" && (
        <Callout tone="danger" title="Mijoz qora ro'yxatda">Kredit limiti to'liq ishlatilgan. Jo'natishdan oldin sotuv bo'limi yoki direktor bilan kelishing. <Link href={`/customers/${t.order.customerId}`} className="underline">Mijoz kartasi</Link></Callout>
      )}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <StatusSteps steps={STEPS} current={t.status === "CANCELLED" ? "PLANNED" : t.status} failed={t.status === "CANCELLED"} />
          <TripStatusBadge status={t.status} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Hajm" value={tripUnit ? `${qty(t.qtyM3)} ${unitLabel(tripUnit)}` : qty(t.qtyM3)} hint={t.order.items[0]?.product.name} icon={Package} tone="brand" />
        <StatCard label="Mikser" value={<span className="tabular">{t.vehicle.plate}</span>} hint={t.driver.fullName} icon={Truck} />
        <StatCard label="Yuklandi" value={<span className="text-base">{dt(t.loadedAt)}</span>} icon={Clock} />
        <StatCard label="Yetkazildi" value={<span className="text-base">{dt(t.deliveredAt)}</span>} hint={t.receiverName ? `qabul qildi: ${t.receiverName}` : undefined} icon={Clock} tone={t.deliveredAt ? "success" : "default"} />
      </div>

      {t.status === "LOADED" && canLoad && (
        <Card className="mt-5">
          <CardHeader title="Yukni olgani joyi" description="Mikser yukni qayerdan olgani — haydovchi ilovasida marshrut shu nuqtadan boshlanadi" icon={MapPinned} />
          <PickupForm
            tripId={id}
            searchEnabled={geoSearchEnabled()}
            address={t.pickupAddress ?? plant?.address ?? plant?.name ?? ""}
            lat={t.pickupLat ?? plant?.lat ?? null}
            lng={t.pickupLng ?? plant?.lng ?? null}
          />
        </Card>
      )}

      {ecoEnabled() && t.status !== "CANCELLED" && (() => {
        const st = ecoLabel(t.ecoStatus);
        return (
          <Card className={`mt-5 ${t.ecoError ? "border-red-200" : ""}`}>
            <CardHeader title="Haydovchi ilovasi (Insof ECO)" icon={Smartphone}
              description={st ? st.hint : "Reys haydovchi telefoniga hali yuborilmagan"}
              action={canLoad ? <EcoSyncButtons tripId={id} hasEco={!!t.ecoDeliveryId} /> : undefined} />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {st ? <Badge color={st.color}>{st.label}</Badge> : <Badge>Yuborilmagan</Badge>}
              {t.ecoSyncedAt && <span className="text-slate-500">sinxron: {dateTime(t.ecoSyncedAt)}</span>}
              {!t.driver.phone && <span className="text-amber-700">Haydovchi telefoni yo'q — ilovada ko'rinmaydi</span>}
            </div>
            {t.ecoError && <p className="mt-2 text-sm text-red-600">{t.ecoError}</p>}
          </Card>
        );
      })()}

      <Card className="mt-5">
        <CardHeader title="Yetkazish" icon={MapPin} action={<Link href={`/orders/${t.orderId}`} className="text-sm text-slate-500 hover:text-slate-900">Zayavkaga o'tish →</Link>} />
        <DL items={[
          ...(t.pickupAddress ? [{ k: "Yukni olgani joyi", v: t.pickupAddress }] : []),
          { k: "Manzil", v: t.order.deliveryAddress },
          { k: "Sana", v: date(t.order.deliveryDate) },
          { k: "Mijoz telefoni", v: t.order.customer.phone },
          ...(t.receiverName ? [{ k: "Qabul qildi", v: t.receiverName }] : []),
          ...(t.note ? [{ k: "Izoh", v: t.note }] : []),
        ]} />
      </Card>

      {/* Yuqoridagi StatusSteps qayerda turganini ko'rsatadi; bu yerda esa har bosqichni
          KIM va QACHON belgilagani — haydovchi ilovadan bosgani ham shu ro'yxatga tushadi. */}
      <Card className="mt-5">
        <CardHeader title="Bosqichlar" description="Har bir holatni kim va qachon belgilagan" icon={History} />
        {steps.length === 0 ? (
          <p className="text-sm text-slate-500">Hali bosqich yozilmagan.</p>
        ) : (
          <ol className="space-y-3">
            {steps.map((x) => (
              <li key={x.id} className="flex items-baseline gap-3 text-sm">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${x.status === "DELIVERED" ? "bg-emerald-500" : x.status === "CANCELLED" ? "bg-red-500" : "bg-slate-300"}`} />
                <span className="w-32 shrink-0 font-medium text-slate-900">{x.label}</span>
                <span className="flex-1 text-slate-500">{x.by}</span>
                <span className="tabular text-slate-500">{dateTime(x.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
