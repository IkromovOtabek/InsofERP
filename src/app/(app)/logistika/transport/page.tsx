import Link from "next/link";
import { Plus, Truck, Wrench, Gauge, ShieldAlert, CircleOff } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ACTIVE_TRIP, expiryLevel, FUEL_TYPE, VEHICLE_TYPE, vehicleLive, VEHICLE_LIVE, type VehicleLive } from "@/lib/logistics";
import { date, moneyShort, qty } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { VehicleStatusForm } from "../../drivers/vehicle-status-form";
import { TripLink, VehicleLiveBadge } from "../ui";

export const dynamic = "force-dynamic";

const docBadge = (d: Date | null) => {
  const l = expiryLevel(d);
  if (!d || !l) return <span className="text-slate-400">—</span>;
  return <span className={l === "crit" ? "font-medium text-red-700" : l === "warn" ? "font-medium text-amber-700" : "text-slate-600"}>{date(d)}</span>;
};

/** Transport moduli (TZ 6): hamma texnika, joriy holati, hujjat muddatlari, oy xarajati. */
export default async function TransportPage({ searchParams }: { searchParams: Promise<{ type?: string; state?: string }> }) {
  const s = await requireSession(["LOGISTICS"]);
  const { type, state } = await searchParams;
  const monthFrom = new Date(); monthFrom.setDate(1); monthFrom.setHours(0, 0, 0, 0);
  const vehicles = await db.vehicle.findMany({
    where: type && type in VEHICLE_TYPE ? { type: type as "MIXER" } : {},
    orderBy: [{ isActive: "desc" }, { type: "asc" }, { plate: "asc" }],
    include: {
      drivers: { where: { isActive: true }, select: { id: true, fullName: true } },
      trips: {
        where: { OR: [{ status: { in: ACTIVE_TRIP } }, { deliveredAt: { gte: new Date(Date.now() - 3 * 3600_000) } }, { createdAt: { gte: monthFrom } }] },
        select: { id: true, deliveryNoteNo: true, status: true, deliveredAt: true, returnedAt: true, qtyM3: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      fuelLogs: { where: { date: { gte: monthFrom } }, select: { amount: true, liters: true } },
      expenses: { where: { date: { gte: monthFrom } }, select: { amount: true } },
    },
  });
  const rows = vehicles.map((v) => ({ v, live: vehicleLive(v, v.trips) }));
  const count = (l: VehicleLive[]) => rows.filter((r) => l.includes(r.live)).length;
  const shown = state ? rows.filter((r) => r.live === state) : rows;
  const docsBad = rows.filter((r) => r.v.isActive && [expiryLevel(r.v.inspectionUntil), expiryLevel(r.v.insuranceUntil)].some((l) => l === "crit" || l === "warn")).length;
  const canManage = ["LOGISTICS", "DIRECTOR"].includes(s.role);

  return (
    <div>
      <PageHeader title="Transport" subtitle="Mikser, nasos va yuk mashinalar — joriy holat, hujjat muddatlari, oy xarajati"
        action={canManage && <LinkButton href="/logistika/transport/new"><Plus size={16} /> Transport qo'shish</LinkButton>} />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Bo'sh" value={count(["FREE"])} hint="reysga tayyor" icon={Gauge} tone="success" href="/logistika/transport?state=FREE" />
        <StatCard label="Reysda / yuklanmoqda" value={count(["ON_TRIP", "LOADING", "ASSIGNED", "RETURNING"])} icon={Truck} tone="brand" href="/logistika/transport?state=ON_TRIP" />
        <StatCard label="Ta'mirda" value={count(["REPAIR"])} icon={Wrench} tone={count(["REPAIR"]) ? "danger" : "default"} href="/logistika/transport?state=REPAIR" />
        <StatCard label="Faol emas / bekor" value={count(["INACTIVE", "IDLE"])} icon={CircleOff} href="/logistika/transport?state=IDLE" />
        <StatCard label="Hujjat muddati" value={docsBad} hint="ko'rik yoki sug'urta ≤ 30 kun" icon={ShieldAlert} tone={docsBad ? "warning" : "default"} />
      </div>

      <Tabs current={type ?? ""} items={[
        { key: "", label: "Hammasi", href: "/logistika/transport", count: rows.length },
        { key: "MIXER", label: "Mikserlar", href: "/logistika/transport?type=MIXER" },
        { key: "PUMP", label: "Nasoslar", href: "/logistika/transport?type=PUMP" },
        { key: "TRUCK", label: "Yuk mashinalar", href: "/logistika/transport?type=TRUCK" },
      ]} />

      <Card padded={false}>
        <Table>
          <thead><tr><Th>Transport</Th><Th>Joriy holat</Th><Th>Haydovchi</Th><Th right>Sig'im</Th><Th>GPS</Th><Th>Tex. ko'rik</Th><Th>Sug'urta</Th><Th right>Oy: reys</Th><Th right>Oy: xarajat</Th><Th>Texnik holat</Th></tr></thead>
          <tbody>
            {shown.length === 0 && <Empty text="Transport yo'q" icon={Truck} />}
            {shown.map(({ v, live }) => {
              const current = v.trips.find((t) => ACTIVE_TRIP.includes(t.status));
              const month = v.trips.filter((t) => t.createdAt >= monthFrom && t.status !== "CANCELLED");
              const cost = v.fuelLogs.reduce((a, f) => a + Number(f.amount), 0) + v.expenses.reduce((a, e) => a + Number(e.amount), 0);
              return (
                <Tr key={v.id} className={v.isActive ? "" : "opacity-60"}>
                  <Td>
                    <Link href={`/logistika/transport/${v.id}`} className="font-medium tabular hover:underline">{v.plate}</Link>
                    <div className="text-xs text-slate-500">{VEHICLE_TYPE[v.type]}{v.brand ? ` · ${v.brand}${v.model ? ` ${v.model}` : ""}` : ""}{v.fuelType ? ` · ${FUEL_TYPE[v.fuelType]}` : ""}</div>
                  </Td>
                  <Td><VehicleLiveBadge live={live} note={v.statusNote} />{current && <div className="text-xs"><TripLink id={current.id} noteNo={current.deliveryNoteNo} /></div>}</Td>
                  <Td className="text-sm">{v.drivers.map((d) => <Link key={d.id} href={`/logistika/haydovchilar/${d.id}`} className="block hover:underline">{d.fullName}</Link>)}{v.drivers.length === 0 && <span className="text-xs text-amber-700">biriktirilmagan</span>}</Td>
                  <Td right className="tabular">{v.capacityM3 ? `${qty(v.capacityM3)} m³` : "—"}</Td>
                  <Td>{v.hasGps ? <Badge color="green">treker</Badge> : <span className="text-xs text-slate-500">telefon</span>}</Td>
                  <Td className="text-sm">{docBadge(v.inspectionUntil)}</Td>
                  <Td className="text-sm">{docBadge(v.insuranceUntil)}</Td>
                  <Td right className="tabular">{month.length}</Td>
                  <Td right className="tabular">{cost ? moneyShort(cost) : "—"}</Td>
                  <Td>{canManage && v.isActive ? <VehicleStatusForm vehicleId={v.id} status={v.status} note={v.statusNote} /> : <Badge>{VEHICLE_LIVE[live].label}</Badge>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Joriy holat reyslardan avtomatik chiqadi. "Ta'mirda" va "Bekor turibdi" — texnik holat ustunidan qo'lda belgilanadi (sababi bilan); ta'mirdagi transport reysga berilmaydi.</p>
    </div>
  );
}
