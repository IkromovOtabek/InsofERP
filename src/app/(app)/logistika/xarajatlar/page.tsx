import Link from "next/link";
import { Coins, Fuel, Route, Truck, Undo2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { transportCosts } from "@/lib/logistics-costs";
import { EXPENSE_KIND } from "@/lib/logistics";
import { date, money, moneyShort, qty } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ConfirmButton } from "../../payments/confirm-button";
import { cancelNote, cancellerNames } from "@/lib/cancelled";
import { ExpenseForm } from "../cost-forms";
import { costOptions } from "../cost-data";
import { cancelExpense } from "../actions";
import { PeriodTabs, periodRange, RangeForm } from "../ui";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

/**
 * Transport xarajatlari (TZ 12): haydovchi, yo'l, ta'mir va boshqalar + yoqilg'i =
 * reysning jami logistika tannarxi. 1 m³ ga tannarx — xarajat / yetkazilgan hajm.
 */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; vehicleId?: string }> }) {
  await requireRoles(["LOGISTICS", "ACCOUNTING"], { module: "logistika" });
  const sp = await searchParams;
  const r = periodRange(sp, "month");
  const [rows, costs, opts, delivered, vehicles] = await Promise.all([
    db.transportExpense.findMany({
      where: { date: { gte: r.from, lt: r.to }, ...(sp.vehicleId ? { vehicleId: sp.vehicleId } : {}) },
      include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, trip: { select: { id: true, deliveryNoteNo: true } } },
      orderBy: { date: "desc" },
    }),
    transportCosts(r.from, r.to),
    costOptions(),
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, select: { qtyM3: true, vehicleId: true } }),
    db.vehicle.findMany({ select: { id: true, plate: true } }),
  ]);
  // Bekor qilingan xarajat ro'yxatda belgisi bilan qoladi; jami (`transportCosts`) uni hisobga olmaydi
  const names = await cancellerNames(rows);
  const m3 = delivered.reduce((a, t) => a + Number(t.qtyM3), 0);
  const plate = new Map(vehicles.map((v) => [v.id, v.plate]));
  const volByV = new Map<string, number>();
  for (const t of delivered) volByV.set(t.vehicleId, (volByV.get(t.vehicleId) ?? 0) + Number(t.qtyM3));

  return (
    <div>
      <SectionTabs section="transport" current="/logistika/xarajatlar" />
      <PageHeader title="Transport xarajatlari" subtitle={`${r.label} · yoqilg'i + boshqa xarajatlar = logistika tannarxi`} />
      <PeriodTabs base="/logistika/xarajatlar" current={r.period} />
      <RangeForm base="/logistika/xarajatlar" from={r.from} to={r.to} />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Jami tannarx" value={moneyShort(costs.total)} icon={Coins} tone="brand" href="#turlar" />
        <StatCard label="Yoqilg'i" value={moneyShort(costs.fuel)} hint={costs.total ? `${Math.round((costs.fuel / costs.total) * 100)}%` : undefined} icon={Fuel} href="/logistika/yoqilgi" />
        <StatCard label="Boshqa xarajat" value={moneyShort(costs.other)} icon={Truck} href="#xarajatlar" />
        <StatCard label="1 m³ ga" value={m3 ? money(costs.total / m3) : "—"} hint={`${qty(m3)} m³ yetkazildi`} icon={Route} href="#transport-boyicha" />
      </div>
      <Card className="mb-5"><CardHeader title="Xarajat qo'shish" description="Yoqilg'i — alohida bo'limda" icon={Coins} /><ExpenseForm vehicles={opts.vehicles} drivers={opts.drivers} trips={opts.trips} vehicleId={sp.vehicleId} /></Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <div id="turlar" className="scroll-mt-20" />
            <CardHeader title="Turlar bo'yicha" icon={Coins} />
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between"><span>Yoqilg'i</span><span className="tabular">{money(costs.fuel)}</span></li>
              {[...costs.byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k} className="flex justify-between"><span>{EXPENSE_KIND[k as keyof typeof EXPENSE_KIND]}</span><span className="tabular">{money(v)}</span></li>)}
            </ul>
          </Card>
          <Card padded={false}>
            <div id="transport-boyicha" className="scroll-mt-20 px-5 pt-5"><CardHeader title="Transport bo'yicha" icon={Truck} /></div>
            <Table>
              <thead><tr><Th>Transport</Th><Th right>Yoqilg'i</Th><Th right>Boshqa</Th><Th right>1 m³ ga</Th></tr></thead>
              <tbody>
                {costs.byVehicle.size === 0 && <Empty text="Ma'lumot yo'q" />}
                {[...costs.byVehicle.entries()].sort((a, b) => (b[1].fuel + b[1].other) - (a[1].fuel + a[1].other)).map(([id, x]) => {
                  const vol = volByV.get(id) ?? 0;
                  return <Tr key={id}><Td><Link href={`/logistika/transport/${id}`} className="font-medium tabular hover:underline">{plate.get(id)}</Link></Td><Td right className="tabular">{moneyShort(x.fuel)}</Td><Td right className="tabular">{moneyShort(x.other)}</Td><Td right className="tabular">{vol ? moneyShort((x.fuel + x.other) / vol) : "—"}</Td></Tr>;
                })}
              </tbody>
            </Table>
          </Card>
        </div>
        <Card padded={false} className="xl:col-span-3">
          <div id="xarajatlar" className="scroll-mt-20 px-5 pt-5"><CardHeader title="Xarajatlar" icon={Coins} /></div>
          <Table>
            <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Transport / haydovchi / reys</Th><Th right>Summa</Th><Th /></tr></thead>
            <tbody>
              {rows.length === 0 && <Empty text="Xarajat yo'q" />}
              {rows.map((e) => (
                <Tr key={e.id} className={e.cancelledAt ? "bg-slate-50/60 text-slate-400" : undefined}>
                  <Td className="text-sm tabular">{date(e.date)}</Td>
                  <Td className="text-sm">{EXPENSE_KIND[e.kind]}{e.note && <div className="text-xs text-slate-500">{e.note}</div>}{e.cancelledAt && <div className="mt-1"><Badge color="red">Bekor qilingan</Badge><div className="mt-0.5 text-xs text-slate-500">{cancelNote(e, names)}</div></div>}</Td>
                  <Td className="text-sm">{e.vehicle?.plate ?? ""}{e.driver && <span className="text-slate-500"> · {e.driver.fullName}</span>}{e.trip && <> · <Link href={`/trips/${e.trip.id}`} className="hover:underline">{e.trip.deliveryNoteNo}</Link></>}</Td>
                  <Td right className={`tabular ${e.cancelledAt ? "line-through" : ""}`}>{money(Number(e.amount))}</Td>
                  <Td>{!e.cancelledAt && <ConfirmButton action={cancelExpense.bind(null, e.id)} reason="required" label="" title="Bekor qilish" icon={<Undo2 size={14} />} question={`${EXPENSE_KIND[e.kind]} ${date(e.date)} (${money(Number(e.amount))}) bekor qilinsinmi?`} okText="Bekor qilindi" className="h-7 px-1.5" />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      <p className="mt-3 text-xs text-slate-500">Bu logistika tannarxi hisobi. Kassadan to'lov (naqd/bank) Kirim-Chiqimda alohida yoziladi.</p>
    </div>
  );
}
