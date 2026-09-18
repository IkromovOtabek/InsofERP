import Link from "next/link";
import { Trophy, TrendingDown, WifiOff, ClipboardCheck, Users, Wallet, BarChart3, Ban, Route, Truck } from "lucide-react";
import { biContext, BiPage } from "../shell";
import { agentsTab } from "@/lib/bi/agents";
import { money, moneyShort, fmtNum, qty } from "@/lib/format";
import { Table, Th, Td, Tr, Empty } from "@/components/ui";
import { Heatmap } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, Tag, ProgressBar, ExportLink } from "../ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const pct = (v: number | null | undefined, f = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${fmtNum(v, f)}%`);

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { range } = await biContext(searchParams);
  const d = await agentsTab(range);
  const k = d.kpis;
  const card = (title: string, sub: string, n: number, text: string, money: string | null, tone: string, Icon: typeof Trophy, who: string[]) => (
    <div className={cn("rounded-(--radius-card) border border-slate-200/80 border-l-4 bg-white p-3.5 shadow-(--shadow-card)", tone)}>
      <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500"><Icon size={13} /> {title}</div><div className="text-[10px] text-slate-400">{sub}</div></div>
      <div className="mt-1 text-2xl font-bold tabular">{n}<span className="ml-1 text-xs font-medium text-slate-400">ta</span></div>
      <div className="text-xs text-slate-600">{text}</div>
      {money && <div className="mt-1 text-sm font-semibold tabular">{money}</div>}
      {who.length > 0 && <details className="mt-1.5 text-xs"><summary className="cursor-pointer text-slate-500 hover:text-slate-800">Kimlar? ({who.length})</summary><div className="mt-1 text-slate-700">{who.join(", ")}</div></details>}
    </div>
  );

  return (
    <BiPage title="Agentlar" subtitle="Sotuvchilar — qaror qatlami: kim kuchli, kim zaif, kim sekinlashdi va nega. Agent = zayavka kiritadigan sotuvchi; «tashrif» = kiritilgan zayavka." tab="agents" range={range}>
      <div className="space-y-6">
        <Note>Sekinlashuv, oflayn va bugungi ko'rsatkichlar oxirgi 35 kun bo'yicha jonli hisoblanadi — sana filtri scorecard, top/bottom va sifat kartalariga qo'llanadi.</Note>

        {/* Qaror qatlami */}
        <div>
          <div className="mb-2 flex flex-wrap items-baseline gap-2"><div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Agentlar — qaror qatlami</div><div className="text-xs text-slate-500">{d.sellers.filter((s) => s.orders > 0).length} sotuvchi ishladi · davr sotuvi {money(k.revenue.cur)} · bugun {moneyShort(k.todayRevenue)} so'm</div></div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {card("TOP", `${d.top.length} ta agent`, d.top.length, `Eng kuchli ${d.top.length} sotuvchi ${moneyShort(d.top.reduce((s, x) => s + x.revenue, 0))} so'm sotdi`, `${moneyShort(d.top.reduce((s, x) => s + x.revenue, 0))} so'm`, "border-emerald-400", Trophy, d.top.map((s) => s.name))}
            {card("BOTTOM", `${d.bottom.length} ta agent`, d.bottom.length, d.bottom.length ? `Ishladi, lekin natija past — o'rtachagacha ${moneyShort(d.bottom.reduce((s, x) => s + Math.max(0, d.avgRevenue - x.revenue), 0))} so'm yetmadi` : "Past natijali sotuvchi yo'q", null, "border-red-400", TrendingDown, d.bottom.map((s) => s.name))}
            {card("OFFLINE", "3+ kun", d.offline.length, d.offline.length ? "Sotuvchi 3 kundan beri zayavka kiritmagan" : "Hamma sotuvchi faol", null, "border-slate-400", WifiOff, d.offline.map((s) => `${s.name} (${s.offlineDays} kun)`))}
            {card("SIFAT", "zayavka → sotuv", Math.round(d.quality.pct), `Kiritilgan ${d.quality.created} zayavkadan ${d.quality.converted} tasi sotuvga aylandi (${pct(d.quality.pct)})`, null, "border-blue-400", ClipboardCheck, d.lowQ.map((s) => `${s.name} (${pct(s.conversion)})`))}
            {card("PLAN", "joriy oy", Math.round(d.planStatus.pct || 0), d.planStatus.withPlan ? `${d.planStatus.withPlan} sotuvchida reja bor: ${d.planStatus.done} bajardi, ${d.planStatus.behind} tasi 70% dan past` : "Sotuvchilarga reja kiritilmagan — Reja nazorati sahifasida kiriting", null, "border-amber-400", BarChart3, d.sellers.filter((s) => s.planPct !== null && s.planPct < 70).map((s) => `${s.name} (${pct(s.planPct)})`))}
          </div>
          <div className="mt-3"><Insight>{d.sellers.filter((s) => s.orders > 0).length} sotuvchi ishladi. {d.best ? <>Eng kuchlisi — <b>{d.best.name}</b>: {money(d.best.revenue)} ({d.best.orders} zayavka, {d.best.customers} mijoz).</> : "Davrda sotuv yo'q."} Zayavka sifati {pct(d.quality.pct)}. {d.slow.length ? `${d.slow.length} sotuvchi odatidan orqada.` : "Sekinlashgan sotuvchi yo'q."} {d.offline.length ? `${d.offline.length} sotuvchi 3+ kun ko'rinmadi.` : ""}</Insight></div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Faol sotuvchilar" value={String(k.active.cur)} delta={k.active.delta} icon={Users} hint={`${d.sellers.length} ta ro'yxatda`} />
          <Kpi label="Kiritilgan zayavkalar" value={String(k.created)} icon={ClipboardCheck} tone="info" hint={`${k.converted} tasi sotuvga aylandi`} />
          <Kpi label="Davr sotuvi" value={moneyShort(k.revenue.cur)} delta={k.revenue.delta} icon={Wallet} tone="brand" hint="so'm" />
          <Kpi label="O'rtacha / sotuvchi" value={moneyShort(k.perAgent.cur)} delta={k.perAgent.delta} icon={BarChart3} hint="so'm / faol sotuvchi" />
          <Kpi label="Bugungi sotuv" value={moneyShort(k.todayRevenue)} icon={TrendingDown} tone="success" hint={`${k.todayOrders} zayavka`} />
          <Kpi label="Bekor qilingan" value={moneyShort(k.cancelledRevenue)} icon={Ban} tone={k.cancelledRevenue ? "danger" : "default"} hint="sotuvchilar kiritgan, bekor bo'lgan" href="/bi-tahlil/sotuvlar/bekor" />
        </div>

        {/* Kim sekinlashdi va nega */}
        <Panel title="Kim sekinlashdi va NEGA" eyebrow={`${d.slow.length} ta sotuvchi · kuniga ${moneyShort(d.slowLoss)} so'm sotuv`} info="Odatiy temp = oxirgi 28 kun (7 kun oldingi) kunlik o'rtachasi; hozir = oxirgi 7 kun. 15% dan ko'p pasaysa — sekinlashgan. Sabab: zayavkalar soni (qamrov) yoki o'rtacha chek (intensivlik).">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {d.reasons.map((r) => <div key={r.key} className="rounded-lg bg-slate-50 p-3"><div className="text-[12px] font-semibold">{{ "Kam zayavka": "Kam zayavka kiritdi", "Chek tushgan": "Kiritdi, lekin chek tushdi", Ikkalasi: "Ikkala tomon ham", "Sabab noaniq": "Sabab noaniq" }[r.key]}</div><div className="text-xs text-slate-500">{r.list.length} sotuvchi · {moneyShort(r.loss)} so'm/kun</div></div>)}
          </div>
          {d.slow.length ? <ul className="mt-4 divide-y divide-slate-100">{d.slow.slice(0, 10).map((s) => (
            <li key={s.id} className="grid grid-cols-1 gap-2 py-3 text-[13px] md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="font-semibold">{s.name} {s.slowDays > 1 ? `${s.slowDays} kundan beri` : "bugun"} kam ishlayapti. <span className="font-normal text-slate-600">Sabab: {s.slowReason === "Kam zayavka" ? `${pct(Math.abs((s.nowOrdersPerDay - s.usualOrdersPerDay) / (s.usualOrdersPerDay || 1)) * 100)} kam zayavka` : s.slowReason === "Chek tushgan" ? `bitta zayavkadan tushum ${pct(Math.abs((s.nowCheck - s.usualCheck) / (s.usualCheck || 1)) * 100)} kam` : s.slowReason === "Ikkalasi" ? "zayavka ham, chek ham kamaygan" : "aniq bir omil yo'q"}.</span></div>
                <div className="mt-0.5 text-xs text-slate-500">odatda kuniga {moneyShort(s.usualPerDay)} → hozir {moneyShort(s.nowPerDay)} · zayavka {fmtNum(s.usualOrdersPerDay, 1)} → {fmtNum(s.nowOrdersPerDay, 1)}/kun · chek {moneyShort(s.usualCheck)} → {moneyShort(s.nowCheck)}</div>
              </div>
              <div className="text-right"><div className="font-semibold tabular text-red-600">−{moneyShort(s.usualPerDay - s.nowPerDay)}</div><div className="text-[11px] text-slate-400">so'm/kun</div></div>
            </li>
          ))}</ul> : <div className="mt-3"><Note>Hamma sotuvchi odatiy tempda ishlayapti.</Note></div>}
          <Why>Kam zayavka — intizom yoki mijoz bazasi bilan ishlash muammosi: tez tuzatiladi. Chek tushgan — avval omborda xomashyo bor-yo'qligini va narx siyosatini tekshiring: sotuvchi kichik zayavka olishga majbur bo'lgan bo'lishi mumkin.</Why>
        </Panel>

        {/* Zayavka sifati */}
        <Panel title="Zayavka sifati — kiritilgan zayavka sotuvga aylandimi?" eyebrow="«kiritdim» emas — «sotdimmi»" info="Konversiya = (kiritilgan − bekor − qoralama) / kiritilgan. Mediana — kamida 3 zayavka kiritganlar bo'yicha.">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div>
              <div className="text-[30px] font-bold leading-none tabular text-slate-900">{pct(d.quality.pct)}</div>
              <p className="mt-1.5 text-[13px] text-slate-600">zayavka sotuvga aylangan — {d.quality.converted} ta {d.quality.created} tadan. Qolgan {d.quality.created - d.quality.converted} tasi bekor yoki qoralamada qolgan.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-slate-50 p-2.5"><div className="text-slate-400">Bitta zayavkadan</div><div className="text-base font-semibold tabular">{moneyShort(d.quality.perOrder)}</div></div><div className="rounded-lg bg-slate-50 p-2.5"><div className="text-slate-400">Jami sotuv</div><div className="text-base font-semibold tabular">{moneyShort(d.quality.revenue)}</div></div></div>
              {d.upside > 0 && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">Pastdagilar mediana darajasiga ({pct(d.medianConv)}) ko'tarilsa — <b>+{moneyShort(d.upside)} so'm</b> qo'shimcha sotuv. Yangi sotuvchi kerak emas: shu zayavkalarning o'zidan.</div>}
            </div>
            <div><div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-600">Sifati past — bugun gaplashing</div>{d.lowQ.length ? d.lowQ.map((s) => <div key={s.id} className="flex items-center justify-between border-b border-slate-50 py-1.5 text-[13px]"><div><div className="font-medium">{s.name}</div><div className="text-xs text-slate-500">{s.created - s.cancelled - s.drafts}/{s.created} zayavka natija berdi · {moneyShort(s.revenue)} so'm</div></div><div className="font-semibold tabular text-red-600">{pct(s.conversion)}</div></div>) : <Note>—</Note>}</div>
            <div><div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Sifati yuqori — usulini so'rang</div>{d.highQ.length ? d.highQ.map((s) => <div key={s.id} className="flex items-center justify-between border-b border-slate-50 py-1.5 text-[13px]"><div><div className="font-medium">{s.name}</div><div className="text-xs text-slate-500">{s.created - s.cancelled - s.drafts}/{s.created} zayavka · bitta zayavkadan {moneyShort(s.avgCheck)}</div></div><div className="font-semibold tabular text-emerald-600">{pct(s.conversion)}</div></div>) : <Note>—</Note>}</div>
          </div>
        </Panel>

        {/* Scorecard */}
        <Panel title="Sotuvchilar scorecard" info="Ball = 45% sotuv (eng yuqoriga nisbatan) + 25% konversiya + 15% bekor qilish (kam bo'lsa yaxshi) + 15% o'sish. TOP ≥75, YAXSHI ≥55, O'RTA ≥35." padded={false} action={<ExportLink type="agents" range={range} />}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>#</Th><Th>Sotuvchi</Th><Th>Daraja</Th><Th right>Sotuv</Th><Th right>Δ oldingi</Th><Th right>Zayavka</Th><Th right>Hajm</Th><Th right>Mijoz</Th><Th right>O'rt. chek</Th><Th right>Konversiya</Th><Th right>Bekor</Th><Th right>Reja %</Th><Th right>Ball</Th></tr></thead>
            <tbody>
              {d.sellers.length === 0 && <Empty text="Sotuvchi yo'q" />}
              {d.sellers.map((s, i) => <Tr key={s.id}><Td className="text-slate-400">{i + 1}</Td><Td><div className="font-medium">{s.name}</div><div className="text-[11px] text-slate-400">{s.offlineDays !== null && s.offlineDays >= 3 ? `${s.offlineDays} kun oflayn` : s.todayOrders ? `bugun ${s.todayOrders} zayavka` : ""}</div></Td><Td><Tag>{s.tier}</Tag></Td><Td right className="font-medium">{moneyShort(s.revenue)}</Td><Td right className={s.delta === null ? "text-slate-400" : s.delta >= 0 ? "text-emerald-600" : "text-red-600"}>{s.delta === null ? "—" : `${s.delta >= 0 ? "▲" : "▼"} ${fmtNum(Math.abs(s.delta), 0)}%`}</Td><Td right>{s.orders}<span className="text-slate-400"> / {s.created}</span></Td><Td right>{qty(s.volume)}</Td><Td right>{s.customers}</Td><Td right>{moneyShort(s.avgCheck)}</Td><Td right className={s.conversion < d.medianConv ? "text-red-600" : ""}>{pct(s.conversion)}</Td><Td right className={s.cancelRate > 10 ? "text-red-600" : ""}>{s.cancelled}</Td><Td right>{s.planPct === null ? <span className="text-slate-400">—</span> : <div className="min-w-16"><div className="text-xs">{pct(s.planPct)}</div><ProgressBar value={s.planPct} max={100} tone={s.planPct >= 100 ? "success" : s.planPct >= 70 ? "warning" : "danger"} /></div>}</Td><Td right className="font-semibold">{s.score}</Td></Tr>)}
            </tbody>
          </Table>
        </Panel>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Faollik xaritasi — sotuvchi × hafta kuni" info="Oxirgi 4 hafta, kiritilgan zayavka pozitsiyalari soni. Bo'sh kunlar — sotuvchi qaysi kunlarda ishlamaydi.">
            {d.heat.rows.length ? <Heatmap rows={d.heat.rows} cols={d.heat.cols} cells={d.heat.cells} formatValue={(v) => String(v)} tone="info" rowLabel="Sotuvchi" /> : <Note>Ma'lumot yo'q.</Note>}
          </Panel>
          <Panel title="Ertangi yetkazish rejasi" eyebrow="Route optimization analogi" info="Ertaga yetkaziladigan tasdiqlangan zayavkalar: hajm, kerakli reyslar soni (o'rtacha mikser sig'imi bo'yicha) va mavjud mikserlar." padded={false}>
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-center text-[13px]">
              <div className="p-3"><div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Zayavkalar</div><div className="text-xl font-bold tabular">{d.route.length}</div></div>
              <div className="p-3"><div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Hajm</div><div className="text-xl font-bold tabular">{qty(d.routeTotal)} m³</div></div>
              <div className="p-3"><div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Reys kerak</div><div className={cn("text-xl font-bold tabular", d.routeTrips > d.mixers * 4 ? "text-red-600" : "")}>{d.routeTrips}<span className="text-xs font-normal text-slate-400"> · {d.mixers} mikser</span></div></div>
            </div>
            {d.route.length ? <ul className="divide-y divide-slate-100">{d.route.map((o, i) => <li key={o.id} className="flex items-start gap-3 px-4 py-2 text-[13px]"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">{i + 1}</span><div className="min-w-0 flex-1"><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link> · {o.customer}<div className="truncate text-xs text-slate-500">{o.address}{o.pump ? " · nasos kerak" : ""}</div></div><div className="shrink-0 text-right"><div className="tabular">{qty(o.m3)} m³</div><div className="text-[11px] text-slate-400">{o.trips} reys{o.planned ? ` · ${qty(o.planned)} rejalashtirilgan` : ""}</div></div></li>)}</ul> : <div className="p-4"><Note>Ertaga yetkaziladigan tasdiqlangan zayavka yo'q.</Note></div>}
            {d.routeTrips > d.mixers * 4 && <div className="border-t border-slate-100 px-4 py-2.5 text-[13px] text-amber-800"><Route size={13} className="mr-1 inline" /> {d.routeTrips} reys {d.mixers} mikser bilan bitta kunga sig'maydi (har mikser ≈4 reys) — zayavkalarni bo'ling yoki qo'shimcha texnika jalb qiling.</div>}
          </Panel>
        </div>

        <Panel title="Haydovchilar scorecard" info="Reyslar, yetkazilgan m³, yetkazish ulushi va o'rtacha vaqt — Ishlab chiqarish bo'limi bilan bir xil ball." padded={false} action={<Link href="/bi-tahlil/ishlab-chiqarish" className="font-medium text-blue-600 hover:underline">Batafsil →</Link>}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>#</Th><Th>Haydovchi</Th><Th>Daraja</Th><Th right>Reyslar</Th><Th right>Yetkazildi</Th><Th right>m³</Th><Th right>Ulush</Th><Th right>O'rt. vaqt</Th><Th right>Kechikkan</Th><Th right>Ball</Th></tr></thead>
            <tbody>{d.drivers.length === 0 && <Empty text="Reys yo'q" icon={Truck} />}{d.drivers.map((x, i) => <Tr key={x.id}><Td className="text-slate-400">{i + 1}</Td><Td>{x.name}</Td><Td><Tag>{x.tier}</Tag></Td><Td right>{x.trips}</Td><Td right>{x.delivered}</Td><Td right>{qty(x.m3)}</Td><Td right>{pct(x.rate)}</Td><Td right>{x.avgMinutes ? `${fmtNum(x.avgMinutes, 0)} daq` : "—"}</Td><Td right className={x.late ? "text-red-600" : ""}>{x.late}</Td><Td right className="font-semibold">{x.score}</Td></Tr>)}</tbody>
          </Table>
        </Panel>

        <div className="flex flex-wrap gap-4"><Action href="/bi-tahlil/reja">Sotuvchilarga oylik reja kiriting — Reja nazorati</Action><Action href="/employees">Xodimlar ro'yxati</Action></div>
      </div>
    </BiPage>
  );
}
