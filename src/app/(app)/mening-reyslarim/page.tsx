import Link from "next/link";
import { Bus, CheckCheck, MapPin, Package, Phone, Truck } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { qty as q, date, dateTime, deliveryAt } from "@/lib/format";
import { ecoLabel } from "@/lib/eco/labels";
import { Card, CardHeader, Empty, EmptyState, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { TripStatusBadge } from "../trips/status";
import { fmtUnitTotals, soleUnit, unitLabel } from "@/lib/unit";

/**
 * Haydovchining o'z sahifasi. ERP'da haydovchi boshqa bo'limlarni ko'rmaydi (middleware shu sahifaga yo'naltiradi):
 * bu yerda faqat o'ziga biriktirilgan reyslar — bugungi ish va tarix.
 * Asosiy ish joyi baribir ilova; veb — "qayerga borishim kerak edi" ni ko'rish uchun.
 */
export default async function MyTripsPage() {
  const s = await requireSession(["DRIVER"]);
  const me = await db.employee.findFirst({
    where: { userId: s.userId },
    include: { vehicle: true },
  });
  if (!me) {
    return (
      <div>
        <PageHeader title="Mening reyslarim" />
        <EmptyState icon={Bus} title="Login xodim kartasiga bog'lanmagan"
          text="Otdel kadrga ayting: Xodimlar bo'limida sizning kartangizga shu login biriktirilishi kerak." />
      </div>
    );
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [open, done, todayAgg] = await Promise.all([
    db.trip.findMany({
      where: { driverId: me.id, status: { in: ["PLANNED", "LOADED", "ON_ROAD"] } },
      orderBy: { createdAt: "asc" },
      include: { order: { include: { customer: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } }, vehicle: true },
    }),
    db.trip.findMany({
      where: { driverId: me.id, status: { in: ["DELIVERED", "CANCELLED"] } },
      orderBy: { createdAt: "desc" }, take: 50,
      include: { order: { include: { customer: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } }, vehicle: true },
    }),
    db.trip.findMany({
      where: { driverId: me.id, status: "DELIVERED", deliveredAt: { gte: today } },
      select: { qtyM3: true, order: { select: { items: { select: { qtyM3: true, product: { select: { unit: true } } } } } } },
    }),
  ]);
  // Reys miqdori zayavkadagi mahsulot birligida: beton m³, ustun/blok dona
  const tripUnit = (t: { order: { items: { qtyM3: unknown; product: { unit: string } }[] } }) =>
    soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: String(i.qtyM3) })));
  const tripQty = (t: { qtyM3: unknown; order: { items: { qtyM3: unknown; product: { unit: string } }[] } }) => {
    const u = tripUnit(t);
    return u ? `${q(String(t.qtyM3))} ${unitLabel(u)}` : q(String(t.qtyM3));
  };

  return (
    <div>
      <PageHeader title="Mening reyslarim"
        subtitle={`${me.fullName}${me.vehicle ? ` · ${me.vehicle.plate}` : " · mashina biriktirilmagan"}`} />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Ochiq reyslar" value={`${open.length} ta`} icon={Bus} tone={open.length ? "brand" : "success"} />
        <StatCard label="Bugun yetkazdim" value={fmtUnitTotals(todayAgg.map((t) => ({ unit: tripUnit(t) ?? "m3", qty: String(t.qtyM3) })))} hint={`${todayAgg.length} reys`} icon={CheckCheck} tone="success" />
        <StatCard label="Mashina" value={me.vehicle?.plate ?? "—"} hint={me.vehicle?.capacityM3 ? `${q(me.vehicle.capacityM3)} m³` : undefined} icon={Truck} />
        <StatCard label="Telefon" value={me.phone ?? "—"} hint="ilovaga kirish kaliti" icon={Phone} />
      </div>

      <Card className="mb-5" padded={false}>
        <div className="p-5"><CardHeader icon={Package} title="Bajarilishi kerak" description="Yuklash va yetkazish shu ro'yxat bo'yicha" /></div>
        <Table>
          <thead><tr><Th>Nakladnoy</Th><Th>Mijoz</Th><Th>Manzil</Th><Th>Yetkazish</Th><Th right>Miqdor</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {open.length === 0 && <Empty text="Ochiq reys yo'q — yangi reys berilsa shu yerda chiqadi" icon={Bus} />}
            {open.map((t) => (
              <Tr key={t.id}>
                <Td className="font-medium">{t.deliveryNoteNo}</Td>
                <Td>{t.order.customer.name}</Td>
                <Td className="text-slate-600"><span className="inline-flex items-start gap-1"><MapPin size={13} className="mt-0.5 shrink-0 text-slate-400" />{t.order.deliveryAddress}</span></Td>
                <Td>{deliveryAt(t.order.deliveryDate, t.order.deliveryTime)}</Td>
                <Td right className="whitespace-nowrap">{tripQty(t)}</Td>
                <Td>
                  <TripStatusBadge status={t.status} />
                  {t.ecoStatus && <div className="mt-0.5 text-xs text-slate-500">{ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus}</div>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <h2 className="mb-3 font-semibold">Tarix</h2>
      <Table>
        <thead><tr><Th>Nakladnoy</Th><Th>Mijoz</Th><Th>Sana</Th><Th>Yetkazildi</Th><Th right>Miqdor</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {done.length === 0 && <Empty text="Hali yakunlangan reys yo'q" />}
          {done.map((t) => (
            <Tr key={t.id}>
              <Td className="font-medium">{t.deliveryNoteNo}</Td>
              <Td>{t.order.customer.name}</Td>
              <Td>{date(t.createdAt)}</Td>
              <Td className="text-slate-600">{t.deliveredAt ? dateTime(t.deliveredAt) : "—"}{t.receiverName && <div className="text-xs text-slate-500">qabul qildi: {t.receiverName}</div>}</Td>
              <Td right className="whitespace-nowrap">{tripQty(t)}</Td>
              <Td><TripStatusBadge status={t.status} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-2 text-xs text-slate-500">
        Reys holatini yo&apos;lda <b>Insof ECO</b> ilovasida belgilaysiz — bu sahifa shu ma&apos;lumotni ko&apos;rsatadi.
        Savol bo&apos;lsa logistika bo&apos;limiga murojaat qiling. <Link href="/qollanma" className="underline">Qo&apos;llanma</Link>
      </p>
    </div>
  );
}
