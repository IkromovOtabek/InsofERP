import Link from "next/link";
import { Layers, Star, PiggyBank, TrendingUp, Gem, CircleOff, Package } from "lucide-react";
import { biContext, BiPage } from "../../shell";
import { productsTab } from "@/lib/bi/products";
import { sum, safeDiv } from "@/lib/bi/core";
import { money, moneyShort, fmtNum, qty } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Input } from "@/components/ui";
import { Scatter, HBarList } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, Tag, Chip } from "../../ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
const ICON: Record<string, typeof Star> = { Stars: Star, "Cash Cows": PiggyBank, Rising: TrendingUp, Niche: Gem, Dogs: CircleOff, Sotilmagan: Package };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  const d = await productsTab(range);
  const href = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ cluster: sp.cluster, abc: sp.abc, q: sp.q, ...extra })) if (v) p.set(k, v); return `/bi-tahlil/ml/klasterlar?${p ? p : ""}`; };
  const sold = d.rows.filter((x) => x.revenue > 0);
  const total = sum(sold.map((x) => x.revenue)), gross = sum(sold.map((x) => x.gross));
  const cl = d.clusters.filter((c) => c.count > 0);
  const eff = (c: typeof cl[number]) => (c.count ? safeDiv(c.share, (c.count / Math.max(1, sold.length)) * 100) * 100 : 0);
  const most = [...cl].filter((c) => c.key !== "Sotilmagan").sort((a, b) => b.revenue - a.revenue)[0];
  const fastest = [...cl].filter((c) => c.key !== "Sotilmagan").sort((a, b) => eff(b) - eff(a))[0];
  const scatter = sold.map((x) => ({ x: x.revenue, y: x.trend, r: Math.max(2, Math.min(14, x.qty / 20)), label: `${x.code} — ${x.cluster}`, color: d.clusters.find((c) => c.key === x.cluster)?.color ?? "#93a3bd" }));
  // Klaster × birlik (m3 / dona) — kategoriya analogi
  const units = [...new Set(d.rows.map((x) => x.unit))];
  const matrix = cl.map((c) => ({ key: c.key, cells: units.map((u) => sum(d.rows.filter((x) => x.cluster === c.key && x.unit === u).map((x) => x.revenue))) }));
  let list = d.rows.filter((x) => x.revenue > 0 || sp.cluster === "Sotilmagan");
  if (sp.cluster) list = list.filter((x) => x.cluster === sp.cluster);
  if (sp.abc) list = list.filter((x) => x.abc === sp.abc);
  if (sp.q) { const q = sp.q.toLowerCase(); list = list.filter((x) => `${x.code} ${x.name}`.toLowerCase().includes(q)); }

  return (
    <BiPage title="Klasterlar" subtitle="Mahsulotlar tezlik × o'sish × barqarorlik bo'yicha 5 klasterga bo'lingan (qoida asosida: ABC, trend, XYZ). Har klaster — o'z strategiyasi." eyebrow="ML tahlil" tab="clusters" range={range}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Klasterlar" value={String(cl.filter((c) => c.key !== "Sotilmagan").length)} icon={Layers} tone="brand" hint={`${sold.length} mahsulot guruhlangan`} />
          <Kpi label="Eng qimmatli klaster" value={most?.title ?? "—"} icon={Star} tone="success" hint={most ? `${moneyShort(most.revenue)} so'm · portfelning ${fmtNum(most.share, 1)}%i` : "—"} />
          <Kpi label="Eng samarali" value={fastest?.title ?? "—"} icon={TrendingUp} tone="info" hint={fastest ? `samaradorlik indeksi ${fmtNum(eff(fastest), 0)} · ${fastest.count} mahsulot → ${fmtNum(fastest.share, 1)}% daromad` : "—"} />
          <Kpi label="Portfel jami" value={moneyShort(total)} icon={Package} hint={`yalpi foyda ${moneyShort(gross)} · marja ${fmtNum(safeDiv(gross, total) * 100, 1)}%`} />
        </div>

        <Panel title="Klaster strategiyalari" info="Kartani bosing — sahifa shu klaster bo'yicha filtrlanadi. Samaradorlik indeksi = daromad ulushi / mahsulot ulushi × 100 (100 = o'z og'irligicha).">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cl.map((c) => { const I = ICON[c.key] ?? Package; const list = d.rows.filter((x) => x.cluster === c.key); const margin = safeDiv(sum(list.map((x) => x.gross)), sum(list.map((x) => x.revenue))) * 100; return (
              <Link key={c.key} href={href({ cluster: sp.cluster === c.key ? undefined : c.key })} className={cn("rounded-lg border border-slate-200 p-4 transition hover:border-slate-300", sp.cluster === c.key && "ring-2 ring-slate-900")} style={{ borderTopColor: c.color, borderTopWidth: 3 }}>
                <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 font-semibold"><I size={15} style={{ color: c.color }} /> {c.title}</div><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{c.sub}</div></div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-xs"><div><div className="text-slate-400">Mahsulot</div><div className="font-semibold tabular">{c.count} <span className="font-normal text-slate-400">{fmtNum((c.count / Math.max(1, d.rows.length)) * 100, 0)}%</span></div></div><div><div className="text-slate-400">Daromad</div><div className="font-semibold tabular">{moneyShort(c.revenue)} <span className="font-normal text-slate-400">{fmtNum(c.share, 0)}%</span></div></div><div><div className="text-slate-400">Marja</div><div className="font-semibold tabular">{fmtNum(margin, 1)}%</div></div><div><div className="text-slate-400">Samaradorlik</div><div className="font-semibold tabular">{fmtNum(eff(c), 0)}</div></div></div>
                <div className="mt-2.5 text-[13px] text-slate-700"><span className="font-medium">{c.advice}</span></div>
                <div className="mt-1.5 truncate text-xs text-slate-400">{c.products.join(", ")}</div>
              </Link>); })}
          </div>
        </Panel>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-slate-500">Klaster:</span>{cl.map((c) => <Chip key={c.key} active={sp.cluster === c.key} href={href({ cluster: sp.cluster === c.key ? undefined : c.key })}>{c.title}</Chip>)}
          <span className="ml-2 font-medium text-slate-500">ABC:</span>{["A", "B", "C"].map((a) => <Chip key={a} active={sp.abc === a} href={href({ abc: sp.abc === a ? undefined : a })}>{a}</Chip>)}
          <form method="get" action="/bi-tahlil/ml/klasterlar" className="ml-2 flex items-center gap-1">{sp.cluster && <input type="hidden" name="cluster" value={sp.cluster} />}{sp.abc && <input type="hidden" name="abc" value={sp.abc} />}<Input name="q" defaultValue={sp.q ?? ""} placeholder="Mahsulot qidirish" className="h-7 w-40 text-xs" /><button className="h-7 rounded-md bg-slate-900 px-2 text-white">OK</button></form>
          {(sp.cluster || sp.abc || sp.q) && <Link href="/bi-tahlil/ml/klasterlar" className="text-slate-500 hover:underline">Tozalash</Link>}
          <span className="ml-auto text-slate-500">{list.length} mahsulot · {money(sum(list.map((x) => x.revenue)))}</span>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Mahsulot klaster xaritasi" info="X — tushum (tezlik), Y — o'sish trendi (oxirgi 3 oy vs oldingi 3 oy, %). Nuqta o'lchami — sotilgan hajm. Rang — klaster.">
            {scatter.length ? <Scatter points={scatter} xLabel="Tushum" yLabel="O'sish trendi, %" formatX={moneyShort} formatY={(v) => `${fmtNum(v, 0)}%`} height={260} xMedian={d.medRev} yMedian={10} /> : <Note>Ma'lumot yo'q.</Note>}
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">{cl.map((c) => <span key={c.key} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.title}</span>)}</div>
          </Panel>
          <Panel title="Klaster profillari" info="Har klaster uchun mediana ko'rsatkichlar: tushum, marja, trend, talab barqarorligi (X — barqaror, Z — beqaror).">
            <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr><Th>Klaster</Th><Th right>Mahsulot</Th><Th right>Tushum (med.)</Th><Th right>Marja (med.)</Th><Th right>Trend (med.)</Th><Th>XYZ taqsimoti</Th></tr></thead><tbody>{cl.map((c) => { const l = d.rows.filter((x) => x.cluster === c.key); const med = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; }; return <Tr key={c.key}><Td><span className="inline-flex items-center gap-1.5 font-medium"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.title}</span></Td><Td right>{l.length}</Td><Td right>{moneyShort(med(l.map((x) => x.revenue)))}</Td><Td right>{fmtNum(med(l.map((x) => x.margin)), 1)}%</Td><Td right className={med(l.map((x) => x.trend)) > 10 ? "text-emerald-600" : med(l.map((x) => x.trend)) < -10 ? "text-red-600" : ""}>{fmtNum(med(l.map((x) => x.trend)), 0)}%</Td><Td className="text-xs">{["X", "Y", "Z", "N"].map((z) => `${z}:${l.filter((x) => x.xyz === z).length}`).join(" ")}</Td></Tr>; })}</tbody></table></div>
            <div className="mt-4"><div className="mb-1.5 text-xs font-medium text-slate-500">Klaster × birlik (tushum)</div><table className="w-full text-xs"><thead><tr><Th>Klaster</Th>{units.map((u) => <Th key={u} right>{u === "m3" ? "m³ (beton)" : u}</Th>)}</tr></thead><tbody>{matrix.map((m) => <Tr key={m.key}><Td>{m.key}</Td>{m.cells.map((v, i) => <Td key={i} right className={v ? "" : "text-slate-300"}>{v ? moneyShort(v) : "·"}</Td>)}</Tr>)}</tbody></table></div>
          </Panel>
        </div>

        <Panel title="Klaster taqsimoti" info="Mahsulot ulushi va daromad ulushi yonma-yon — farq qancha katta bo'lsa, disbalans shuncha kuchli.">
          <HBarList data={cl.map((c) => ({ label: `${c.title} · ${c.count} ta (${fmtNum((c.count / Math.max(1, d.rows.length)) * 100, 0)}% mahsulot)`, value: c.share, hint: `${moneyShort(c.revenue)} so'm`, tone: c.key === "Dogs" ? ("danger" as const) : c.key === "Stars" ? ("success" as const) : ("info" as const) }))} formatValue={(v) => `${fmtNum(v, 1)}% daromad`} max={100} />
        </Panel>

        <Panel title="Mahsulotlar va klasterlar" padded={false}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Marka</Th><Th>Klaster</Th><Th>ABC</Th><Th>XYZ</Th><Th right>Tushum</Th><Th right>Hajm</Th><Th right>Marja</Th><Th right>Trend</Th><Th>Strategiya</Th></tr></thead>
            <tbody>{list.length === 0 && <Empty text="Mahsulot topilmadi" />}{list.map((x) => { const c = d.clusters.find((k) => k.key === x.cluster); return <Tr key={x.id}><Td><span className="font-semibold">{x.code}</span> <span className="text-xs text-slate-500">{x.name}</span></Td><Td><span className="inline-flex items-center gap-1.5 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: c?.color }} />{x.cluster}</span></Td><Td><Tag>{x.abc}</Tag></Td><Td><Tag>{x.xyz}</Tag></Td><Td right className="font-medium">{moneyShort(x.revenue)}</Td><Td right>{qty(x.qty)} {x.unit}</Td><Td right className={x.margin < 10 ? "text-red-600" : x.margin >= 20 ? "text-emerald-700" : ""}>{x.revenue ? `${fmtNum(x.margin, 1)}%` : "—"}</Td><Td right className={x.trend > 10 ? "text-emerald-600" : x.trend < -10 ? "text-red-600" : "text-slate-500"}>{x.trend > 10 ? "▲" : x.trend < -10 ? "▼" : "▬"} {fmtNum(Math.abs(x.trend), 0)}%</Td><Td className="max-w-64 truncate text-xs text-slate-500">{c?.advice}</Td></Tr>; })}</tbody>
          </Table>
        </Panel>
        <Why label="Klasterlar qanday aniqlanadi?"><p><b>Stars</b> — A-sinf va trend &gt;10%. <b>Cash Cows</b> — A-sinf, barqaror. <b>Rising</b> — B/C sinf, lekin trend &gt;10%. <b>Niche</b> — kichik, lekin barqaror talab (X/Y). <b>Dogs</b> — kichik va beqaror (Z/N).</p><p>Team24 dagi K-Means o'rniga qoida — chunki beton zavodida markalar soni kichik va har biri tushunarli. Natija bir xil o'qiladi: har klasterga o'z strategiyasi.</p></Why>
        <Insight>{most ? `Daromadning ${fmtNum(most.share, 0)}%i ${most.title} klasterida (${most.count} marka). ` : ""}{cl.find((c) => c.key === "Dogs")?.count ? `Dogs guruhida ${cl.find((c) => c.key === "Dogs")!.count} ta marka — assortimentdan chiqarish nomzodlari, avval «yo'lakay» sotilishini tekshiring. ` : ""}{cl.find((c) => c.key === "Stars")?.count ? `Stars (${cl.find((c) => c.key === "Stars")!.count} ta) uchun xomashyo zaxirasini oldindan oshiring — tugab qolish eng qimmatga tushadi.` : ""}</Insight>
        <div><Action href="/bi-tahlil/mahsulotlar">Mahsulotlar — ABC × XYZ, foydalilik va ro'yxat</Action></div>
      </div>
    </BiPage>
  );
}
