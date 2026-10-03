import Link from "next/link";
import { CalendarDays, MapPin, Truck, Users } from "lucide-react";
import { requireRoles } from "@/lib/page-guard";
import { avgMin, cost, logisticsReport, onTimePct } from "@/lib/logistics-report";
import { isoDate, money, moneyShort, qty } from "@/lib/format";
import { minutesLabel, VEHICLE_TYPE } from "@/lib/logistics";
import { Card, CardHeader, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { PeriodTabs, periodRange, RangeForm } from "../ui";
import { ExcelButton } from "../excel-button";

export const dynamic = "force-dynamic";

/** Hisobotlar (TZ 14): kunlar, transport, haydovchi va obyekt kesimida — jadval + Excel. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  await requireRoles(["LOGISTICS", "ACCOUNTING"], { module: "logistika" });
  const sp = await searchParams;
  const r = periodRange(sp, "month");
  const rep = await logisticsReport(r.from, r.to);
  const t = rep.total;
  const pct = (x: number | null) => (x == null ? "—" : `${x}%`);
  const sheets = [
    { name: "Kunlar", rows: rep.byDay.map((d) => ({ Sana: d.day, Reyslar: d.trips, Yetkazildi: d.delivered, "Bekor": d.cancelled, "Beton m3": d.m3, "Dona": d.pieces, "Kechikdi": d.late, "O'rt. yetkazish, daq": avgMin(d), "Yoqilg'i": d.fuel, "Boshqa xarajat": d.other })) },
    { name: "Transport", rows: rep.byVehicle.map((v) => ({ Transport: v.plate, Turi: VEHICLE_TYPE[v.type], Reyslar: v.trips, "Beton m3": v.m3, "Band, soat": Math.round(v.busyMin / 60), "Foydalanish %": v.utilization, "GPS km": Math.round(v.km), Litr: Math.round(v.liters), "Yoqilg'i": v.fuel, "Boshqa": v.other, "1 m3 ga": v.m3 ? Math.round(cost(v) / v.m3) : null })) },
    { name: "Haydovchilar", rows: rep.byDriver.map((d) => ({ Haydovchi: d.name, Reyslar: d.trips, Yetkazildi: d.delivered, "Beton m3": d.m3, "Kechikdi": d.late, "O'z vaqtida %": onTimePct(d), "O'rt. daq": avgMin(d), Muammo: d.issues, "GPS km": Math.round(d.km) })) },
    { name: "Obyektlar", rows: rep.bySite.map((s) => ({ Obyekt: s.name, Mijoz: s.customer, Reyslar: s.trips, "Beton m3": s.m3, Dona: s.pieces, "O'rt. daq": avgMin(s), Kechikdi: s.late })) },
  ];
  return (
    <div>
      <PageHeader title="Logistika hisobotlari" subtitle={`${r.label} · ${isoDate(r.from)} — ${isoDate(new Date(r.to.getTime() - 86_400_000))}`}
        action={<ExcelButton file={`logistika-${isoDate(r.from)}`} sheets={sheets} />} />
      <PeriodTabs base="/logistika/hisobotlar" current={r.period} />
      <RangeForm base="/logistika/hisobotlar" from={r.from} to={r.to} />

      <Card className="mb-5">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4 xl:grid-cols-8">
          {[
            ["Reyslar", String(t.trips)], ["Yetkazildi", String(t.delivered)], ["Bekor", String(t.cancelled)], ["Beton", `${qty(t.m3)} m³`],
            ["Kechikdi", t.judged ? `${t.late} (${pct(onTimePct(t))} o'z vaqtida)` : String(t.late)], ["O'rt. yetkazish", minutesLabel(avgMin(t))], ["Yoqilg'i", moneyShort(t.fuel)], ["Transport xarajati", moneyShort(cost(t))],
          ].map(([k, v]) => <div key={k}><div className="text-xs text-slate-500">{k}</div><div className="font-semibold tabular">{v}</div></div>)}
        </div>
      </Card>

      <Card padded={false} className="mb-5">
        <div className="px-5 pt-5"><CardHeader title="Kunlar bo'yicha" icon={CalendarDays} /></div>
        <Table>
          <thead><tr><Th>Sana</Th><Th right>Reys</Th><Th right>Yetkazildi</Th><Th right>Bekor</Th><Th right>Beton, m³</Th><Th right>Kechikdi</Th><Th right>O'rt. vaqt</Th><Th right>Yoqilg'i</Th><Th right>Boshqa</Th></tr></thead>
          <tbody>
            {rep.byDay.length === 0 && <Empty text="Bu davrda reys yo'q" />}
            {rep.byDay.map((d) => (
              <Tr key={d.day}><Td className="tabular"><Link href={`/dashboard?view=logistics&date=${d.day}`} className="hover:underline">{d.day}</Link></Td><Td right className="tabular">{d.trips}</Td><Td right className="tabular">{d.delivered}</Td><Td right className="tabular">{d.cancelled || ""}</Td><Td right className="tabular">{qty(d.m3)}</Td><Td right className={d.late ? "font-medium text-amber-700" : ""}>{d.late || ""}</Td><Td right className="tabular">{minutesLabel(avgMin(d))}</Td><Td right className="tabular">{d.fuel ? moneyShort(d.fuel) : ""}</Td><Td right className="tabular">{d.other ? moneyShort(d.other) : ""}</Td></Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card padded={false} className="mb-5">
        <div className="px-5 pt-5"><CardHeader title="Transport bo'yicha" description={`Foydalanish — band vaqt / (${rep.workDays} ish kuni × smena)`} icon={Truck} /></div>
        <Table>
          <thead><tr><Th>Transport</Th><Th right>Reys</Th><Th right>Beton, m³</Th><Th right>Band</Th><Th right>Foydalanish</Th><Th right>GPS km</Th><Th right>Yoqilg'i</Th><Th right>Boshqa</Th><Th right>1 m³ ga</Th></tr></thead>
          <tbody>
            {rep.byVehicle.map((v) => (
              <Tr key={v.id}><Td><Link href={`/logistika/transport/${v.id}`} className="font-medium tabular hover:underline">{v.plate}</Link> <span className="text-xs text-slate-500">{VEHICLE_TYPE[v.type]}</span></Td><Td right className="tabular">{v.trips}</Td><Td right className="tabular">{qty(v.m3)}</Td><Td right className="tabular">{minutesLabel(Math.round(v.busyMin))}</Td><Td right className="tabular">{v.utilization}%</Td><Td right className="tabular">{v.km ? Math.round(v.km) : "—"}</Td><Td right className="tabular">{v.fuel ? moneyShort(v.fuel) : "—"}</Td><Td right className="tabular">{v.other ? moneyShort(v.other) : "—"}</Td><Td right className="tabular">{v.m3 && cost(v) ? money(cost(v) / v.m3) : "—"}</Td></Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Haydovchilar faoliyati" icon={Users} /></div>
          <Table>
            <thead><tr><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Beton, m³</Th><Th right>O'z vaqtida</Th><Th right>O'rt. vaqt</Th><Th right>Muammo</Th></tr></thead>
            <tbody>
              {rep.byDriver.length === 0 && <Empty text="Ma'lumot yo'q" />}
              {rep.byDriver.map((d) => <Tr key={d.id}><Td><Link href={`/logistika/haydovchilar/${d.id}`} className="font-medium hover:underline">{d.name}</Link></Td><Td right className="tabular">{d.trips}</Td><Td right className="tabular">{qty(d.m3)}</Td><Td right className="tabular">{pct(onTimePct(d))}</Td><Td right className="tabular">{minutesLabel(avgMin(d))}</Td><Td right className={d.issues ? "font-medium text-red-700" : ""}>{d.issues || ""}</Td></Tr>)}
            </tbody>
          </Table>
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Obyektlar bo'yicha" icon={MapPin} /></div>
          <Table>
            <thead><tr><Th>Obyekt</Th><Th right>Reys</Th><Th right>Hajm</Th><Th right>O'rt. vaqt</Th><Th right>Kechikdi</Th></tr></thead>
            <tbody>
              {rep.bySite.length === 0 && <Empty text="Ma'lumot yo'q" />}
              {rep.bySite.slice(0, 50).map((s) => <Tr key={s.id}><Td>{s.id.startsWith("addr:") ? <span className="text-sm">{s.name}</span> : <Link href={`/logistika/obyektlar/${s.id}`} className="text-sm font-medium hover:underline">{s.name}</Link>}<div className="text-xs text-slate-500">{s.customer}</div></Td><Td right className="tabular">{s.trips}</Td><Td right className="tabular">{qty(s.m3 + s.pieces)}</Td><Td right className="tabular">{minutesLabel(avgMin(s))}</Td><Td right className={s.late ? "font-medium text-amber-700" : ""}>{s.late || ""}</Td></Tr>)}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
