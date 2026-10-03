import Link from "next/link";
import { AlertTriangle, Clock, Coins, Gauge, Timer, Truck } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { avgMin, cost, logisticsReport, onTimePct } from "@/lib/logistics-report";
import { delayLevel, ISSUE_KIND, minutesLabel, tripDelayMin, VEHICLE_TYPE } from "@/lib/logistics";
import { money, moneyShort, qty } from "@/lib/format";
import { Card, CardHeader, PageHeader, StatCard } from "@/components/ui";
import { PeriodTabs, periodRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

function Bars({ rows, fmt = (n: number) => String(n), tone = "bg-slate-800" }: { rows: { label: React.ReactNode; value: number; hint?: string }[]; fmt?: (n: number) => string; tone?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-slate-500">Ma'lumot yo'q</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[9rem_1fr_5rem] items-center gap-2 text-sm">
          <span className="truncate">{r.label}</span>
          <span className="h-2.5 rounded bg-slate-100"><span className={`block h-2.5 rounded ${tone}`} style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="text-right tabular" title={r.hint}>{fmt(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Analitika (TZ 14): o'z vaqtida yetkazish, transportdan foydalanish, 1 m³ tannarxi,
 * haydovchilar reytingi, kechikish taqsimoti, muammo turlari, eng band soatlar.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  await requireRoles(["LOGISTICS", "ACCOUNTING"], { module: "logistika" });
  const sp = await searchParams;
  const r = periodRange(sp, "month");
  const [rep, delivered, issues] = await Promise.all([
    logisticsReport(r.from, r.to),
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, select: { deliveredAt: true, loadedAt: true, plannedAt: true, status: true, order: { select: { deliveryDate: true, deliveryTime: true } } } }),
    db.tripIssue.groupBy({ by: ["kind"], where: { createdAt: { gte: r.from, lt: r.to } }, _count: true }),
  ]);
  const t = rep.total;
  const util = rep.byVehicle.filter((v) => v.type !== "PUMP");
  const avgUtil = util.length ? Math.round(util.reduce((a, v) => a + v.utilization, 0) / util.length) : null;

  // Kechikish taqsimoti
  const buckets = { onTime: 0, warn: 0, crit: 0, unknown: 0 };
  for (const x of delivered) {
    const dl = tripDelayMin(x, x.order);
    if (dl == null) buckets.unknown++;
    else { const l = delayLevel(dl, rep.settings); if (l === "ok") buckets.onTime++; else if (l === "warn") buckets.warn++; else buckets.crit++; }
  }
  // Yetkazish soatlari (qaysi soatda eng ko'p topshirilgan)
  const hours = Array.from({ length: 24 }, () => 0);
  for (const x of delivered) if (x.deliveredAt) hours[x.deliveredAt.getHours()]++;
  const hMax = Math.max(1, ...hours);
  // Haydovchi reytingi: o'z vaqtida % (60%), hajm (30%), muammosizlik (10%)
  const maxM3 = Math.max(1, ...rep.byDriver.map((d) => d.m3 + d.pieces));
  const ranked = rep.byDriver.filter((d) => d.delivered > 0).map((d) => ({
    ...d, score: Math.round((onTimePct(d) ?? 80) * 0.6 + ((d.m3 + d.pieces) / maxM3) * 100 * 0.3 + (d.issues ? Math.max(0, 100 - d.issues * 25) : 100) * 0.1),
  })).sort((a, b) => b.score - a.score);

  return (
    <div>
      <PageHeader title="Logistika analitikasi" subtitle={r.label} />
      <PeriodTabs base="/logistika/analitika" current={r.period} />
      <RangeForm base="/logistika/analitika" from={r.from} to={r.to} />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-6 [&>*]:min-w-0">
        <StatCard label="O'z vaqtida" value={onTimePct(t) != null ? `${onTimePct(t)}%` : "—"} hint={`${t.judged} ta baholandi`} icon={Clock} tone={(onTimePct(t) ?? 100) < 80 ? "warning" : "success"} />
        <StatCard label="O'rt. yetkazish" value={minutesLabel(avgMin(t))} hint="yuklash → topshirish" icon={Timer} />
        <StatCard label="Transportdan foydalanish" value={avgUtil != null ? `${avgUtil}%` : "—"} hint="o'rtacha, nasossiz" icon={Gauge} />
        <StatCard label="1 m³ tannarxi" value={t.m3 ? money(cost(t) / t.m3) : "—"} icon={Coins} />
        <StatCard label="Bekor qilingan" value={t.trips ? `${Math.round((t.cancelled / t.trips) * 100)}%` : "—"} hint={`${t.cancelled} reys`} icon={Truck} />
        <StatCard label="Muammolar" value={t.issues} icon={AlertTriangle} tone={t.issues ? "warning" : "default"} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Transportdan foydalanish" description="Band vaqt / ish vaqti" icon={Gauge} />
          <Bars rows={util.slice().sort((a, b) => b.utilization - a.utilization).map((v) => ({ label: <Link href={`/logistika/transport/${v.id}`} className="tabular hover:underline">{v.plate} <span className="text-xs text-slate-500">{VEHICLE_TYPE[v.type]}</span></Link>, value: v.utilization, hint: `${v.trips} reys, ${qty(v.m3)} m³` }))} fmt={(n) => `${n}%`} />
        </Card>
        <Card>
          <CardHeader title="Haydovchilar reytingi" description="O'z vaqtida (60%) + hajm (30%) + muammosizlik (10%)" icon={Truck} />
          <Bars rows={ranked.map((d) => ({ label: <Link href={`/logistika/haydovchilar/${d.id}`} className="hover:underline">{d.name}</Link>, value: d.score, hint: `${d.delivered} reys, ${qty(d.m3)} m³, o'z vaqtida ${onTimePct(d) ?? "—"}%` }))} fmt={(n) => `${n} ball`} tone="bg-emerald-600" />
        </Card>
        <Card>
          <CardHeader title="Transport bo'yicha xarajat, 1 m³ ga" icon={Coins} />
          <Bars rows={rep.byVehicle.filter((v) => v.m3 > 0 && cost(v) > 0).map((v) => ({ label: v.plate, value: Math.round(cost(v) / v.m3), hint: moneyShort(cost(v)) })).sort((a, b) => b.value - a.value)} fmt={(n) => moneyShort(n)} tone="bg-amber-500" />
        </Card>
        <Card>
          <CardHeader title="Obyektlar: eng ko'p yetkazilgan" icon={Truck} />
          <Bars rows={rep.bySite.slice(0, 10).map((s) => ({ label: <span title={s.customer}>{s.name}</span>, value: Math.round(s.m3 + s.pieces), hint: s.customer }))} fmt={(n) => qty(n)} />
        </Card>
        <Card>
          <CardHeader title="Kechikish taqsimoti" description={`E'tibor ≥ ${rep.settings.lateWarnMin} daq, kritik ≥ ${rep.settings.lateCritMin} daq`} icon={Clock} />
          <Bars rows={[
            { label: "O'z vaqtida", value: buckets.onTime }, { label: "Kechikdi", value: buckets.warn }, { label: "Kritik kechikdi", value: buckets.crit }, { label: "Soatsiz zayavka", value: buckets.unknown },
          ]} />
        </Card>
        <Card>
          <CardHeader title="Muammo turlari" icon={AlertTriangle} />
          <Bars rows={issues.sort((a, b) => b._count - a._count).map((i) => ({ label: ISSUE_KIND[i.kind], value: i._count }))} tone="bg-red-500" />
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Topshirish soatlari" description="Qaysi soatda eng ko'p yetkaziladi — mixer va haydovchi smenasini shunga moslang" icon={Clock} />
        <div className="flex h-36 items-end gap-1">
          {hours.map((n, h) => (
            <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${h}:00 — ${n} reys`}>
              <span className="text-[10px] text-slate-500 tabular">{n || ""}</span>
              <div className="w-full rounded-t bg-slate-800" style={{ height: `${Math.max(1, (n / hMax) * 100)}px`, opacity: n ? 1 : 0.15 }} />
              <span className="text-[10px] text-slate-400 tabular">{h}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
