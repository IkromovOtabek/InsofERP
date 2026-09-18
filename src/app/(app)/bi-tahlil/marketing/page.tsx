import Link from "next/link";
import { Megaphone, Users, Wallet, TrendingUp, Percent, Coins, Ban, ArrowUpRight, CheckCircle2, TrendingDown } from "lucide-react";
import { biContext, BiPage } from "../shell";
import { marketingTab, type Verdict } from "@/lib/bi/marketing";
import { money, moneyShort, fmtNum } from "@/lib/format";
import { Table, Th, Td, Tr, Badge, type BadgeColor } from "@/components/ui";
import { BarChart, HBarList, LineChart } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, ProgressBar } from "../ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const x = (v: number | null) => (v === null ? "—" : `${fmtNum(v, 2)}x`);
const V: Record<Verdict, { color: BadgeColor; icon: typeof Ban }> = { "TO'XTATING": { color: "red", icon: Ban }, KAMAYTIRING: { color: "amber", icon: TrendingDown }, SAQLANG: { color: "blue", icon: CheckCircle2 }, "KO'PAYTIRING": { color: "green", icon: ArrowUpRight }, "MA'LUMOT KAM": { color: "slate", icon: CheckCircle2 } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { range } = await biContext(searchParams);
  const d = await marketingTab(range);
  const t = d.t;

  return (
    <BiPage title="Marketing" subtitle="Pul qayerga ketyapti — ROAS, CAC, ROMI, LTV, CPL; kanal bo'yicha hukm (nimani kesish, nimani ko'paytirish), voronka va trend. Ma'lumot — Marketing ma'lumotlari sahifasidagi fakt yozuvlaridan." tab="marketing" range={range}>
      <div className="space-y-6">
        {!d.has && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">Bu davr ({d.months.map((m) => `${m.month}.${m.year}`).join(", ")}) uchun <b>fakt</b> yozuvlari kiritilmagan. <Link href="/bi-tahlil/marketing/malumotlar" className="font-medium underline">Marketing ma'lumotlari</Link> sahifasida oy × kanal bo'yicha xarajat, lead, mijoz va daromadni kiriting.</div>}

        <Panel title="Marketing — pul qayerga ketyapti" eyebrow={`${range.label} · xarajat ${moneyShort(t.spend)} · sotuv ${moneyShort(t.revenue)} so'm`} info="ROAS = daromad / xarajat. CAC = xarajat / yangi mijozlar. ROMI = (daromad − xarajat) / xarajat. LTV — ERP mijozlar bazasidan o'rtacha umrlik tushum (TAXMIN). CPL = xarajat / leadlar.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {[
              { label: "ROAS", value: x(t.roas), sub: "Reklama qaytimi", text: t.roas !== null ? `Reklamaga sarflangan har 1 so'mga ${fmtNum(t.roas, 2)} so'm sotuv qaytyapti.` : "Xarajat kiritilmagan.", delta: d.deltas.roas, good: true },
              { label: "CAC", value: t.cac !== null ? moneyShort(t.cac) : "—", sub: "Bitta mijoz narxi", text: t.cac !== null ? `Bitta yangi mijozni jalb qilish ${moneyShort(t.cac)} so'mga tushyapti. Birinchi cheki — ${moneyShort(d.firstCheck)} so'm.` : "Mijozlar soni kiritilmagan.", delta: d.deltas.cac, good: false },
              { label: "ROMI", value: t.romi !== null ? `${t.romi >= 0 ? "+" : ""}${fmtNum(t.romi, 0)}%` : "—", sub: "Marketing foydasi", text: t.spend ? `Marketing ${moneyShort(t.spend)} so'm yedi va ${moneyShort(t.revenue)} so'm sotuv keltirdi — farqi ${moneyShort(t.profit)} so'm.` : "—", delta: d.deltas.romi, good: true },
              { label: "LTV", value: moneyShort(d.ltv), sub: "Mijozning umrlik qiymati", text: `Bitta mijoz umri davomida o'rtacha ${moneyShort(d.ltv)} so'm keltiradi (ERP bazasi). CAC ga nisbati ${d.ltvCac !== null ? `${fmtNum(d.ltvCac, 1)}x` : "—"}.`, delta: null, good: true, badge: "TAXMIN" },
              { label: "Cost per lead", value: t.cpl !== null ? moneyShort(t.cpl) : "—", sub: "Bitta murojaat narxi", text: t.cpl !== null ? `Bitta murojaat ${moneyShort(t.cpl)} so'mga tushyapti. Ulardan ${fmtNum(d.conversion, 0)}% i mijozga aylanyapti.` : "Leadlar kiritilmagan.", delta: d.deltas.cpl, good: false },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-slate-200 p-3.5">
                <div className="flex items-center justify-between"><div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>{c.badge && <Badge color="amber" dot={false}>{c.badge}</Badge>}</div>
                <div className="mt-1 text-2xl font-bold tabular">{c.value}</div><div className="text-xs font-medium text-slate-700">{c.sub}</div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{c.text}</p>
                {c.delta !== null && c.delta !== undefined && <div className={cn("mt-1.5 text-[11px] font-medium", (c.good ? c.delta >= 0 : c.delta <= 0) ? "text-emerald-600" : "text-red-600")}>{c.delta >= 0 ? "+" : ""}{fmtNum(c.delta, 1)}% oldingi davrga nisbatan</div>}
              </div>
            ))}
          </div>
          {d.ltvCac !== null && <div className={cn("mt-3 rounded-lg border px-3.5 py-2.5 text-[13px]", d.ltvCac >= 3 ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>LTV / CAC = {fmtNum(d.ltvCac, 1)}x — {d.ltvCac >= 3 ? "sog'lom nisbat: mijoz o'ziga sarflangan puldan ancha ko'p keltiradi." : "past nisbat: mijozni jalb qilish uning keltiradigan pulidan qimmat."} LTV taxminiy — ERP bazasidagi o'rtacha umrlik tushum.</div>}
          {d.has && <div className="mt-3"><Insight>Marketing {money(t.spend)} sarfladi va {money(t.revenue)} sotuv keltirdi — har 1 so'mga {x(t.roas)}. {t.customers} ta yangi mijoz keldi{t.cac !== null ? `, har biri ${moneyShort(t.cac)} so'mga tushdi` : ""}. ERP da shu davrda {d.erpNew} ta mijoz birinchi buyurtma bergan.</Insight></div>}
        </Panel>

        {/* Byudjet hukmi */}
        <Panel title="Byudjet hukmi — nimani kesish, nimani ko'paytirish" eyebrow="hukm kanal bo'yicha" info="Mediana ROAS bo'yicha: <1x — to'xtating; mediananing 60% dan past — kamaytiring; 130% dan yuqori — ko'paytiring. Qayta taqsimlashda kanal samaradorligining 70% i saqlanadi deb olinadi.">
          {d.stop.length > 0 && <div className="mb-4 rounded-lg border-l-4 border-red-500 bg-red-50/70 p-3.5 text-[13px]">
            <div className="font-semibold text-red-900"><Ban size={14} className="mr-1 inline" /> Shu {d.stop.length} ta kanalni to'xtating — ular sarflangan puldan kam qaytaryapti. Zarar {moneyShort(d.stopLoss)} so'm</div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">{d.stop.map((c) => <div key={c.channel} className="rounded-md bg-white p-2.5"><div className="font-semibold">{c.channel}</div><div className="text-xs text-slate-600">{moneyShort(c.spend)} sarflandi → {moneyShort(c.revenue)} qaytdi · ROAS {x(c.roas)}</div><div className="text-sm font-semibold tabular text-red-600">−{moneyShort(c.spend - c.revenue)} so'm</div></div>)}</div>
            {d.best && d.best.roas && <div className="mt-2 text-slate-700">Bo'shaydigan <b>{moneyShort(d.freed)} so'm</b> {d.best.channel}ga ({x(d.best.roas)}) o'tkazilsa — konservativ hisobda <b>{moneyShort(d.reallocGain)} so'm</b> sotuv kutiladi.</div>}
          </div>}
          {d.verdicts.length ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{d.verdicts.map((c) => { const v = V[c.verdict]; return (
            <div key={c.channel} className="rounded-lg border border-slate-200 p-3.5 text-[13px]">
              <div className="flex items-center justify-between"><div className="font-semibold">{c.channel}</div><Badge color={v.color} dot={false}>{c.verdict}</Badge></div>
              <div className="mt-1.5 text-xl font-bold tabular">ROAS {x(c.roas)}</div>
              {c.trend !== null && <div className={cn("text-[11px] font-medium", c.trend >= 0 ? "text-emerald-600" : "text-red-600")}>{c.trend >= 0 ? "+" : ""}{fmtNum(c.trend, 1)}% trend</div>}
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-600"><span>xarajat {moneyShort(c.spend)}</span><span>foyda {moneyShort(c.profit)}</span><span>CAC {c.cac !== null ? moneyShort(c.cac) : "—"}</span><span>CPL {c.cpl !== null ? moneyShort(c.cpl) : "—"}</span></div>
              <p className="mt-2 text-xs text-slate-500">{c.verdict === "TO'XTATING" ? "Sarflangan puldan kam qaytaryapti — to'xtating yoki auditoriyani qayta ko'ring." : c.verdict === "KAMAYTIRING" ? `Zarar emas, lekin medianadan (${fmtNum(d.med, 2)}x) ancha past — shu pul boshqa kanalda ko'proq ishlaydi.` : c.verdict === "KO'PAYTIRING" ? `Medianadan sezilarli yuqori — byudjetni shu yerga surish eng foydali.` : c.verdict === "SAQLANG" ? "Kompaniya darajasida — o'zgartirish shart emas." : "Xarajat yoki daromad kiritilmagan."}</p>
            </div>); })}</div> : <Note>Kanal ma'lumotlari yo'q.</Note>}
          {d.verdicts.length > 0 && <div className="mt-2 text-xs text-slate-500">Kanal medianasi: {fmtNum(d.med, 2)}x</div>}
        </Panel>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="Nima e'tibor talab qiladi">{d.signals.length ? <ul className="space-y-2.5 text-[13px]">{d.signals.map((s, i) => <li key={i} className="flex items-start gap-2"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", { success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500", info: "bg-blue-500" }[s.level])} /><div><div className="font-semibold">{s.title}</div><div className="text-xs text-slate-500">{s.text}</div></div></li>)}</ul> : <Note>Signal yo'q.</Note>}</Panel>
          <div className="grid grid-cols-2 gap-3 xl:col-span-2 md:grid-cols-3">
            <Kpi label="Marketing xarajati" value={moneyShort(t.spend)} delta={d.deltas.spend} invert icon={Wallet} hint={`byudjet ${moneyShort(t.budget)}`} />
            <Kpi label="Leadlar" value={String(t.leads)} delta={d.deltas.leads} icon={Megaphone} tone="info" hint={`konversiya ${fmtNum(d.conversion, 0)}%`} />
            <Kpi label="Yangi mijozlar" value={String(t.customers)} delta={d.deltas.customers} icon={Users} tone="violet" hint={`ERP: ${d.erpNew} ta birinchi buyurtma`} />
            <Kpi label="Marketing daromadi" value={moneyShort(t.revenue)} delta={d.deltas.revenue} icon={TrendingUp} tone="brand" />
            <Kpi label="ROAS" value={x(t.roas)} delta={d.deltas.roas} icon={Percent} tone={t.roas !== null && t.roas >= 1 ? "success" : "danger"} />
            <Kpi label="CAC" value={t.cac !== null ? moneyShort(t.cac) : "—"} delta={d.deltas.cac} invert icon={Coins} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Marketing voronkasi" info="Ko'rsatish → bosish → lead → mijoz. Har bosqichda o'tish ulushi va bitta birlik narxi.">
            {t.impressions || t.leads ? <div className="space-y-2">{d.funnel.map((f, i, arr) => { const prev = i ? arr[i - 1].value : 0; const conv = prev ? (f.value / prev) * 100 : null; return <div key={f.label}><div className="flex justify-between text-[13px]"><span className="font-medium">{f.label}</span><span className="tabular">{fmtNum(f.value, 0)}{conv !== null && <span className="ml-2 text-xs text-slate-500">{fmtNum(conv, 2)}% o'tdi</span>}<span className="ml-2 text-xs text-slate-400">{f.cost ? `${moneyShort(f.cost)}/dona` : ""}</span></span></div><ProgressBar value={f.value} max={arr[0].value || f.value || 1} tone={(["slate", "info", "warning", "success"] as const)[i]} /></div>; })}<div className="mt-3 flex justify-between rounded-lg bg-slate-50 p-3 text-[13px]"><span className="font-semibold">Yakuniy natija</span><span className="font-bold tabular">{moneyShort(t.revenue)} so'm · ROAS {x(t.roas)}</span></div></div> : <Note>Voronka uchun ko'rsatish/bosish/lead ma'lumotlari kiritilmagan.</Note>}
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">CTR</div><div className="font-semibold">{fmtNum(d.ctr, 2)}%</div></div><div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">CPM</div><div className="font-semibold">{moneyShort(d.cpm)}</div></div><div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">CPC</div><div className="font-semibold">{moneyShort(d.cpc)}</div></div></div>
          </Panel>
          <Panel title="Trend — oy bo'yicha" info="Davr ichidagi oylar: xarajat vs daromad, leadlar.">
            {d.trend.length > 1 ? <LineChart labels={d.trend.map((m) => m.label)} series={[{ name: "Daromad", values: d.trend.map((m) => m.revenue), color: "#f59e0b" }, { name: "Xarajat", values: d.trend.map((m) => m.spend), color: "#ef4444" }]} formatValue={(v) => `${moneyShort(v)} so'm`} height={180} /> : <BarChart data={d.trend.map((m) => ({ label: m.label, value: m.revenue }))} compare={d.trend.map((m) => m.spend)} formatValue={(v) => `${moneyShort(v)} so'm`} height={160} />}
            <div className="mt-3"><HBarList data={d.verdicts.slice(0, 8).map((c) => ({ label: c.channel, value: c.spend, hint: `ROAS ${x(c.roas)}`, tone: c.verdict === "TO'XTATING" ? ("danger" as const) : c.verdict === "KO'PAYTIRING" ? ("success" as const) : ("info" as const) }))} formatValue={moneyShort} /></div>
          </Panel>
        </div>

        <Panel title="Kanallar jadvali" padded={false}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Kanal</Th><Th>Hukm</Th><Th right>Byudjet</Th><Th right>Xarajat</Th><Th right>Leadlar</Th><Th right>Mijozlar</Th><Th right>Daromad</Th><Th right>Foyda</Th><Th right>ROAS</Th><Th right>CAC</Th><Th right>CPL</Th></tr></thead>
            <tbody>{d.verdicts.map((c) => <Tr key={c.channel}><Td className="font-medium">{c.channel}</Td><Td><Badge color={V[c.verdict].color} dot={false}>{c.verdict}</Badge></Td><Td right>{moneyShort(c.budget)}</Td><Td right>{moneyShort(c.spend)}</Td><Td right>{c.leads}</Td><Td right>{c.customers}</Td><Td right>{moneyShort(c.revenue)}</Td><Td right className={c.profit < 0 ? "text-red-600" : "text-emerald-700"}>{moneyShort(c.profit)}</Td><Td right className="font-semibold">{x(c.roas)}</Td><Td right>{c.cac !== null ? moneyShort(c.cac) : "—"}</Td><Td right>{c.cpl !== null ? moneyShort(c.cpl) : "—"}</Td></Tr>)}</tbody>
          </Table>
        </Panel>
        <Why label="Qanday hisoblangan"><p>Barcha raqamlar Marketing ma'lumotlari sahifasidagi <b>Fakt</b> yozuvlaridan (oy × kanal). Davr — tanlangan sanaga tegadigan oylar. Oldingi davr — shuncha oy oldin.</p><p>LTV — ERP dagi xarid qilgan mijozlarning o'rtacha umrlik tushumi. Marketing mijozlari soni ERP dagi «birinchi buyurtma» soniga tenglashtirilmagan — ikkalasi yonma-yon ko'rsatiladi.</p></Why>
        <div className="flex flex-wrap gap-4"><Action href="/bi-tahlil/marketing/malumotlar">Marketing ma'lumotlarini kiritish</Action><Action href="/bi-tahlil/marketing/reja">Reja bajarilishini ko'rish</Action></div>
      </div>
    </BiPage>
  );
}
