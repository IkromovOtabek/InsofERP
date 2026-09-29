import Link from "next/link";
import { Fuel, Coins, Droplets, Gauge } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { lastFuelPrice } from "@/lib/logistics-costs";
import { FUEL_TYPE } from "@/lib/logistics";
import { date, fmtNum, money, moneyShort } from "@/lib/format";
import { Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { DeleteButton } from "@/components/delete-button";
import { FuelForm } from "../cost-forms";
import { costOptions } from "../cost-data";
import { deleteFuel } from "../actions";
import { PeriodTabs, periodRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

/** Yoqilg'i (TZ 12): zapravkalar, transport va haydovchi kesimida litr/summa, haqiqiy sarf. */
export default async function FuelPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; vehicleId?: string }> }) {
  await requireSession(["LOGISTICS", "ACCOUNTING"]);
  const sp = await searchParams;
  const r = periodRange(sp, "month");
  const [logs, opts, price] = await Promise.all([
    db.fuelLog.findMany({
      where: { date: { gte: r.from, lt: r.to }, ...(sp.vehicleId ? { vehicleId: sp.vehicleId } : {}) },
      include: { vehicle: { select: { plate: true, fuelNormL100: true } }, driver: { select: { fullName: true } }, trip: { select: { id: true, deliveryNoteNo: true } } },
      orderBy: { date: "desc" },
    }),
    costOptions(),
    lastFuelPrice(),
  ]);
  const liters = logs.reduce((a, f) => a + Number(f.liters), 0);
  const sum = logs.reduce((a, f) => a + Number(f.amount), 0);
  // Transport kesimida: litr, summa va probeg oralig'idan sarf
  const byV = new Map<string, { plate: string; liters: number; sum: number; odo: number[]; norm: number | null; count: number }>();
  for (const f of logs) {
    const x = byV.get(f.vehicleId) ?? { plate: f.vehicle.plate, liters: 0, sum: 0, odo: [], norm: f.vehicle.fuelNormL100 ? Number(f.vehicle.fuelNormL100) : null, count: 0 };
    x.liters += Number(f.liters); x.sum += Number(f.amount); x.count++;
    if (f.odometerKm != null) x.odo.push(f.odometerKm);
    byV.set(f.vehicleId, x);
  }
  return (
    <div>
      <PageHeader title="Yoqilg'i" subtitle={`${r.label} · haydovchi ilovadan ham kiritadi (reys kartasi → "Yoqilg'i")`} />
      <PeriodTabs base="/logistika/yoqilgi" current={r.period} />
      <RangeForm base="/logistika/yoqilgi" from={r.from} to={r.to} />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Quyildi" value={`${fmtNum(liters, 0)} l`} hint={`${logs.length} zapravka`} icon={Droplets} tone="brand" />
        <StatCard label="Summa" value={moneyShort(sum)} icon={Coins} />
        <StatCard label="O'rtacha narx" value={liters ? `${fmtNum(sum / liters, 0)} so'm/l` : "—"} icon={Fuel} />
        <StatCard label="Transport soni" value={byV.size} icon={Gauge} />
      </div>
      <Card className="mb-5"><CardHeader title="Zapravka qo'shish" icon={Fuel} /><FuelForm {...opts} lastPrice={price} vehicleId={sp.vehicleId} /></Card>
      <div className="grid gap-5 xl:grid-cols-5">
        <Card padded={false} className="xl:col-span-2">
          <div className="px-5 pt-5"><CardHeader title="Transport kesimida" icon={Gauge} /></div>
          <Table>
            <thead><tr><Th>Transport</Th><Th right>Litr</Th><Th right>Summa</Th><Th right>l/100 km</Th></tr></thead>
            <tbody>
              {byV.size === 0 && <Empty text="Ma'lumot yo'q" />}
              {[...byV.entries()].sort((a, b) => b[1].sum - a[1].sum).map(([id, x]) => {
                const km = x.odo.length >= 2 ? Math.max(...x.odo) - Math.min(...x.odo) : 0;
                const per = km > 0 ? (x.liters / km) * 100 : null;
                return (
                  <Tr key={id}>
                    <Td><Link href={`/logistika/transport/${id}`} className="font-medium tabular hover:underline">{x.plate}</Link></Td>
                    <Td right className="tabular">{fmtNum(x.liters, 0)}</Td>
                    <Td right className="tabular">{moneyShort(x.sum)}</Td>
                    <Td right className={`tabular ${per != null && x.norm && per > x.norm * 1.1 ? "font-medium text-red-700" : ""}`}>{per != null ? fmtNum(per, 1) : "—"}{x.norm ? <span className="text-xs text-slate-400"> / {fmtNum(x.norm, 1)}</span> : null}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <p className="px-5 pb-4 pt-2 text-xs text-slate-500">Sarf — davrdagi birinchi va oxirgi probeg oralig'i bo'yicha (taxminiy). Aniq sarf transport kartasida.</p>
        </Card>
        <Card padded={false} className="xl:col-span-3">
          <div className="px-5 pt-5"><CardHeader title="Zapravkalar" icon={Fuel} /></div>
          <Table>
            <thead><tr><Th>Sana</Th><Th>Transport / haydovchi</Th><Th right>Litr</Th><Th right>Narx</Th><Th right>Summa</Th><Th right>Probeg</Th><Th /></tr></thead>
            <tbody>
              {logs.length === 0 && <Empty text="Zapravka yo'q" />}
              {logs.map((f) => (
                <Tr key={f.id}>
                  <Td className="text-sm tabular">{date(f.date)}<div className="text-xs text-slate-500">{FUEL_TYPE[f.fuelType]}{f.station ? ` · ${f.station}` : ""}</div></Td>
                  <Td className="text-sm"><span className="tabular">{f.vehicle.plate}</span><div className="text-xs text-slate-500">{f.driver?.fullName ?? ""}{f.trip ? <> · <Link href={`/trips/${f.trip.id}`} className="hover:underline">{f.trip.deliveryNoteNo}</Link></> : null}</div></Td>
                  <Td right className="tabular">{fmtNum(Number(f.liters), 1)}</Td>
                  <Td right className="tabular">{fmtNum(Number(f.pricePerL), 0)}</Td>
                  <Td right className="tabular">{money(Number(f.amount))}</Td>
                  <Td right className="tabular">{f.odometerKm != null ? fmtNum(f.odometerKm) : "—"}</Td>
                  <Td><DeleteButton action={deleteFuel} id={f.id} name={`zapravka ${date(f.date)}`} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
