import Link from "next/link";
import { Factory, Layers, Truck, PackageCheck, Timer, Target, CheckCircle2, AlertTriangle, Medal, Trophy } from "lucide-react";
import { operationsTab } from "@/lib/bi/operations";
import { type Range, type Gran, autoGran } from "@/lib/bi/core";
import { fmtNum, qty, date as fmtDate } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Badge } from "@/components/ui";
import { DonutChart, HBarList, Heatmap, LineChart } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, Tag, Chip, ProgressBar, tabHref } from "../ui";
import { OrderStatusBadge } from "../../orders/status";
import type { SP } from "../page";
import { cn } from "@/lib/utils";

export async function OperationsTab({ range, sp }: { range: Range; sp: SP }) {
  const gran: Gran = sp.gran === "day" || sp.gran === "week" || sp.gran === "month" ? sp.gran : autoGran(range.days);
  const d = await operationsTab(range, gran);
  const k = d.kpis;
  const top5 = d.drivers.slice(0, 5), bottom5 = d.drivers.length > 5 ? [...d.drivers].reverse().slice(0, 5) : d.drivers.filter((x) => x.tier === "PAST" || x.tier === "O'RTA").reverse();
  // Birinchi uchtasi — oltin, kumush, bronza medal ikonkasi; qolgani tartib raqami
  const MEDAL = ["text-amber-500", "text-slate-400", "text-orange-700"];
  const medal = (i: number) => (i < 3 ? <Medal size={16} className={MEDAL[i]} /> : `${i + 1}.`);

  return (
    <div className="space-y-6">
      {d.signals.length > 0 && (
        <Panel title={<span className="inline-flex items-center gap-1.5"><AlertTriangle size={15} className="text-red-500" /> Ogohlantirishlar</span>} info={`${d.signals.length} ta signal`} padded={false}>
          <ul className="divide-y divide-slate-100">{d.signals.map((s, i) => <li key={i} className="flex items-start gap-3 px-5 py-2.5 text-[13px]"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", s.level === "danger" ? "bg-red-500" : s.level === "warning" ? "bg-amber-500" : "bg-blue-500")} /><div className="min-w-0 flex-1"><div className="font-semibold">{s.title}</div><div className="text-xs text-slate-500">{s.text}</div></div>{s.href && <Link href={s.href} className="text-xs font-medium text-blue-600 hover:underline">Ochish →</Link>}</li>)}</ul>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Ishlab chiqarildi" value={`${qty(k.produced.cur)} m³`} delta={k.produced.delta} icon={Factory} tone="brand" hint={`${fmtNum(k.perDay, 1)} m³/kun`} />
        <Kpi label="Zameslar" value={String(k.batches.cur)} delta={k.batches.delta} icon={Layers} hint={`${d.noOrderCount} ta zayavkasiz`} />
        <Kpi label="Reyslar" value={String(k.trips.cur)} delta={k.trips.delta} icon={Truck} tone="info" hint={`${k.cancelled} ta bekor`} />
        <Kpi label="Yetkazildi" value={`${qty(k.deliveredM3.cur)} m³`} delta={k.deliveredM3.delta} icon={PackageCheck} tone="success" />
        <Kpi label="Yetkazish darajasi" value={`${fmtNum(k.deliveryRate.cur, 0)}%`} delta={k.deliveryRate.cur - k.deliveryRate.prev} deltaLabel="p.p." icon={CheckCircle2} tone={k.deliveryRate.cur >= 90 ? "success" : "warning"} />
        <Kpi label="O'rtacha reys vaqti" value={k.avgMinutes.cur ? `${fmtNum(k.avgMinutes.cur, 0)} daq` : "—"} delta={k.avgMinutes.delta} invert icon={Timer} hint="yuklashdan topshirishgacha" />
        <Kpi label="O'z vaqtida" value={`${fmtNum(k.onTime.cur, 0)}%`} icon={Target} tone={k.onTime.cur >= 90 ? "success" : "danger"} hint={`${d.late} ta kechikkan`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Ishlab chiqarish va yetkazish dinamikasi" info="Zames hajmi (m³) va yetkazilgan hajm — davr bo'yicha." action={<div className="flex gap-1">{(["day", "week", "month"] as const).map((g) => <Chip key={g} active={gran === g} href={tabHref(range, "operations", { gran: g })}>{{ day: "Kunlik", week: "Haftalik", month: "Oylik" }[g]}</Chip>)}</div>}>
          <LineChart labels={d.prodDyn.map((x) => x.label)} series={[{ name: "Ishlab chiqarildi", values: d.prodDyn.map((x) => x.value), color: "#ffa800" }, { name: "Yetkazildi", values: d.shipDyn.map((x) => x.value), color: "#00cb80" }]} formatValue={(v) => `${qty(v)} m³`} labelEvery={Math.max(1, Math.ceil(d.prodDyn.length / 12))} height={200} />
        </Panel>
        <Panel title="Smena va marka bo'yicha" info="Zames hajmi taqsimoti.">
          {d.byShift.length ? <DonutChart data={d.byShift} formatValue={(v) => `${qty(v)} m³`} size={110} /> : <Note>Zames yo'q.</Note>}
          <div className="mt-4 border-t border-slate-100 pt-3">{d.byProduct.length ? <HBarList data={d.byProduct.slice(0, 6).map((p) => ({ label: p.label, value: p.value, hint: `${p.batches} zames` }))} formatValue={(v) => `${qty(v)} m³`} tone="brand" /> : <Note>—</Note>}</div>
        </Panel>
      </div>

      <Panel title="Mikserlar — scorecard" info="Reyslar, hajm, faol kunlar, kuniga reys, to'ldirish (hajm / sig'im), o'rtacha reys vaqti. «Bo'sh» — 7 kundan beri reys yo'q." padded={false}>
        <Table className="rounded-none border-0 shadow-none">
          <thead><tr><Th>Mikser</Th><Th right>Reyslar</Th><Th right>Yetkazildi</Th><Th right>Hajm, m³</Th><Th right>Faol kun</Th><Th right>Reys/kun</Th><Th className="w-36">To'ldirish</Th><Th right>O'rt. vaqt</Th><Th>Holat</Th></tr></thead>
          <tbody>{d.mixers.length === 0 && <Empty text="Mikser kiritilmagan" icon={Truck} />}{d.mixers.map((m) => <Tr key={m.id}><Td className="tabular">{m.plate}</Td><Td right>{m.trips}</Td><Td right>{m.delivered}</Td><Td right>{qty(m.m3)}</Td><Td right>{m.daysActive}</Td><Td right>{fmtNum(m.tripsPerDay, 1)}</Td><Td>{m.fill === null ? <span className="text-slate-400">sig'im yo'q</span> : <div><div className="text-xs tabular">{fmtNum(m.fill, 0)}%</div><ProgressBar value={m.fill} max={100} tone={m.fill >= 80 ? "success" : "warning"} /></div>}</Td><Td right>{m.avgMinutes ? `${fmtNum(m.avgMinutes, 0)} daq` : "—"}</Td><Td>{m.idle ? <Badge color="red">Bo'sh 7+ kun</Badge> : <Badge color="green">Ishlamoqda</Badge>}</Td></Tr>)}</tbody>
        </Table>
        {d.others.length > 0 && <div className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">Boshqa texnika: {d.others.map((o) => `${o.plate} (${o.type}, ${o.trips} reys${o.idle ? ", bo'sh" : ""})`).join(" · ")}</div>}
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Haydovchilar — scorecard" info="Score 0–100: hajm (40%), yetkazish darajasi (35%), tezlik (15%), kechikish/bekor (10%). Tier: TOP ≥80, YAXSHI ≥60, O'RTA ≥40, PAST <40." padded={false}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>#</Th><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Yetkazildi</Th><Th right>Bajarish</Th><Th right>m³</Th><Th right>Kun</Th><Th right>O'rt. vaqt</Th><Th right>Kechikdi</Th><Th right>Score</Th><Th>Tier</Th></tr></thead>
            <tbody>{d.drivers.length === 0 && <Empty text="Davrda reys yo'q" icon={Truck} />}{d.drivers.map((x, i) => <Tr key={x.id}><Td className="text-slate-400">{i + 1}</Td><Td>{x.name}</Td><Td right>{x.trips}</Td><Td right>{x.delivered}</Td><Td right className={x.rate < 70 ? "text-red-600" : ""}>{fmtNum(x.rate, 0)}%</Td><Td right>{qty(x.m3)}</Td><Td right>{x.days}</Td><Td right>{x.avgMinutes ? `${fmtNum(x.avgMinutes, 0)}` : "—"}</Td><Td right className={x.late + x.cancelled ? "text-amber-600" : ""}>{x.late}{x.cancelled ? ` +${x.cancelled} bekor` : ""}</Td><Td right className="font-semibold">{x.score}</Td><Td><Tag>{x.tier}</Tag></Td></Tr>)}</tbody>
          </Table>
        </Panel>
        <div className="space-y-6">
          <Panel title={<><Trophy size={15} className="text-amber-500" /> Top 5 haydovchi</>}>{top5.length ? <ul className="space-y-2 text-[13px]">{top5.map((x, i) => <li key={x.id} className="flex items-center gap-2"><span className="inline-flex w-6 justify-center">{medal(i)}</span><span className="flex-1 truncate">{x.name}<span className="ml-1 text-xs text-slate-400">{qty(x.m3)} m³</span></span><span className="font-semibold tabular">{x.score}</span><span className="w-10 text-right text-xs text-slate-500">{fmtNum(x.rate, 0)}%</span></li>)}</ul> : <Note>—</Note>}</Panel>
          <Panel title={<><AlertTriangle size={15} className="text-amber-600" /> Bottom 5 haydovchi</>}>{bottom5.length ? <ul className="space-y-2 text-[13px]">{bottom5.map((x, i) => <li key={x.id} className="flex items-center gap-2"><span className="w-6 text-center text-slate-400">{bottom5.length - i}.</span><span className="flex-1 truncate">{x.name}<span className="ml-1 text-xs text-slate-400">{qty(x.m3)} m³</span></span><span className="font-semibold tabular">{x.score}</span><span className="w-10 text-right text-xs text-slate-500">{fmtNum(x.rate, 0)}%</span></li>)}</ul> : <Note>—</Note>}</Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Haftalik faollik — top 10 haydovchi × hafta kuni" info="So'nggi 7 kun, reyslar soni.">
          {d.heat.rows.length ? <Heatmap rows={d.heat.rows} cols={d.heat.cols} cells={d.heat.cells} formatValue={(v) => String(v)} tone="info" rowLabel="Haydovchi" /> : <Note>So'nggi 7 kunda reys yo'q.</Note>}
        </Panel>
        <Panel title="Zayavkalar bajarilishi" info="Tasdiqlangan / ishlab chiqarishdagi zayavkalar: ishlab chiqarilgan va jo'natilgan ulush. Qizil — yetkazish sanasi o'tgan." padded={false} action={<span>Qoldiq: <b className="text-slate-800">{qty(d.backlog)} m³</b></span>}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Zayavka</Th><Th>Mijoz</Th><Th right>Muddat</Th><Th className="w-44">Bajarilishi</Th><Th>Holat</Th></tr></thead>
            <tbody>{d.orders.length === 0 && <Empty text="Ochiq zayavka yo'q" />}{d.orders.slice(0, 12).map((o) => <Tr key={o.id} className={o.overdue ? "bg-red-50/40" : ""}><Td><Link href={`/orders/${o.id}`} className="hover:underline">{o.orderNo}</Link></Td><Td className="truncate">{o.customer}</Td><Td right className={o.overdue ? "font-semibold text-red-600" : ""}>{fmtDate(o.deliveryDate)}</Td><Td><div className="space-y-1"><div className="flex justify-between text-[11px] text-slate-500"><span>Ishlab ch.</span><span className="tabular">{qty(o.done)}/{qty(o.total)}</span></div><ProgressBar value={o.done} max={o.total} tone="slate" /><div className="flex justify-between text-[11px] text-slate-500"><span>Jo'natildi</span><span className="tabular">{qty(o.shipped)}/{qty(o.total)}</span></div><ProgressBar value={o.shipped} max={o.total} tone="success" /></div></Td><Td><OrderStatusBadge status={o.status as never} /></Td></Tr>)}</tbody>
          </Table>
        </Panel>
      </div>

      <Insight>Davrda {qty(k.produced.cur)} m³ ishlab chiqarildi ({k.batches.cur} zames), {qty(k.deliveredM3.cur)} m³ yetkazildi. Yetkazish darajasi {fmtNum(k.deliveryRate.cur, 0)}%, o'z vaqtida {fmtNum(k.onTime.cur, 0)}%. {d.mixers.filter((m) => m.idle).length ? `${d.mixers.filter((m) => m.idle).length} ta mikser bo'sh turibdi — quvvat ishlatilmayapti.` : "Barcha mikserlar ishlamoqda."} {d.overdue.length ? `${d.overdue.length} ta zayavka muddati o'tgan — mijozga xabar bering.` : ""}</Insight>
      <Why label="Kim sekinlashdi va nega?">
        {bottom5.slice(0, 3).map((x) => <p key={x.id}><b>{x.name}</b>: {x.trips} reys, bajarish {fmtNum(x.rate, 0)}%{x.late ? `, ${x.late} ta kechikish` : ""}{x.cancelled ? `, ${x.cancelled} ta bekor` : ""}. {x.rate < 70 ? "Reyslar yopilmayapti — nakladnoy holatini o'z vaqtida yangilashni tekshiring." : x.avgMinutes > (k.avgMinutes.cur || 0) * 1.3 ? "Reys vaqti o'rtachadan uzoq — marshrut yoki obyektda kutish." : "Hajm past — mikser sig'imi yoki reys soni kam."}</p>)}
        {!bottom5.length && <p>Ma'lumot yo'q.</p>}
      </Why>
      <div><Action href="/trips">Reyslar sahifasiga o'tish</Action></div>
    </div>
  );
}
