import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Phone, Route, Truck, Users } from "lucide-react";
import { db } from "@/lib/db";
import { driverPositionNames } from "@/lib/positions";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { licenseDaysLeft } from "@/lib/kadr";
import { date, dateTime, qty } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { TripStatusBadge } from "./status";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";

/** Haydovchi ro'yxati uchun bitta qatorning yig'ma raqamlari. */
type Totals = { all: number; delivered: number; cancelled: number; m3: number; last: Date | null };

async function driverTotals(): Promise<Map<string, Totals>> {
  const [byStatus, lastTrip] = await Promise.all([
    db.trip.groupBy({ by: ["driverId", "status"], _count: { _all: true }, _sum: { qtyM3: true } }),
    db.trip.groupBy({ by: ["driverId"], _max: { createdAt: true } }),
  ]);
  const m = new Map<string, Totals>();
  const get = (id: string) => m.get(id) ?? m.set(id, { all: 0, delivered: 0, cancelled: 0, m3: 0, last: null }).get(id)!;
  for (const r of byStatus) {
    const t = get(r.driverId);
    t.all += r._count._all;
    if (r.status === "DELIVERED") { t.delivered += r._count._all; t.m3 += Number(r._sum.qtyM3 ?? 0); }
    if (r.status === "CANCELLED") t.cancelled += r._count._all;
  }
  for (const r of lastTrip) get(r.driverId).last = r._max.createdAt;
  return m;
}

/**
 * Tarix: barcha haydovchilar ro'yxati. Lavozimi haydovchi bo'lganlar va
 * lavozimi o'zgargan bo'lsa ham reysi bor xodimlar — tarix yo'qolmasin.
 */
