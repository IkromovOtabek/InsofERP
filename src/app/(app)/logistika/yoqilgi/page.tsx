import Link from "next/link";
import { Fuel, Coins, Droplets, Gauge, Undo2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { fuelConsumption, lastFuelPrice } from "@/lib/logistics-costs";
import { FUEL_TYPE } from "@/lib/logistics";
import { date, fmtNum, money, moneyShort } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ConfirmButton } from "../../payments/confirm-button";
import { cancelNote, cancellerNames } from "@/lib/cancelled";
import { FuelForm } from "../cost-forms";
import { costOptions } from "../cost-data";
import { cancelFuel } from "../actions";
import { PeriodTabs, periodRange, RangeForm } from "../ui";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

/** Yoqilg'i (TZ 12): zapravkalar, transport va haydovchi kesimida litr/summa, haqiqiy sarf. */
export default async function FuelPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; vehicleId?: string }> }) {
  await requireRoles(["LOGISTICS", "ACCOUNTING"], { module: "logistika" });
  const sp = await searchParams;
  const r = periodRange(sp, "month");
  const [logs, opts, price] = await Promise.all([
    db.fuelLog.findMany({
      where: { date: { gte: r.from, lt: r.to }, ...(sp.vehicleId ? { vehicleId: sp.vehicleId } : {}) },
      include: { vehicle: { select: { plate: true, fuelType: true, fuelNormL100: true, gasNormPer100: true } }, driver: { select: { fullName: true } }, trip: { select: { id: true, deliveryNoteNo: true } } },
      orderBy: { date: "desc" },
    }),
    costOptions(),
    lastFuelPrice(),
  ]);
  // Bekor qilingan zapravka ro'yxatda belgisi bilan qoladi, lekin jami va sarf hisobiga kirmaydi
  const active = logs.filter((f) => !f.cancelledAt);
  const names = await cancellerNames(logs);
  const liters = active.reduce((a, f) => a + Number(f.liters), 0);
  const sum = active.reduce((a, f) => a + Number(f.amount), 0);
  // Transport kesimida: litr, summa va probeg oralig'idan sarf
  // «Dizel + metan» transport ikki qator: dizel (l, dizel normasi) va metan (m³, metan normasi) — aralashsa sarf noto'g'ri chiqadi
  const byV = new Map<string, { vehicleId: string; plate: string; liters: number; sum: number; logs: { liters: unknown; odometerKm: number | null }[]; norm: number | null; count: number }>();
  for (const f of active) {
    const dual = f.vehicle.fuelType === "DIESEL_METHANE";
    const gas = dual && f.fuelType === "METHANE";
    const key = dual ? `${f.vehicleId}:${f.fuelType}` : f.vehicleId;
    const norm = gas ? f.vehicle.gasNormPer100 : f.vehicle.fuelNormL100;
    const x = byV.get(key) ?? { vehicleId: f.vehicleId, plate: dual ? `${f.vehicle.plate} · ${FUEL_TYPE[f.fuelType].toLowerCase()}` : f.vehicle.plate, liters: 0, sum: 0, logs: [], norm: norm ? Number(norm) : null, count: 0 };
    x.liters += Number(f.liters); x.sum += Number(f.amount); x.count++;
    x.logs.push({ liters: f.liters, odometerKm: f.odometerKm });
    byV.set(key, x);
  }
  return (
    <div>
      <SectionTabs section="transport" current="/logistika/yoqilgi" />
      <PageHeader title="Yoqilg'i" subtitle={`${r.label} · haydovchi ilovadan ham kiritadi (reys kartasi → "Yoqilg'i")`} />
      <PeriodTabs base="/logistika/yoqilgi" current={r.period} />
      <RangeForm base="/logistika/yoqilgi" from={r.from} to={r.to} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Quyildi" value={`${fmtNum(liters, 0)} l`} hint={`${active.length} zapravka`} icon={Droplets} tone="brand" href="#zapravkalar" />
        <StatCard label="Summa" value={moneyShort(sum)} icon={Coins} href="#zapravkalar" />
        <StatCard label="O'rtacha narx" value={liters ? `${fmtNum(sum / liters, 0)} so'm/l` : "—"} icon={Fuel} href="#zapravkalar" />
        <StatCard label="Transport soni" value={byV.size} icon={Gauge} href="#transport-kesimida" />
      </div>
      <Card className="mb-5 min-w-0"><CardHeader title="Zapravka qo'shish" icon={Fuel} /><FuelForm {...opts} lastPrice={price} vehicleId={sp.vehicleId} /></Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
        <Card padded={false} className="xl:col-span-2">
          <div id="transport-kesimida" className="scroll-mt-20 px-5 pt-5"><CardHeader title="Transport kesimida" icon={Gauge} /></div>
          <Table>
            <thead><tr><Th>Transport</Th><Th right>Litr</Th><Th right>Summa</Th><Th right>l/100 km</Th></tr></thead>
            <tbody>
              {byV.size === 0 && <Empty text="Ma'lumot yo'q" />}
              {[...byV.entries()].sort((a, b) => b[1].sum - a[1].sum).map(([id, x]) => {
                const per = fuelConsumption(x.logs).per100;
                return (
                  <Tr key={id}>
                    <Td><Link href={`/logistika/transport/${x.vehicleId}`} className="font-medium tabular hover:underline">{x.plate}</Link></Td>
                    <Td right className="tabular">{fmtNum(x.liters, 0)}</Td>
                    <Td right className="tabular">{moneyShort(x.sum)}</Td>
                    <Td right className={`tabular ${per != null && x.norm && per > x.norm * 1.1 ? "font-medium text-red-700" : ""}`}>{per != null ? fmtNum(per, 1) : "—"}{x.norm ? <span className="text-xs text-slate-400"> / {fmtNum(x.norm, 1)}</span> : null}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <p className="px-5 pb-4 pt-2 text-xs text-slate-500">Sarf — probegi yozilgan quyishlar bo'yicha, "to'liq bak" usuli: birinchi quyishning litri hisobga kirmaydi (u oldingi yo'l uchun).</p>
        </Card>
        <Card padded={false} className="xl:col-span-3">
          <div id="zapravkalar" className="scroll-mt-20 px-5 pt-5"><CardHeader title="Zapravkalar" icon={Fuel} /></div>
          <Table>
            <thead><tr><Th>Sana</Th><Th>Transport / haydovchi</Th><Th right>Litr</Th><Th right>Narx</Th><Th right>Summa</Th><Th right>Probeg</Th><Th /></tr></thead>
            <tbody>
              {logs.length === 0 && <Empty text="Zapravka yo'q" />}
              {logs.map((f) => (
                <Tr key={f.id} className={f.cancelledAt ? "bg-slate-50/60 text-slate-400" : undefined}>
                  <Td className="text-sm tabular">{date(f.date)}<div className="text-xs text-slate-500">{FUEL_TYPE[f.fuelType]}{f.station ? ` · ${f.station}` : ""}</div>{f.cancelledAt && <div className="mt-1"><Badge color="red">Bekor qilingan</Badge><div className="mt-0.5 text-xs text-slate-500">{cancelNote(f, names)}</div></div>}</Td>
                  <Td className="text-sm"><span className="tabular">{f.vehicle.plate}</span><div className="text-xs text-slate-500">{f.driver?.fullName ?? ""}{f.trip ? <> · <Link href={`/trips/${f.trip.id}`} className="hover:underline">{f.trip.deliveryNoteNo}</Link></> : null}</div></Td>
                  <Td right className="tabular">{fmtNum(Number(f.liters), 1)}</Td>
                  <Td right className="tabular">{fmtNum(Number(f.pricePerL), 0)}</Td>
                  <Td right className={`tabular ${f.cancelledAt ? "line-through" : ""}`}>{money(Number(f.amount))}</Td>
                  <Td right className="tabular">{f.odometerKm != null ? fmtNum(f.odometerKm) : "—"}</Td>
                  <Td>{!f.cancelledAt && <ConfirmButton action={cancelFuel.bind(null, f.id)} reason="required" label="" title="Bekor qilish" icon={<Undo2 size={14} />} question={`Zapravka ${date(f.date)} (${money(Number(f.amount))}) bekor qilinsinmi?`} okText="Bekor qilindi" className="h-7 px-1.5" />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
