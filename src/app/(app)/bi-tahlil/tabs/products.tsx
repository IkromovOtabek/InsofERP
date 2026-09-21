import Link from "next/link";
import { Package, Award, Percent, FlaskConical, Snowflake, TrendingUp } from "lucide-react";
import { productsTab } from "@/lib/bi/products";
import type { Range } from "@/lib/bi/core";
import { money, moneyShort, fmtNum, qty } from "@/lib/format";
import { Table, Th, Td, Tr, Empty } from "@/components/ui";
import { Heatmap, LineChart, Scatter } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, Tag, tabHref } from "../ui";
import { cn } from "@/lib/utils";

export async function ProductsTab({ range }: { range: Range }) {
  const d = await productsTab(range);
  const c = d.cards;
  const Q_COLOR: Record<string, string> = { Yulduzlar: "bg-amber-100 text-amber-800", "Barqaror daromad": "bg-blue-100 text-blue-800", Ixtisoslashgan: "bg-emerald-100 text-emerald-800", "Kam samarali": "bg-red-100 text-red-800" };
  const monthRows = d.rows.filter((x) => x.monthly.some((v) => v > 0)).slice(0, 12);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Jami SKU" value={String(c.sku)} icon={Package} hint="faol markalar" />
        <Kpi label="AX-sinf" value={String(c.aaa)} icon={Award} tone="brand" hint="yuqori tushum + barqaror talab" />
        <Kpi label="O'rt. marja" value={`${fmtNum(c.avgMargin, 1)}%`} icon={Percent} tone={c.avgMargin >= 20 ? "success" : c.avgMargin >= 10 ? "warning" : "danger"} hint={`${c.lowMargin} ta marka <10%`} />
        <Kpi label="Retseptsiz" value={String(c.noRecipe)} icon={FlaskConical} tone={c.noRecipe ? "warning" : "default"} hint="tannarx hisoblanmaydi" href="/recipes" />
        <Kpi label="Muzlagan mablag'" value={moneyShort(c.frozen)} icon={Snowflake} tone={c.frozen ? "info" : "default"} hint="tayyor mahsulot (dona) qoldig'i" href="/stock?tab=capacity" />
        <Kpi label="O'sish trendida" value={String(c.growing)} icon={TrendingUp} tone="success" hint="oxirgi 3 oy vs oldingi 3 oy" />
      </div>

      <Panel title="ABC × XYZ matritsa" info="ABC — tushum ulushi (A: 80%, B: 95%, C: qolgan). XYZ — oylik talab beqarorligi (X: CV≤0.5 barqaror, Y: ≤1, Z: beqaror, N: ma'lumot yetarli emas). Yuqori chap (AX) — barqaror va qimmatli; pastki o'ng (CZ) — beqaror va kam qiymat.">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-xs">
            <thead><tr><th /><th className="py-1 text-center font-medium text-slate-500">X · barqaror</th><th className="py-1 text-center font-medium text-slate-500">Y · o'zgaruvchan</th><th className="py-1 text-center font-medium text-slate-500">Z · beqaror</th><th className="py-1 text-center font-medium text-slate-500">N · ma'lumot kam</th></tr></thead>
            <tbody>
              {(["A", "B", "C"] as const).map((a, i) => (
                <tr key={a}><td className="pr-2 text-right font-semibold text-slate-600">{a}</td>{d.matrix[i].map((cell, j) => {
                  const strong = i === 0 && j === 0, weak = i === 2 && j >= 2;
                  return <td key={j} className={cn("min-h-12 rounded-md p-2 align-top", strong ? "bg-emerald-50 ring-1 ring-emerald-200" : weak ? "bg-red-50 ring-1 ring-red-200" : "bg-slate-50")}>{cell.length ? cell.map((p) => <span key={p.id} title={`${p.name} · ${moneyShort(p.revenue)} so'm`} className="mr-1 inline-block rounded bg-white px-1.5 py-0.5 font-medium text-slate-700 ring-1 ring-slate-200">{p.code}</span>) : <span className="text-slate-300">—</span>}</td>;
                })}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex gap-4 text-[11px] text-slate-500"><span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-200" />Barqaror + qimmatli</span><span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-200" />Beqaror + kam qiymat</span></div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Foydalilik tahlili" info="Pufak o'lchami — sotilgan miqdor. Uzuq chiziqlar — median daromad va median marja; kvadrantlar shu yerdan bo'linadi.">
          {d.scatter.length ? <Scatter points={d.scatter} xLabel="Tushum" yLabel="Marja, %" formatX={moneyShort} formatY={(v) => `${fmtNum(v, 1)}%`} xMedian={d.medRev} yMedian={d.medMargin} quadrants={["Yulduzlar", "Ixtisoslashgan", "Kam samarali", "Barqaror daromad"]} /> : <Note>Bu davrda sotuv yo'q.</Note>}
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">{Object.entries(Q_COLOR).map(([k, v]) => <span key={k} className={cn("rounded-full px-2 py-0.5 font-medium", v)}>{k}: {d.rows.filter((x) => x.quadrant === k).length}</span>)}</div>
        </Panel>
        <Panel title="Pareto tahlili 80/20" info="Kumulyativ tushum ulushi.">
          {d.pareto.length ? <><LineChart labels={d.pareto.map((p) => p.label)} series={[{ name: "Kumulyativ ulush, %", values: d.pareto.map((p) => p.value) }]} formatValue={(v) => `${fmtNum(v, 0)}%`} height={170} /><Insight>{d.paretoCount} ta marka tushumning 80%ini beradi. Qolgan {d.pareto.length - d.paretoCount} ta — assortimentni murakkablashtiradi, lekin tushumga kam hissa qo'shadi.</Insight></> : <Note>Ma'lumot yo'q.</Note>}
        </Panel>
      </div>

      <Panel title="Mahsulot klasterlari — strategiya" info="Tezlik (ABC) × o'sish trendi × barqarorlik (XYZ) bo'yicha qoida asosida guruhlangan. Kartada — nima qilish kerak.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {d.clusters.map((cl) => (
            <div key={cl.key} className="rounded-lg border border-slate-200 p-4" style={{ borderTopColor: cl.color, borderTopWidth: 3 }}>
              <div className="flex items-baseline justify-between"><div className="font-semibold">{cl.title}</div><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{cl.sub}</div></div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs"><div><div className="text-slate-400">Mahsulot</div><div className="font-semibold tabular">{cl.count}</div></div><div><div className="text-slate-400">Daromad</div><div className="font-semibold tabular">{moneyShort(cl.revenue)} <span className="font-normal text-slate-400">{fmtNum(cl.share, 0)}%</span></div></div><div><div className="text-slate-400">Marja</div><div className="font-semibold tabular">{fmtNum(cl.margin, 1)}%</div></div></div>
              <div className="mt-2 text-xs text-slate-500">{cl.products.join(", ")}</div>
              <div className="mt-2.5"><Action>{cl.advice}</Action></div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Mahsulot × oy — hajm" info="Oxirgi 6 oy, sotilgan miqdor (m³ yoki dona). Rang — hajm.">
        {monthRows.length ? <Heatmap rows={monthRows.map((x) => x.code)} cols={d.monthLabels} cells={monthRows.map((x) => x.monthly)} formatValue={(v) => fmtNum(v, 0)} tone="info" rowLabel="Marka" /> : <Note>Ma'lumot yo'q.</Note>}
      </Panel>

      <Panel title="Mahsulotlar ro'yxati" info="Tannarx — faol retsept × xomashyo o'rtacha kirim narxi. CM/birlik — o'rtacha sotuv narxi − tannarx." padded={false}>
        <Table className="rounded-none border-0 shadow-none">
          <thead><tr><Th>Marka</Th><Th>Klaster</Th><Th>ABC</Th><Th>XYZ</Th><Th right>Sotuv</Th><Th right>Hajm</Th><Th right>Ulush</Th><Th right>Narx</Th><Th right>Tannarx</Th><Th right>CM/birlik</Th><Th right>Marja</Th><Th right>Trend</Th></tr></thead>
          <tbody>
            {d.rows.length === 0 && <Empty text="Mahsulot yo'q" />}
            {d.rows.map((p) => (
              <Tr key={p.id}>
                <Td><span className="font-semibold">{p.code}</span> <span className="text-xs text-slate-500">{p.name}</span>{!p.isActive && <span className="ml-1 text-[10px] text-slate-400">nofaol</span>}</Td>
                <Td className="text-xs">{p.cluster}</Td><Td><Tag>{p.abc}</Tag></Td><Td><Tag>{p.xyz}</Tag></Td>
                <Td right>{moneyShort(p.revenue)}</Td><Td right>{qty(p.qty)} {p.unit}</Td><Td right>{fmtNum(p.share, 1)}%</Td>
                <Td right>{moneyShort(p.price)}</Td><Td right>{p.cost === null ? <Link href="/recipes" className="text-amber-600 hover:underline">retsept yo'q</Link> : moneyShort(p.cost)}</Td>
                <Td right className={p.cmUnit !== null && p.cmUnit < 0 ? "text-red-600" : ""}>{p.cmUnit === null ? "—" : moneyShort(p.cmUnit)}</Td>
                <Td right className={p.revenue > 0 ? (p.margin < 10 ? "text-red-600" : p.margin < 20 ? "text-amber-600" : "text-emerald-700") : "text-slate-400"}>{p.revenue > 0 ? `${fmtNum(p.margin, 1)}%` : "—"}</Td>
                <Td right className={p.trend > 10 ? "text-emerald-600" : p.trend < -10 ? "text-red-600" : "text-slate-500"}>{p.trend > 10 ? "▲" : p.trend < -10 ? "▼" : "▬"} {fmtNum(Math.abs(p.trend), 0)}%</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Jami tushum: <b className="text-slate-800">{money(d.totalRevenue)}</b> · davr: {range.label}</div>
      </Panel>
      <Why label="Klaster taqsimoti qanday o'qiladi?">
        <p>Mahsulot ulushi va daromad ulushi yonma-yon — farq qancha katta bo'lsa, disbalans shuncha kuchli. Masalan, Cash Cows {d.clusters.find((x) => x.key === "Cash Cows")?.count ?? 0} ta marka bilan tushumning {fmtNum(d.clusters.find((x) => x.key === "Cash Cows")?.share ?? 0, 0)}%ini beradi.</p>
        <p>Dogs guruhini chiqarishdan oldin tekshiring: ba'zi markalar «yo'lakay» — asosiy marka bilan birga buyurtma qilinadi.</p>
      </Why>
      <div><Action href={tabHref(range, "stock")}>Xomashyo zaxirasi va buyurtma navbatini ko'rish</Action></div>
    </div>
  );
}
