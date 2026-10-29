import Link from "next/link";
import { Plus, Truck, Wrench, Gauge, ShieldAlert, CircleOff } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { pathAllowed } from "@/lib/nav";
import { ACTIVE_TRIP, capText, expiryLevel, FUEL_TYPE, VEHICLE_TYPE, vehicleLive, VEHICLE_LIVE, vehicleServiceDue, type VehicleLive } from "@/lib/logistics";
import { date, moneyShort } from "@/lib/format";
import { fleetPeriod, fmtLoad } from "@/lib/vehicle-report";
import { DayRangeBar, parseDayRange } from "@/app/(app)/bi-tahlil/month-bar";
import { Badge, Card, Empty, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { VehicleStatusForm } from "../../drivers/vehicle-status-form";
import { TripLink, VehicleLiveBadge } from "../ui";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

const docBadge = (d: Date | null) => {
  const l = expiryLevel(d);
  if (!d || !l) return <span className="text-slate-400">—</span>;
  return <span className={l === "crit" ? "font-medium text-red-700" : l === "warn" ? "font-medium text-amber-700" : "text-slate-600"}>{date(d)}</span>;
};

/**
 * Transport moduli (TZ 6): hamma texnika, joriy holati, hujjat muddatlari va tanlangan davrdagi faoliyati —
 * reys, zayavka, yuk, xarajat, daromad, foyda (`lib/vehicle-report.ts`). Raqam bosilsa — transport kartasi shu davr bilan.
 */
export default async function TransportPage({ searchParams }: { searchParams: Promise<{ type?: string; state?: string; davr?: string; dan?: string; gacha?: string }> }) {
  const s = await requireRoles(["LOGISTICS", "MECHANIC", "DISPATCHER"], { module: "logistika" });
  const sp = await searchParams;
  const { type, state } = sp;
  const period = parseDayRange(sp);
  const periodQs = new URLSearchParams(Object.entries({ davr: sp.davr, dan: sp.dan, gacha: sp.gacha }).filter((kv): kv is [string, string] => !!kv[1])).toString();
  const withQs = (path: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(periodQs);
    for (const [k, val] of Object.entries(extra)) q.set(k, val);
    const str = q.toString();
    return str ? `${path}?${str}` : path;
  };
  const [vehicles, stats] = await Promise.all([db.vehicle.findMany({
    where: type && type in VEHICLE_TYPE ? { type: type as "MIXER" } : {},
    orderBy: [{ isActive: "desc" }, { type: "asc" }, { plate: "asc" }],
    include: {
      drivers: { where: { isActive: true }, select: { id: true, fullName: true } },
      trips: {
        where: { OR: [{ status: { in: ACTIVE_TRIP } }, { deliveredAt: { gte: new Date(Date.now() - 3 * 3600_000) } }] },
        select: { id: true, deliveryNoteNo: true, status: true, deliveredAt: true, returnedAt: true, qtyM3: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  }), fleetPeriod(period.from, period.to)]);
  const rows = vehicles.map((v) => ({ v, live: vehicleLive(v, v.trips) }));
  const count = (l: VehicleLive[]) => rows.filter((r) => l.includes(r.live)).length;
  const docsWarn = (r: (typeof rows)[number]) => r.v.isActive && [expiryLevel(r.v.inspectionUntil), expiryLevel(r.v.insuranceUntil)].some((l) => l === "crit" || l === "warn");
  const docsBad = rows.filter(docsWarn).length;
  const canManage = canDo(s, "logistika", "vehicle");
  // Holatni (ta'mir / bekor) mexanik va dispetcher ham belgilaydi
  const canStatus = canManage || canDo(s, "logistika", "service");
  const tripsClosed = !pathAllowed("/trips", s.role, s.perms);
  const due = await vehicleServiceDue();
  const dueBy = new Map<string, typeof due>();
  for (const d of due) dueBy.set(d.vehicleId, [...(dueBy.get(d.vehicleId) ?? []), d]);
  // ?state= — joriy holat (FREE, ON_TRIP…) yoki kartochkadan: DOCS (hujjat muddati), SERVICE (texnik xizmat)
  const shown = state === "DOCS" ? rows.filter(docsWarn) : state === "SERVICE" ? rows.filter((r) => dueBy.has(r.v.id)) : state ? rows.filter((r) => r.live === state) : rows;

  return (
    <div>
      <SectionTabs section="transport" current="/logistika/transport" />
      <PageHeader title="Transport" subtitle="Mikser, nasos va yuk mashinalar — joriy holat, hujjat muddatlari, tanlangan davrdagi reys, yuk, xarajat va foyda"
        action={canManage && <LinkButton href="/logistika/transport/new"><Plus size={16} /> Transport qo'shish</LinkButton>} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6 [&>*]:min-w-0">
        <StatCard label="Bo'sh" value={count(["FREE"])} hint="reysga tayyor" icon={Gauge} tone="success" href="/logistika/transport?state=FREE" />
        <StatCard label="Reysda / yuklanmoqda" value={count(["ON_TRIP", "LOADING", "ASSIGNED", "RETURNING"])} icon={Truck} tone="brand" href="/logistika/transport?state=ON_TRIP" />
        <StatCard label="Ta'mirda" value={count(["REPAIR"])} icon={Wrench} tone={count(["REPAIR"]) ? "danger" : "default"} href="/logistika/transport?state=REPAIR" />
        <StatCard label="Faol emas / bekor" value={count(["INACTIVE", "IDLE"])} icon={CircleOff} href="/logistika/transport?state=IDLE" />
        <StatCard label="Hujjat muddati" value={docsBad} hint="ko'rik yoki sug'urta ≤ 30 kun" icon={ShieldAlert} tone={docsBad ? "warning" : "default"} href="/logistika/transport?state=DOCS" />
        <StatCard label="Texnik xizmat" value={dueBy.size} hint={due.some((d) => d.level === "crit") ? `${due.filter((d) => d.level === "crit").length} ta muddati o'tgan` : "muddati yaqin / o'tgan"} icon={Wrench} tone={due.some((d) => d.level === "crit") ? "danger" : due.length ? "warning" : "default"} href="/logistika/transport?state=SERVICE" />
      </div>

      <Tabs current={type ?? ""} items={[
        { key: "", label: "Hammasi", href: withQs("/logistika/transport"), count: rows.length },
        { key: "MIXER", label: "Mikserlar", href: withQs("/logistika/transport", { type: "MIXER" }) },
        { key: "PUMP", label: "Nasoslar", href: withQs("/logistika/transport", { type: "PUMP" }) },
        { key: "TRUCK", label: "Yuk mashinalar", href: withQs("/logistika/transport", { type: "TRUCK" }) },
      ]} />
      <DayRangeBar base="/logistika/transport" range={period} keep={{ type, state }} />

      <Card padded={false}>
        <Table>
          <thead><tr><Th>Transport</Th><Th>Joriy holat</Th><Th>Haydovchi</Th><Th right>Sig'im</Th><Th>GPS</Th><Th>Tex. ko'rik</Th><Th>Sug'urta</Th><Th right>Reys / zayavka</Th><Th>Tashilgan yuk</Th><Th right>Xarajat</Th><Th right>Daromad</Th><Th right>Foyda</Th><Th>Texnik holat</Th></tr></thead>
          <tbody>
            {shown.length === 0 && <Empty text="Transport yo'q" icon={Truck} />}
            {shown.map(({ v, live }) => {
              const current = v.trips.find((t) => ACTIVE_TRIP.includes(t.status));
              const p = stats.get(v.id);
              return (
                <Tr key={v.id} className={v.isActive ? "" : "opacity-60"}>
                  <Td>
                    <Link href={withQs(`/logistika/transport/${v.id}`)} className="font-medium tabular hover:underline">{v.plate}</Link>
                    <div className="text-xs text-slate-500">{VEHICLE_TYPE[v.type]}{v.brand ? ` · ${v.brand}${v.model ? ` ${v.model}` : ""}` : ""}{v.fuelType ? ` · ${FUEL_TYPE[v.fuelType]}` : ""}</div>
                  </Td>
                  <Td><VehicleLiveBadge live={live} note={v.statusNote} />{current && <div className="text-xs"><TripLink id={current.id} noteNo={current.deliveryNoteNo} plain={tripsClosed} /></div>}
                    {(dueBy.get(v.id) ?? []).map((d) => <div key={d.serviceId} className={`text-xs ${d.level === "crit" ? "font-medium text-red-700" : "text-amber-700"}`}>{d.text}</div>)}</Td>
                  <Td className="text-sm">{v.drivers.map((d) => <Link key={d.id} href={`/logistika/haydovchilar/${d.id}`} className="block hover:underline">{d.fullName}</Link>)}{v.drivers.length === 0 && <span className="text-xs text-amber-700">biriktirilmagan</span>}</Td>
                  <Td right className="tabular">{capText(v) || "—"}</Td>
                  <Td>{v.hasGps ? <Badge color="green">treker</Badge> : <span className="text-xs text-slate-500">telefon</span>}</Td>
                  <Td className="text-sm">{docBadge(v.inspectionUntil)}</Td>
                  <Td className="text-sm">{docBadge(v.insuranceUntil)}</Td>
                  <Td right className="tabular">{p?.trips ? <>{p.trips}<div className="text-xs text-slate-500">{p.orders} zayavka · {p.days} kun</div></> : "—"}</Td>
                  <Td className="whitespace-nowrap text-sm tabular">{p?.trips ? fmtLoad(p.load) : "—"}</Td>
                  <Td right className="tabular">{p?.total ? moneyShort(p.total) : "—"}</Td>
                  <Td right className="tabular">{p?.revenue ? moneyShort(p.revenue) : "—"}</Td>
                  <Td right className={`tabular font-medium ${p && p.profit < 0 ? "text-red-600" : p?.profit ? "text-emerald-700" : ""}`}>{p && (p.total || p.revenue) ? moneyShort(p.profit) : "—"}</Td>
                  <Td>{canStatus && v.isActive ? <VehicleStatusForm vehicleId={v.id} status={v.status} note={v.statusNote} /> : <Badge>{VEHICLE_LIVE[live].label}</Badge>}</Td>
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