export async function DriverList() {
  const positions = await driverPositionNames();
  const [drivers, totals] = await Promise.all([
    db.employee.findMany({
      where: { OR: [{ position: { in: positions } }, { trips: { some: {} } }] },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
      include: { vehicle: true },
    }),
    driverTotals(),
  ]);
  const zero: Totals = { all: 0, delivered: 0, cancelled: 0, m3: 0, last: null };

  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader title="Haydovchilar" description="Haydovchi ustiga bosing — uning barcha nakladnoylari ochiladi." icon={Users} />
      </div>
      <Table>
        <thead>
          <tr><Th>F.I.O.</Th><Th>Telefon</Th><Th>Texnikasi</Th><Th right>Jami reys</Th><Th right>Yetkazilgan</Th><Th right>Jami m³</Th><Th>Oxirgi reys</Th><Th>Holat</Th></tr>
        </thead>
        <tbody>
          {drivers.length === 0 && <Empty text="Haydovchi yo'q — Xodimlar sahifasida 'Haydovchi' lavozimi bilan qo'shing" />}
          {drivers.map((d) => {
            const t = totals.get(d.id) ?? zero;
            const expiry = d.licenseExpiry ? licenseDaysLeft(d.licenseExpiry) : null;
            return (
              <Tr key={d.id}>
                <Td>
                  <Link href={`/trips?status=tarix&driver=${d.id}`} className="font-medium hover:underline">{d.fullName}</Link>
                  <div className="text-xs text-slate-500">{d.position}</div>
                  {expiry !== null && expiry < 30 && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-red-600"><AlertTriangle size={12} /> Guvohnoma {expiry < 0 ? "muddati o'tgan" : `${expiry} kun qoldi`}</div>
                  )}
                </Td>
                <Td>{d.phone ?? "—"}</Td>
                <Td>{d.vehicle ? <span className="inline-flex items-center gap-1"><Truck size={13} className="text-slate-400" /> {d.vehicle.plate}{d.vehicle.capacityM3 ? ` · ${qty(d.vehicle.capacityM3)} m³` : ""}</span> : <span className="text-slate-400">—</span>}</Td>
                <Td right>{t.all}</Td>
                <Td right>{t.delivered}{t.cancelled > 0 && <span className="ml-1 text-xs text-red-600">({t.cancelled} bekor)</span>}</Td>
                <Td right>{t.m3 ? qty(t.m3) : "—"}</Td>
                <Td>{t.last ? dateTime(t.last) : <span className="text-slate-400">—</span>}</Td>
                <Td>{d.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

/** Bitta haydovchining butun tarixi — eng yangi reys tepada. */
export async function DriverTrips({ driverId }: { driverId: string }) {
  const eco = ecoEnabled();
  const driver = await db.employee.findUnique({ where: { id: driverId }, include: { vehicle: true } });
  if (!driver) notFound();
  const trips = await db.trip.findMany({
    where: { driverId },
    orderBy: { createdAt: "desc" },
    include: { order: { include: { customer: true } }, vehicle: true },
  });
  const marks = await customerMarks(trips.map((t) => t.order.customerId));
  const delivered = trips.filter((t) => t.status === "DELIVERED");
  const m3 = delivered.reduce((s, t) => s + Number(t.qtyM3), 0);
  const expiry = driver.licenseExpiry ? licenseDaysLeft(driver.licenseExpiry) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Haydovchi" value={<span className="text-base">{driver.fullName}</span>} hint={driver.phone ?? driver.position} icon={Phone} />
        <StatCard label="Texnikasi" value={<span className="text-base">{driver.vehicle?.plate ?? "—"}</span>} hint={driver.vehicle?.capacityM3 ? `${qty(driver.vehicle.capacityM3)} m³` : "biriktirilmagan"} icon={Truck} />
        <StatCard label="Jami reys" value={trips.length} hint={`${delivered.length} yetkazilgan · ${trips.filter((t) => t.status === "CANCELLED").length} bekor`} icon={Route} />
        <StatCard
          label="Guvohnoma"
          value={<span className="text-base">{driver.licenseNo ?? "—"}</span>}
          hint={driver.licenseExpiry ? `${driver.licenseCategory ? driver.licenseCategory + " · " : ""}${date(driver.licenseExpiry)} gacha` : driver.licenseCategory ?? "kiritilmagan"}
          icon={AlertTriangle}
          tone={expiry !== null && expiry < 30 ? "danger" : "default"}
        />
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Nakladnoylar" description={`Yetkazilgan jami ${qty(m3)} m³. Eng yangisi tepada.`} icon={Route} />
        </div>
        <Table>
          <thead>
            <tr><Th>Nakladnoy</Th><Th>Sana</Th><Th>Zayavka</Th><Th>Mijoz</Th><Th>Mikser</Th><Th right>m³</Th><Th>Holat</Th><Th>Yetkazilgan</Th>{eco && <Th>ECO</Th>}</tr>
          </thead>
          <tbody>
            {trips.length === 0 && <Empty text="Bu haydovchida hali reys yo'q" />}
            {trips.map((t) => (
              <Tr key={t.id}>
                <Td><Link href={`/trips/${t.id}`} className="font-medium hover:underline">{t.deliveryNoteNo}</Link></Td>
                <Td>{dateTime(t.createdAt)}</Td>
                <Td><Link href={`/orders/${t.orderId}`} className="hover:underline">{t.order.orderNo}</Link></Td>
                <Td><CustomerName name={t.order.customer.name} blacklisted={marks.black.has(t.order.customerId)} contracted={marks.contract.has(t.order.customerId)} /></Td>
                <Td>{t.vehicle.plate}</Td>
                <Td right>{qty(t.qtyM3)}</Td>
                <Td><TripStatusBadge status={t.status} /></Td>
                <Td>{t.deliveredAt ? <>{dateTime(t.deliveredAt)}{t.receiverName && <div className="text-xs text-slate-500">{t.receiverName}</div>}</> : <span className="text-slate-400">—</span>}</Td>
                {eco && <Td>{(() => { const st = ecoLabel(t.ecoStatus); return st ? <Badge color={st.color}>{st.label}</Badge> : <span className="text-xs text-slate-400">—</span>; })()}</Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
