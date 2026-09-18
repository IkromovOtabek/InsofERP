import Link from "next/link";
import { TrendingUp, Receipt, ClipboardList, Users, Wallet, Percent, Boxes } from "lucide-react";
import { salesTab } from "@/lib/bi/sales";
import { type Range, type Gran, autoGran } from "@/lib/bi/core";
import { money, moneyShort, fmtNum, qty, dateTime } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Select } from "@/components/ui";
import { BarChart, DonutChart, HBarList, LineChart } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, Pager, ExportLink, Chip, Tag, tabHref } from "../ui";
import { ROUTES } from "../ui";
import type { SP } from "../page";

export async function SalesTab({ range, sp }: { range: Range; sp: SP }) {
  const gran: Gran = sp.gran === "day" || sp.gran === "week" || sp.gran === "month" ? sp.gran : autoGran(range.days);
  const page = Math.max(1, Number(sp.page) || 1), size = [25, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 25;
  const d = await salesTab(range, gran, page, size, { customer: sp.customer, product: sp.product });
  const k = d.kpis;
  const labelEvery = Math.max(1, Math.ceil(d.dyn.length / 12));
  const href = (extra: Record<string, string>) => tabHref(range, "sales", { ...(sp.gran ? { gran: sp.gran } : {}), ...(sp.customer ? { customer: sp.customer } : {}), ...(sp.product ? { product: sp.product } : {}), ...extra });
  const up = d.prodMovers.filter((m) => m.diff > 0).slice(0, 5), down = [...d.prodMovers].reverse().filter((m) => m.diff < 0).slice(0, 5);
  const cUp = d.custMovers.filter((m) => m.diff > 0).slice(0, 5), cDown = [...d.custMovers].reverse().filter((m) => m.diff < 0).slice(0, 5);
  const top10 = d.productRows.slice(0, 10), bottom10 = [...d.productRows].reverse().slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Reja pulsi */}
      <div className="grid grid-cols-2 gap-3 rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card) md:grid-cols-5">
        <div className="col-span-2 md:col-span-1"><div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Reja pulsi</div><div className="text-xs text-slate-500">bugun · oy boshidan · oy oxirigacha temp</div></div>
        <div><div className="text-xs text-slate-500">Bugun</div><div className="text-lg font-semibold tabular">{moneyShort(d.pulse.today)}</div></div>
        <div><div className="text-xs text-slate-500">Oy boshidan ({d.pulse.daysPassed} kun)</div><div className="text-lg font-semibold tabular">{moneyShort(d.pulse.monthRevenue)}</div></div>
        <div><div className="text-xs text-slate-500">Kunlik o'rtacha</div><div className="text-lg font-semibold tabular">{moneyShort(d.pulse.perDay)}</div></div>
        <div><div className="text-xs text-slate-500">Oy oxiri prognoz</div><div className="text-lg font-semibold tabular text-blue-600">{moneyShort(d.pulse.forecast)}</div><div className="text-[11px] text-slate-400">{d.pulse.daysLeft} kun qoldi</div></div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        <Kpi label="Jami sotuv" value={moneyShort(k.revenue.cur)} delta={k.revenue.delta} icon={TrendingUp} tone="brand" hint={money(k.revenue.cur)} />
        <Kpi label="Hajm" value={`${qty(k.volume.cur)} m³`} delta={k.volume.delta} icon={Boxes} tone="info" />
        <Kpi label="O'rtacha chek" value={moneyShort(k.avgCheck.cur)} delta={k.avgCheck.delta} icon={Receipt} />
        <Kpi label="Zayavkalar" value={String(k.orders.cur)} delta={k.orders.delta} icon={ClipboardList} tone="info" />
        <Kpi label="Faol mijozlar" value={String(k.customers.cur)} delta={k.customers.delta} icon={Users} tone="violet" />
        <Kpi label="Yalpi foyda" value={moneyShort(k.gross.cur)} delta={k.gross.delta} icon={Wallet} tone={k.gross.cur >= 0 ? "success" : "danger"} />
        <Kpi label="Marja" value={`${fmtNum(k.margin.cur, 1)}%`} delta={k.margin.cur - k.margin.prev} deltaLabel="p.p." icon={Percent} tone={k.margin.cur >= 20 ? "success" : k.margin.cur >= 10 ? "warning" : "danger"} />
      </div>

      <Panel title="Sotuv dinamikasi" info="Ustunlar — joriy davr, och kulrang — oldingi davr (bir xil uzunlikdagi). Ustun ustiga kursor olib boring." action={<div className="flex gap-1">{(["day", "week", "month"] as const).map((g) => <Chip key={g} active={gran === g} href={href({ gran: g })}>{{ day: "Kunlik", week: "Haftalik", month: "Oylik" }[g]}</Chip>)}</div>}>
        {d.dyn.some((x) => x.value > 0) ? <BarChart data={d.dyn.map((x) => ({ label: x.label, value: x.value }))} compare={d.dynPrev.map((x) => x.value)} formatValue={(v) => `${moneyShort(v)} so'm`} labelEvery={labelEvery} height={200} /> : <Note>Bu davrda sotuv yo'q.</Note>}
        <div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-1 text-xs font-medium text-slate-500">Hajm, m³</div><BarChart data={d.dynVol.map((x) => ({ label: x.label, value: x.value }))} tone="info" formatValue={(v) => `${qty(v)} m³`} labelEvery={labelEvery} height={90} /></div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Marka bo'yicha sotuv" info="Tushum ulushi — beton markasi (mahsulot) kesimida.">
          {d.productRows.length ? <DonutChart data={d.productRows.slice(0, 8).map((p) => ({ label: p.code, value: p.revenue }))} formatValue={(v) => moneyShort(v)} center={{ value: String(d.productRows.length), label: "marka" }} /> : <Note>Ma'lumot yo'q.</Note>}
        </Panel>
        <Panel title="Top mijozlar" info="Davr ichidagi tushum bo'yicha." action={<Link href={tabHref(range, "customers")} className="font-medium text-blue-600 hover:underline">Barchasini ko'rish →</Link>}>
          {d.byCustomer.length ? <HBarList data={d.byCustomer.slice(0, 8).map((c) => ({ label: c.name, value: c.revenue, hint: `${c.orders} zayavka`, sub: `${qty(c.qty)} m³` }))} formatValue={(v) => moneyShort(v)} /> : <Note>Ma'lumot yo'q.</Note>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Sotuv intensivligi" info="Hafta kunlari bo'yicha tushum — qaysi kunlar kuchli, qaysi kunlar bo'sh.">
          <BarChart data={d.weekday} tone="violet" formatValue={(v) => moneyShort(v)} height={140} />
          <Why>Eng kuchli kun: <b>{[...d.weekday].sort((a, b) => b.value - a.value)[0]?.label}</b>. Bo'sh kunlarga aksiya yoki yetkazish jadvalini surish orqali quvvatni tekislash mumkin.</Why>
        </Panel>
        <Panel className="xl:col-span-2" title="ABC tahlili — Top 10 ▼ / Bottom 10 ▲" info="A — kumulyativ tushumning 80%i, B — 95% gacha, C — qolganlar." padded={false}>
          <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
            {[["Top 10", top10], ["Bottom 10", bottom10]].map(([title, rows]) => (
              <div key={title as string} className="overflow-x-auto">
                <div className="px-4 pt-3 text-xs font-semibold text-slate-500">{title as string}</div>
                <table className="w-full text-[13px]">
                  <thead><tr><Th>#</Th><Th>Marka</Th><Th>ABC</Th><Th right>Sotuv</Th><Th right>Foyda</Th><Th right>Ulush</Th></tr></thead>
                  <tbody>{(rows as typeof top10).map((p, i) => <Tr key={p.id}><Td className="text-slate-400">{i + 1}</Td><Td>{p.code}</Td><Td><Tag>{p.abc}</Tag></Td><Td right>{moneyShort(p.revenue)}</Td><Td right className={p.gross < 0 ? "text-red-600" : ""}>{moneyShort(p.gross)}</Td><Td right>{fmtNum(p.share, 1)}%</Td></Tr>)}</tbody>
                </table>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Pareto tahlili (80/20)" info="Kumulyativ tushum ulushi — nechta marka 80% tushumni beradi.">
        {d.pareto.length ? <>
          <LineChart labels={d.pareto.map((p) => p.label)} series={[{ name: "Kumulyativ ulush, %", values: d.pareto.map((p) => p.value), color: "#f59e0b" }]} formatValue={(v) => `${fmtNum(v, 0)}%`} height={160} />
          <Insight>{d.paretoCount} ta marka ({fmtNum((d.paretoCount / d.pareto.length) * 100, 0)}% assortiment) tushumning 80%ini beradi. {d.pareto.length - d.paretoCount} ta marka qolgan 20% uchun — ularni assortimentda saqlash tannarxini tekshiring.</Insight>
        </> : <Note>Ma'lumot yo'q.</Note>}
      </Panel>

      {/* Sabab va imkoniyat */}
      <div>
        <div className="mb-3"><div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Sabab va imkoniyat</div><div className="text-sm text-slate-500">grafiklardan keyingi xulosa — oldingi davr ({range.prevLabel}) bilan taqqoslab</div></div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Nima o'sdi, nima pasaydi — markalar" info="Joriy davr vs oldingi davr, tushum farqi bo'yicha.">
            <div className="grid grid-cols-2 gap-4 text-[13px]">
              <div><div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Top 5 o'sgan</div>{up.length ? up.map((m) => <div key={m.id} className="flex justify-between border-b border-slate-50 py-1"><span>{m.name}</span><span className="tabular text-emerald-600">+{moneyShort(m.diff)}</span></div>) : <Note>—</Note>}</div>
              <div><div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-600">Top 5 pasaygan</div>{down.length ? down.map((m) => <div key={m.id} className="flex justify-between border-b border-slate-50 py-1"><span>{m.name}</span><span className="tabular text-red-600">−{moneyShort(Math.abs(m.diff))}</span></div>) : <Note>—</Note>}</div>
            </div>
            <Why>{up[0] && <p>Eng katta o'sish — <b>{up[0].name}</b>: {moneyShort(up[0].prev)} → {moneyShort(up[0].cur)}.</p>}{down[0] && <p>Eng katta pasayish — <b>{down[0].name}</b>: {moneyShort(down[0].prev)} → {moneyShort(down[0].cur)}. Sabab: talab, narx yoki xomashyo yetishmasligi — Ombor va Mijozlar bo'limlarini tekshiring.</p>}</Why>
          </Panel>
          <Panel title="Nima o'sdi, nima pasaydi — mijozlar" info="Joriy davr vs oldingi davr, mijoz kesimida.">
            <div className="grid grid-cols-2 gap-4 text-[13px]">
              <div><div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Top 5 o'sgan</div>{cUp.length ? cUp.map((m) => <div key={m.id} className="flex justify-between gap-2 border-b border-slate-50 py-1"><span className="truncate">{m.name}</span><span className="shrink-0 tabular text-emerald-600">+{moneyShort(m.diff)}</span></div>) : <Note>—</Note>}</div>
              <div><div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-600">Top 5 pasaygan</div>{cDown.length ? cDown.map((m) => <div key={m.id} className="flex justify-between gap-2 border-b border-slate-50 py-1"><span className="truncate">{m.name}</span><span className="shrink-0 tabular text-red-600">−{moneyShort(Math.abs(m.diff))}</span></div>) : <Note>—</Note>}</div>
            </div>
            {cDown[0] && <div className="mt-3"><Action href={tabHref(range, "customers", { q: cDown[0].name })}>{cDown[0].name} bilan bog'laning — {moneyShort(Math.abs(cDown[0].diff))} so'm kamaygan</Action></div>}
          </Panel>
          <Panel title="Lost Revenue — yo'qotilgan tushum" info="Bloklangan (kredit limit) va bekor qilingan zayavkalar summasi.">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-red-50 p-3"><div className="text-xs text-red-700">Bloklangan (hozir)</div><div className="text-xl font-bold tabular text-red-700">{moneyShort(d.lost.blocked)}</div><div className="text-xs text-red-600">{d.lost.blockedOrders} ta zayavka</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Bekor qilingan (davr)</div><div className="text-xl font-bold tabular text-slate-800">{moneyShort(d.lost.cancelled)}</div><div className="text-xs text-slate-500">{d.lost.cancelledOrders} ta zayavka</div></div>
            </div>
            {d.lost.blockedRows.length > 0 && <ul className="mt-3 space-y-1 text-[13px]">{d.lost.blockedRows.map((o) => <li key={o.orderId} className="flex justify-between gap-2"><Link href={`/orders/${o.orderId}`} className="truncate hover:underline">{o.orderNo} · {o.customer}</Link><span className="shrink-0 tabular">{moneyShort(o.revenue)}</span></li>)}</ul>}
            <div className="mt-3"><Action href="/orders?status=BLOCKED">Bloklangan zayavkalarni ko'rib chiqing — direktor limitni ochsin yoki mijoz oldindan to'lasin</Action></div>
          </Panel>
          <Panel title="Sales Opportunity — qaysi markani sotish foydali" info="Marja × tushum bo'yicha eng foydali markalar. Chegirma — bazaviy narxdan past sotilgan summa.">
            {d.opportunity.length ? <HBarList data={d.opportunity.map((p) => ({ label: `${p.code} — ${p.name}`, value: p.margin, hint: `marja · ${moneyShort(p.revenue)} sotuv`, tone: "success" as const }))} formatValue={(v) => `${fmtNum(v, 1)}%`} max={100} /> : <Note>Retsept tannarxi kiritilmagan — marja hisoblanmaydi.</Note>}
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">Chegirma: <b>{moneyShort(d.discount)} so'm</b> ({d.discountCount} ta pozitsiya bazaviy narxdan past). O'lchanmagan chegirma — nazorat qilinmaydigan foyda teshigi.</div>
          </Panel>
        </div>
      </div>

      {/* Qaror simulyatori */}
      <Panel title="Qaror simulyatori — narx · hajm" info="Oddiy stsenariy: narxni o'zgartirsangiz va hajm shunga mos o'zgarsa tushum va foyda qanday bo'ladi (elastiklik −1 deb olingan).">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 text-[13px]">
          {[-10, -5, 5, 10].map((p) => { const vol = k.volume.cur * (1 - p / 100), rev = k.revenue.cur * (1 + p / 100) * (1 - p / 100), cost = (k.revenue.cur - k.gross.cur) * (1 - p / 100), gross = rev - cost; return (
            <div key={p} className="rounded-lg border border-slate-200 p-3"><div className="font-semibold">{p > 0 ? "+" : ""}{p}% narx</div><div className="text-xs text-slate-500">hajm {p > 0 ? "−" : "+"}{Math.abs(p)}% → {qty(vol)} m³</div><div className="mt-1.5 flex justify-between"><span className="text-slate-500">Tushum</span><span className="tabular">{moneyShort(rev)}</span></div><div className="flex justify-between"><span className="text-slate-500">Yalpi foyda</span><span className={gross >= k.gross.cur ? "tabular text-emerald-600" : "tabular text-red-600"}>{moneyShort(gross)}</span></div></div>
          ); })}
        </div>
      </Panel>

      {/* Batafsil tranzaksiyalar */}
      <Panel title="Batafsil tranzaksiyalar" info="Zayavka pozitsiyalari — davr bo'yicha. Filtrlash va eksport." padded={false} action={<ExportLink type="sales" range={range} />}>
        <form method="get" action={ROUTES.sales} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-[13px]">
          {range.period === "custom" ? <><input type="hidden" name="from" value={range.from.toISOString().slice(0, 10)} /><input type="hidden" name="to" value={new Date(range.to.getTime() - 1).toISOString().slice(0, 10)} /></> : <input type="hidden" name="period" value={range.period} />}{sp.gran && <input type="hidden" name="gran" value={sp.gran} />}
          <Select name="customer" defaultValue={sp.customer ?? ""} className="h-8 w-56"><option value="">Barcha mijozlar</option>{d.customerOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select name="product" defaultValue={sp.product ?? ""} className="h-8 w-40"><option value="">Barcha markalar</option>{d.productOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select name="size" defaultValue={String(size)} className="h-8 w-20"><option value="25">25</option><option value="50">50</option><option value="100">100</option></Select>
          <button className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white">Qo'llash</button>
          {(sp.customer || sp.product) && <Link href={tabHref(range, "sales")} className="text-xs text-slate-500 hover:underline">Tozalash</Link>}
        </form>
        <Table className="rounded-none border-0 shadow-none">
          <thead><tr><Th>Sana</Th><Th>Zayavka</Th><Th>Mijoz</Th><Th>Marka</Th><Th right>Miqdor</Th><Th right>Narx</Th><Th right>Summa</Th><Th right>Foyda</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {d.detail.rows.length === 0 && <Empty text="Tranzaksiya topilmadi" />}
            {d.detail.rows.map((x, i) => <Tr key={`${x.orderId}-${x.productId}-${i}`}><Td className="whitespace-nowrap text-slate-500">{dateTime(x.date)}</Td><Td><Link href={`/orders/${x.orderId}`} className="hover:underline">{x.orderNo}</Link></Td><Td>{x.customer}</Td><Td>{x.code}</Td><Td right>{qty(x.qty)} {x.unit}</Td><Td right className={x.price < x.basePrice ? "text-amber-600" : ""}>{moneyShort(x.price)}</Td><Td right className="font-medium">{money(x.revenue)}</Td><Td right className={x.revenue - x.cost < 0 ? "text-red-600" : "text-emerald-700"}>{x.cost ? moneyShort(x.revenue - x.cost) : "—"}</Td><Td><Tag>{x.status}</Tag></Td></Tr>)}
          </tbody>
        </Table>
        <Pager total={d.detail.total} page={d.detail.page} size={d.detail.size} href={(p) => href({ page: String(p), size: String(size) })} />
      </Panel>
    </div>
  );
}
