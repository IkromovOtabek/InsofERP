import Link from "next/link";
import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { biContext, BiPage } from "../../shell";
import { marketingPlanTab } from "@/lib/bi/marketing";
import { MONTHS_SHORT } from "@/lib/bi/plans";
import { moneyShort, fmtNum } from "@/lib/format";
import { Table, Th, Td, Tr, Empty } from "@/components/ui";
import { BarChart } from "@/components/ui/charts";
import { Panel, Note, ProgressBar, Chip, Action } from "../../ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
const pct = (v: number | null) => (v === null ? "—" : `${fmtNum(v, 0)}%`);
const tone = (v: number | null) => (v === null ? "slate" : v >= 100 ? "success" : v >= 70 ? "warning" : "danger") as "slate" | "success" | "warning" | "danger";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear(); const month = sp.month === undefined ? now.getMonth() + 1 : Math.min(12, Math.max(0, Number(sp.month) || 0));
  const d = await marketingPlanTab(year, month);
  const metric = ["revenue", "spend", "leads", "customers"].includes(sp.metric ?? "") ? (sp.metric as "revenue" | "spend" | "leads" | "customers") : "revenue";
  const M = { revenue: { label: "Daromad", plan: (m: typeof d.monthly[number]) => m.planRevenue, fact: (m: typeof d.monthly[number]) => m.factRevenue, fmt: (v: number) => `${moneyShort(v)} so'm` }, spend: { label: "Xarajat", plan: (m: typeof d.monthly[number]) => m.planSpend, fact: (m: typeof d.monthly[number]) => m.factSpend, fmt: (v: number) => `${moneyShort(v)} so'm` }, leads: { label: "Leadlar", plan: (m: typeof d.monthly[number]) => m.planLeads, fact: (m: typeof d.monthly[number]) => m.factLeads, fmt: (v: number) => `${v} ta` }, customers: { label: "Mijozlar", plan: (m: typeof d.monthly[number]) => m.planCustomers, fact: (m: typeof d.monthly[number]) => m.factCustomers, fmt: (v: number) => `${v} ta` } }[metric];
  const href = (p: Record<string, string | number>) => `/bi-tahlil/marketing/reja?${new URLSearchParams({ year: String(year), month: String(month), metric, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) })}`;
  const Icon = { info: Info, warning: AlertTriangle, success: CheckCircle2, danger: XCircle };

  return (
    <BiPage title="Marketing reja nazorati" subtitle="Kanal bo'yicha reja bajarilishi — xarajat, leadlar, mijozlar, daromad; oylar bo'yicha reja va fakt." tab="marketingPlan" range={range} period={false}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-2 shadow-(--shadow-card) text-[13px]">
          <Link href={href({ year: year - 1 })} className="rounded-lg px-2 py-1.5 text-slate-600 hover:bg-slate-100">‹</Link><span className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white">{year}</span><Link href={href({ year: year + 1 })} className="rounded-lg px-2 py-1.5 text-slate-600 hover:bg-slate-100">›</Link>
          <div className="ml-2 flex flex-wrap gap-1"><Chip active={month === 0} href={href({ month: 0 })}>Butun yil</Chip>{MONTHS_SHORT.map((m, i) => <Chip key={m} active={month === i + 1} href={href({ month: i + 1 })}>{m}</Chip>)}</div>
        </div>

        <Panel title="Xulosalar">
          <ul className="space-y-2 text-[13px]">{d.notes.map((n, i) => { const I = Icon[n.level]; return <li key={i} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2", { info: "border-blue-200 bg-blue-50/60", warning: "border-amber-200 bg-amber-50/60", success: "border-emerald-200 bg-emerald-50/60", danger: "border-red-200 bg-red-50/60" }[n.level])}><I size={15} className="mt-0.5 shrink-0" /><div><div className="font-semibold">{n.title}</div><div className="text-xs text-slate-600">{n.text}</div></div></li>; })}</ul>
        </Panel>

        <Panel title="Kanal bo'yicha reja bajarilishi" info="Reja — «Reja» turidagi yozuvlar; fakt — «Fakt» yozuvlari. % = fakt / reja." padded={false}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Kanal</Th><Th right>Byudjet</Th><Th right>Xarajat</Th><Th right>%</Th><Th right>Leadlar</Th><Th right>%</Th><Th right>Mijozlar</Th><Th right>%</Th><Th right>Daromad</Th><Th right>%</Th><Th right>CAC</Th><Th right>ROAS</Th></tr></thead>
            <tbody>
              {d.byChannel.length === 0 && <Empty text="Ma'lumot yo'q — Marketing ma'lumotlari sahifasida reja va fakt kiriting" />}
              {d.byChannel.map((c) => <Tr key={c.channel}><Td className="font-medium">{c.channel}</Td><Td right>{moneyShort(c.budget)}</Td><Td right>{moneyShort(c.fact.spend)}<div className="text-[10px] text-slate-400">reja {moneyShort(c.plan.spend)}</div></Td><Td right><div className="min-w-14"><span className="text-xs">{pct(c.pct.spend)}</span><ProgressBar value={c.pct.spend ?? 0} max={100} tone={c.pct.spend !== null && c.pct.spend > 110 ? "danger" : "info"} /></div></Td><Td right>{c.fact.leads}<div className="text-[10px] text-slate-400">reja {c.plan.leads}</div></Td><Td right><div className="min-w-14"><span className="text-xs">{pct(c.pct.leads)}</span><ProgressBar value={c.pct.leads ?? 0} max={100} tone={tone(c.pct.leads)} /></div></Td><Td right>{c.fact.customers}<div className="text-[10px] text-slate-400">reja {c.plan.customers}</div></Td><Td right><div className="min-w-14"><span className="text-xs">{pct(c.pct.customers)}</span><ProgressBar value={c.pct.customers ?? 0} max={100} tone={tone(c.pct.customers)} /></div></Td><Td right>{moneyShort(c.fact.revenue)}<div className="text-[10px] text-slate-400">reja {moneyShort(c.plan.revenue)}</div></Td><Td right><div className="min-w-14"><span className="text-xs">{pct(c.pct.revenue)}</span><ProgressBar value={c.pct.revenue ?? 0} max={100} tone={tone(c.pct.revenue)} /></div></Td><Td right>{c.cac !== null ? moneyShort(c.cac) : "—"}</Td><Td right>{c.roas !== null ? `${fmtNum(c.roas, 2)}x` : "—"}</Td></Tr>)}
              {d.byChannel.length > 0 && <Tr className="bg-slate-50 font-semibold"><Td>Jami</Td><Td right>{moneyShort(d.totals.budget)}</Td><Td right>{moneyShort(d.totals.fact.spend)}</Td><Td right>{pct(d.totals.plan.spend ? (d.totals.fact.spend / d.totals.plan.spend) * 100 : null)}</Td><Td right>{d.totals.fact.leads}</Td><Td right>{pct(d.totals.plan.leads ? (d.totals.fact.leads / d.totals.plan.leads) * 100 : null)}</Td><Td right>{d.totals.fact.customers}</Td><Td right>{pct(d.totals.plan.customers ? (d.totals.fact.customers / d.totals.plan.customers) * 100 : null)}</Td><Td right>{moneyShort(d.totals.fact.revenue)}</Td><Td right>{pct(d.totals.plan.revenue ? (d.totals.fact.revenue / d.totals.plan.revenue) * 100 : null)}</Td><Td right>{d.totals.fact.customers ? moneyShort(d.totals.fact.spend / d.totals.fact.customers) : "—"}</Td><Td right>{d.totals.fact.spend ? `${fmtNum(d.totals.fact.revenue / d.totals.fact.spend, 2)}x` : "—"}</Td></Tr>}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Oylar bo'yicha reja va fakt" info="Ustunlar — fakt, och kulrang — reja." action={<div className="flex gap-1">{(["revenue", "spend", "leads", "customers"] as const).map((m) => <Chip key={m} active={metric === m} href={href({ metric: m })}>{{ revenue: "Daromad", spend: "Xarajat", leads: "Leadlar", customers: "Mijozlar" }[m]}</Chip>)}</div>}>
          {d.monthly.some((m) => M.plan(m) || M.fact(m)) ? <BarChart data={d.monthly.map((m) => ({ label: m.label, value: M.fact(m) }))} compare={d.monthly.map((m) => M.plan(m))} formatValue={M.fmt} height={200} /> : <Note>{year} yil uchun {M.label.toLowerCase()} ma'lumoti yo'q.</Note>}
        </Panel>
        <div><Action href="/bi-tahlil/marketing/malumotlar">Reja va fakt yozuvlarini kiritish</Action></div>
      </div>
    </BiPage>
  );
}
