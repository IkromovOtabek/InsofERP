import Link from "next/link";
import { Target, Wallet, Percent, Gauge, AlertTriangle, Award, Users, Trash2, Check, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { biContext, BiPage } from "../shell";
import { plansTab, MONTHS_UZ, MONTHS_SHORT, type Signal } from "@/lib/bi/plans";
import { money, moneyShort, fmtNum, qty } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Badge, type BadgeColor } from "@/components/ui";
import { BarChart, LineChart, Sparkline } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, ProgressBar } from "../ui";
import { RowForm } from "@/components/row-form";
import { savePlan, deletePlan } from "./actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const pct = (v: number | null | undefined, f = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${fmtNum(v, f)}%`);
const SIG: Record<Signal, BadgeColor> = { BONUS: "green", NORMAL: "blue", OGOHLANTIRISH: "amber", XAVF: "red", "REJA YO'Q": "slate" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { s, sp, range } = await biContext(searchParams);
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear(), month = Math.min(12, Math.max(1, Number(sp.month) || now.getMonth() + 1));
  const d = await plansTab(year, month);
  const canEdit = s.role === "DIRECTOR" || s.role === "FINANCE";
  const mHref = (y: number, m: number) => `/bi-tahlil/reja?year=${y}&month=${m}`;
  const prevM = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }, nextM = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const groups: { title: string; sub: string; list: typeof d.sellers; tone: string; advice: string }[] = [
    { title: "XAVF — prognoz < 70%", sub: "qo'shimcha resurs kerak", list: d.risk, tone: "border-red-400", advice: "Qo'shimcha resurs kerak — mijoz bazasi va zayavka sifatini tekshiring" },
    { title: "OGOHLANTIRISH — 70–90%", sub: "tempni oshirish kerak", list: d.warn, tone: "border-amber-400", advice: "Kunlik kerakli sotuvga e'tibor — kichik kuch bilan rejaga chiqadi" },
    { title: "NORMAL / BONUS — ≥ 90%", sub: "barqaror davom etish", list: [...d.bonus, ...d.normal], tone: "border-emerald-400", advice: "Bonus zonasida — barqaror davom etish" },
  ];

  return (
    <BiPage title="Reja nazorati" subtitle={`${MONTHS_UZ[month - 1]} ${year} · ${d.wdPassed} / ${d.wdTotal} ish kuni (Dush–Shan). Filial → sotuvchi: har sotuvchiga oylik reja, fakt, prognoz va signal.`} tab="plans" range={range} period={false}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-2 shadow-(--shadow-card) text-[13px]">
          <Link href={mHref(prevM.y, prevM.m)} className="rounded-lg px-2.5 py-1.5 text-slate-600 hover:bg-slate-100">‹ {MONTHS_SHORT[prevM.m - 1]}</Link>
          <span className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white">{MONTHS_UZ[month - 1]} {year}</span>
          <Link href={mHref(nextM.y, nextM.m)} className="rounded-lg px-2.5 py-1.5 text-slate-600 hover:bg-slate-100">{MONTHS_SHORT[nextM.m - 1]} ›</Link>
          <div className="ml-auto flex gap-1">{MONTHS_SHORT.map((m, i) => <Link key={m} href={mHref(year, i + 1)} className={cn("rounded-md px-2 py-1 text-xs", i + 1 === month ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-500 hover:bg-slate-50")}>{m}</Link>)}</div>
        </div>

        {/* Executive summary */}
        <div>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Executive summary</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Jami reja" value={d.companyPlan ? moneyShort(d.companyPlan) : "—"} icon={Target} tone="brand" hint={d.hasCompanyPlan ? "zavod rejasi" : d.companyPlan ? "sotuvchilar rejalari yig'indisi" : "reja kiritilmagan"} />
            <Kpi label="Jami fakt" value={moneyShort(d.fact)} icon={Wallet} hint={`${d.wdPassed} ish kunida`} />
            <Kpi label="Reja bajarilishi" value={pct(d.pct, 1)} icon={Percent} tone={d.pct === null ? "default" : d.pct >= 100 ? "success" : d.pct >= 70 ? "warning" : "danger"} badge={d.pct !== null && <Badge color={SIG[d.pct >= 110 ? "BONUS" : d.pct >= 90 ? "NORMAL" : d.pct >= 70 ? "OGOHLANTIRISH" : "XAVF"]} dot={false}>{d.pct >= 110 ? "BONUS" : d.pct >= 90 ? "NORMAL" : d.pct >= 70 ? "OGOHLANTIRISH" : "XAVF"}</Badge>} />
            <Kpi label="Plan gap" value={d.companyPlan ? `${d.gap >= 0 ? "+" : "−"}${moneyShort(Math.abs(d.gap))}` : "—"} icon={Gauge} tone={d.gap >= 0 ? "success" : "danger"} hint="oy oxiridagi kutilma" />
            <Kpi label="Oy oxiri prognoz" value={pct(d.fpct, 1)} icon={Gauge} tone={d.fpct === null ? "default" : d.fpct >= 100 ? "success" : d.fpct >= 70 ? "warning" : "danger"} hint={moneyShort(d.forecast)} />
            <Kpi label="Risk sotuvchilar" value={String(d.dist.risk)} icon={AlertTriangle} tone={d.dist.risk ? "danger" : "default"} hint="prognoz < 70%" />
            <Kpi label="Bonus sotuvchilar" value={String(d.dist.bonus)} icon={Award} tone={d.dist.bonus ? "success" : "default"} hint="prognoz ≥ 110%" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel className="xl:col-span-2" title="Forecast engine" eyebrow="oylik ko'rsatkich" info="Kumulyativ fakt (uzluksiz) + prognoz (uzuq, hozirgi ish kuni tempi bilan) + reja chizig'i (ish kunlariga teng taqsimlangan).">
            <LineChart labels={d.engine.labels} series={[{ name: "Fakt (kumulyativ)", values: d.engine.cumVals, color: "#ffa800" }, { name: "Prognoz", values: d.engine.fcVals, color: "#0d78ff", dashed: true }, { name: "Reja", values: d.engine.planVals, color: "#93a3bd", dashed: true }]} formatValue={(v) => `${moneyShort(v)} so'm`} labelEvery={3} height={220} />
            <div className="mt-4 grid grid-cols-2 gap-3 text-[13px] md:grid-cols-5">
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Qolgan reja</div><div className="font-semibold tabular">{d.companyPlan ? moneyShort(Math.max(0, d.companyPlan - d.fact)) : "—"}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Qolgan ish kuni</div><div className="font-semibold tabular">{d.wdLeft}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Kerak / kun</div><div className={cn("font-semibold tabular", d.needPerDay !== null && d.needPerDay > d.avgPerDay * 1.3 ? "text-red-600" : "")}>{d.needPerDay === null ? (d.companyPlan && d.fact >= d.companyPlan ? "Bajarilgan" : "—") : d.needPerDay === 0 ? "Bajarilgan" : moneyShort(d.needPerDay)}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">O'rtacha kunlik</div><div className="font-semibold tabular">{moneyShort(d.avgPerDay)}</div></div>
              <div className="rounded-lg bg-brand-50 p-3"><div className="text-xs text-brand-700">Bonus uchun kerak / kun</div><div className="font-semibold tabular text-brand-700">{d.bonusPerDay === null ? "—" : d.bonusPerDay === 0 ? "Bajarilgan" : moneyShort(d.bonusPerDay)}</div><div className="text-[10px] text-slate-400">110% ga yetish uchun</div></div>
            </div>
            {d.volumePlan && <div className="mt-3 text-xs text-slate-500">Hajm rejasi: {qty(d.volumeFact)} / {qty(d.volumePlan)} m³ ({pct((d.volumeFact / d.volumePlan) * 100)})</div>}
          </Panel>
          <Panel title="Oylik trend" eyebrow="reja vs fakt" info="Oxirgi 6 oy. Oxirgi ustun — joriy oy (fakt), prognoz alohida.">
            <BarChart data={d.monthly.map((m) => ({ label: m.label, value: m.fact }))} compare={d.monthly.map((m) => m.plan)} formatValue={(v) => `${moneyShort(v)} so'm`} height={160} />
            <div className="mt-3 space-y-1 text-xs">{d.monthly.map((m) => <div key={m.label} className="flex justify-between"><span className="text-slate-500">{m.label}</span><span className="tabular">{m.plan ? `${moneyShort(m.fact)} / ${moneyShort(m.plan)} · ` : `${moneyShort(m.fact)} · `}<b className={m.pct === null ? "text-slate-400" : m.pct >= 100 ? "text-emerald-600" : m.pct >= 70 ? "text-amber-600" : "text-red-600"}>{pct(m.pct)}</b></span></div>)}</div>
          </Panel>
        </div>

        <Panel title="Sotuvchilar performance" eyebrow="signal = prognoz asosida" info="Reja — SalesPlan (sotuvchi kesimida). Fakt — sotuvchi kiritgan tasdiqlangan zayavkalar. Prognoz = fakt / o'tgan ish kunlari × jami ish kunlari. Trend — oxirgi 7 kun vs oldingi 7 kun." padded={false}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>#</Th><Th>Sotuvchi</Th><Th right>Reja</Th><Th right>Fakt</Th><Th right>Reja %</Th><Th right>Prognoz</Th><Th right>Fcst %</Th><Th right>Gap</Th><Th right>Kerak/kun</Th><Th>Signal</Th><Th right>Trend</Th><Th>6 oy</Th></tr></thead>
            <tbody>
              {d.sellers.length === 0 && <Empty text="Sotuvchi yo'q" icon={Users} />}
              {d.sellers.map((x, i) => <Tr key={x.id}><Td className="text-slate-400">{i + 1}</Td><Td><div className="font-medium">{x.name}</div><div className="text-[11px] text-slate-400">{x.orders} zayavka · {x.customers} mijoz · {qty(x.volume)} m³</div></Td><Td right>{x.plan === null ? <span className="text-slate-400">—</span> : moneyShort(x.plan)}</Td><Td right className="font-medium">{moneyShort(x.fact)}</Td><Td right>{x.pct === null ? "—" : <div className="min-w-16"><div className="text-xs">{pct(x.pct)}</div><ProgressBar value={x.pct} max={100} tone={x.pct >= 100 ? "success" : x.pct >= 70 ? "warning" : "danger"} /></div>}</Td><Td right>{moneyShort(x.forecast)}</Td><Td right className={cn("font-semibold", x.fpct === null ? "text-slate-400" : x.fpct >= 100 ? "text-emerald-600" : x.fpct >= 70 ? "text-amber-600" : "text-red-600")}>{pct(x.fpct)}</Td><Td right className={x.gap === null ? "text-slate-400" : x.gap >= 0 ? "text-emerald-600" : "text-red-600"}>{x.gap === null ? "—" : `${x.gap >= 0 ? "+" : "−"}${moneyShort(Math.abs(x.gap))}`}</Td><Td right>{x.needPerDay === null ? "—" : x.needPerDay === 0 ? <Check size={14} className="inline text-emerald-600" /> : moneyShort(x.needPerDay)}</Td><Td><Badge color={SIG[x.signal]} dot={false}>{x.signal}</Badge></Td><Td right className={x.trend > 5 ? "text-emerald-600" : x.trend < -5 ? "text-red-600" : "text-slate-500"}><span className="inline-flex items-center gap-1">{x.trend > 5 ? <TrendingUp size={13} /> : x.trend < -5 ? <TrendingDown size={13} /> : <Minus size={13} />} {fmtNum(Math.abs(x.trend), 0)}%</span></Td><Td>{x.spark.some((v) => v !== null) ? <Sparkline values={x.spark.map((v) => v ?? 0)} color={x.signal === "XAVF" ? "#fa1636" : "#00cb80"} /> : <span className="text-xs text-slate-400">—</span>}</Td></Tr>)}
            </tbody>
          </Table>
        </Panel>

        {/* Risk & action center */}
        <div>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Risk & action center</div>
          {d.noPlan.length > 0 && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"><AlertTriangle size={14} className="mr-1 inline" /> <b>{d.noPlan.length} ta sotuvchi rejasiz:</b> {d.noPlan.slice(0, 5).map((x) => x.name).join(", ")}{d.noPlan.length > 5 ? ` va yana ${d.noPlan.length - 5} ta` : ""} — rejani kiriting, usiz bajarilish foizi hisoblanmaydi.</div>}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {groups.map((g) => (
              <div key={g.title} className={cn("rounded-(--radius-card) border border-slate-200/80 border-l-4 bg-white p-4 shadow-(--shadow-card)", g.tone)}>
                <div className="text-[12px] font-semibold uppercase tracking-wider">{g.title}</div><div className="text-xs text-slate-500">{g.sub}</div>
                {g.list.length ? <ul className="mt-3 space-y-2.5 text-[13px]">{g.list.map((x) => <li key={x.id} className="rounded-lg bg-slate-50 p-2.5"><div className="font-semibold">{x.name}</div><div className="text-xs text-slate-600">Prognoz {pct(x.fpct)} · Gap {x.gap === null ? "—" : `${x.gap >= 0 ? "+" : "−"}${moneyShort(Math.abs(x.gap))}`}{x.needPerDay ? ` · kerak ${moneyShort(x.needPerDay)}/kun` : ""}</div><div className="mt-1 text-xs text-slate-500">› {g.advice}</div></li>)}</ul> : <div className="mt-3 text-xs text-slate-400">Bu guruhda sotuvchi yo'q</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Reja kiritish */}
        {canEdit && (
          <Panel title="Reja kiritish" info="Zavod rejasi — sotuvchini tanlamang. Sotuvchi rejasi — sotuvchini tanlang. Bir xil oy/sotuvchi qayta kiritilsa — yangilanadi.">
            <RowForm action={savePlan} mode="create" submit="Saqlash" cols={6} fields={[
              { name: "year", label: "Yil *", type: "number", defaultValue: year, required: true },
              { name: "month", label: "Oy *", type: "select", defaultValue: String(month), options: MONTHS_UZ.map((m, i) => [String(i + 1), m]) },
              { name: "sellerId", label: "Sotuvchi", type: "select", defaultValue: "", options: [["", "Zavod (umumiy)"], ...d.users.map((u) => [u.id, u.fullName] as [string, string])] },
              { name: "amount", label: "Reja summasi (so'm) *", type: "number", step: "1", required: true },
              { name: "volumeM3", label: "Hajm (m³)", type: "number", step: "0.1" },
              { name: "note", label: "Izoh" },
            ]} />
            {d.plans.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full text-[13px]"><thead><tr><Th>Kim</Th><Th right>Summa</Th><Th right>Hajm</Th><Th>Izoh</Th><Th></Th></tr></thead><tbody>{d.plans.map((p) => <Tr key={p.id}><Td>{p.sellerId ? d.users.find((u) => u.id === p.sellerId)?.fullName ?? p.sellerId : <b>Zavod (umumiy)</b>}</Td><Td right className="font-medium">{money(Number(p.amount))}</Td><Td right>{p.volumeM3 ? `${qty(Number(p.volumeM3))} m³` : "—"}</Td><Td className="text-xs text-slate-500">{p.note ?? ""}</Td><Td right><form action={deletePlan.bind(null, p.id)}><button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50" title="O'chirish"><Trash2 size={12} /> O'chirish</button></form></Td></Tr>)}</tbody></table></div>}
          </Panel>
        )}
        <Why label="Reja qanday o'qiladi?"><p>Reja % — hozirgacha bajarilgan ulush. Prognoz % — hozirgi kunlik temp oy oxirigacha davom etsa qancha bo'ladi; signal shu bo'yicha. Gap — prognoz − reja.</p><p>Bonus ≥110%, Normal ≥90%, Ogohlantirish 70–90%, Xavf &lt;70%. Ish kunlari — dushanbadan shanbagacha.</p></Why>
        <Insight>{d.companyPlan ? `${MONTHS_UZ[month - 1]}: reja ${money(d.companyPlan)}, fakt ${money(d.fact)} (${pct(d.pct)}). Hozirgi temp bilan oy oxirida ${pct(d.fpct)} — ${d.fpct !== null && d.fpct >= 100 ? "reja bajariladi" : `rejaga ${moneyShort(Math.abs(d.gap))} so'm yetmaydi, kuniga ${d.needPerDay ? moneyShort(d.needPerDay) : "—"} kerak (hozir ${moneyShort(d.avgPerDay)})`}.` : "Bu oy uchun reja kiritilmagan — yuqoridagi formadan zavod va sotuvchilar rejasini kiriting; shundan keyin bajarilish, prognoz va signal hisoblanadi."}</Insight>
        <div><Action href="/bi-tahlil/agentlar">Sotuvchilar scorecard — kim qanday ishlayapti</Action></div>
      </div>
    </BiPage>
  );
}
