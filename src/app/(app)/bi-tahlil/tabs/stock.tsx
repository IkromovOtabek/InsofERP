import Link from "next/link";
import { Warehouse, Layers, RefreshCw, AlertTriangle, PackagePlus, Trash2, Snowflake } from "lucide-react";
import { stockTab } from "@/lib/bi/stock";
import { type Range, type Gran, autoGran } from "@/lib/bi/core";
import { money, moneyShort, fmtNum, qty, date as fmtDate } from "@/lib/format";
import { Table, Th, Td, Tr, Empty } from "@/components/ui";
import { BarChart, HBarList, LineChart, DonutChart } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, Tag, ExportLink, Chip, ProgressBar, tabHref } from "../ui";
import type { SP } from "../page";

export async function StockTab({ range, sp }: { range: Range; sp: SP }) {
  const gran: Gran = sp.gran === "day" || sp.gran === "week" || sp.gran === "month" ? sp.gran : autoGran(range.days);
  const d = await stockTab(range, gran);
  const c = d.cards;
  const zoneTone = { Kritik: "danger", Xavfli: "warning", Yaxshi: "success", "Ma'lumot yo'q": "slate" } as const;
  const timeline = [...d.materials].filter((m) => m.days !== null).sort((a, b) => (a.days ?? 0) - (b.days ?? 0)).slice(0, 15);

  return (
    <div className="space-y-6">
      {/* Harakat qatlami */}
      <Panel title="Buyurtma navbati" eyebrow="Harakat qatlami · ogohlantirish · buyurtma · prognoz" info="Pul bo'yicha tartiblangan. Tavsiya miqdor = max(rejadagi ehtiyoj, 30 kunlik sarf, minimal zaxira) − qoldiq." padded={false} action={<Link href="/receipts/new" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">Kirim rasmiylashtirish</Link>}>
        {d.queue.length === 0 ? <div className="p-5"><Note>Buyurtma talab qiladigan xomashyo yo'q — zaxira yetarli.</Note></div> : (
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>#</Th><Th>Xomashyo</Th><Th>Zona</Th><Th right>Qoldiq</Th><Th right>Kunlik sarf</Th><Th right>Yetadi</Th><Th right>Rejadagi ehtiyoj</Th><Th right>Tavsiya miqdor</Th><Th right>Summa</Th></tr></thead>
            <tbody>{d.queue.map((m, i) => <Tr key={m.id}><Td className="text-slate-400">{i + 1}</Td><Td>{m.name}{m.short && <span className="ml-1.5 text-[10px] font-semibold uppercase text-red-600">zayavkaga yetmaydi</span>}</Td><Td><Tag>{m.zone}</Tag></Td><Td right>{qty(m.balance)} {m.unit}</Td><Td right>{fmtNum(m.perDay, 1)}</Td><Td right className={m.days !== null && m.days < 7 ? "font-semibold text-red-600" : ""}>{m.days === null ? "—" : `${fmtNum(m.days, 1)} kun`}</Td><Td right>{m.planned ? qty(m.planned) : "—"}</Td><Td right className="font-semibold">{qty(m.suggestQty)} {m.unit}</Td><Td right className="font-semibold">{moneyShort(m.suggestCost)}</Td></Tr>)}</tbody>
          </Table>
        )}
        <div className="border-t border-slate-100 px-5 py-3"><Action href="/receipts/new">Jami {moneyShort(d.queue.reduce((s, m) => s + m.suggestCost, 0))} so'mlik buyurtma loyihasi — snabjeniye tasdiqlasin</Action></div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Ombor qiymati" value={moneyShort(c.value)} icon={Warehouse} tone="brand" hint="xomashyo × o'rt. kirim narxi" />
        <Kpi label="Xomashyo turlari" value={String(c.sku)} icon={Layers} hint="faol pozitsiya" />
        <Kpi label="Aylanma" value={c.turnoverDays === null ? "—" : `${fmtNum(c.turnoverDays, 0)} kun`} icon={RefreshCw} tone="info" hint="o'rtacha omborda turish" />
        <Kpi label="Stockout xavfi" value={String(c.stockout)} icon={AlertTriangle} tone={c.stockout ? "danger" : "success"} hint="xomashyo <20 kun" />
        <Kpi label="Overstock" value={String(c.overstock)} icon={Snowflake} tone={c.overstock ? "warning" : "default"} hint="90+ kunlik zaxira" />
        <Kpi label="Write-off" value={moneyShort(c.writeOff)} icon={Trash2} tone={c.writeOff ? "danger" : "default"} hint={`${c.writeOffCount} ta yozuv · davr`} />
      </div>
      <Note>Ombor ko'rsatkichlari — joriy holat snapshot'i. Davr filtri Write-off, kirim/chiqim va yetkazuvchilar kartalariga ta'sir qiladi.</Note>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Ombor holati" info="Qoldiq, kunlik sarf (30 kun o'rtachasi), necha kunga yetadi, rejadagi ehtiyoj (tasdiqlangan zayavkalar × retsept)." padded={false} action={<ExportLink type="materials" range={range} />}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Xomashyo</Th><Th>ABC</Th><Th right>Qoldiq</Th><Th right>Qiymat</Th><Th right>Sarf/kun</Th><Th className="w-40">Yetadi</Th><Th right>Ehtiyoj</Th><Th>Holat</Th></tr></thead>
            <tbody>{d.materials.length === 0 && <Empty text="Xomashyo kiritilmagan" />}{d.materials.map((m) => (
              <Tr key={m.id}><Td>{m.name} <span className="text-xs text-slate-400">{m.unit}</span></Td><Td><Tag>{m.abc}</Tag></Td><Td right className={m.balance < m.minStock ? "text-red-600" : ""}>{qty(m.balance)}</Td><Td right>{moneyShort(m.value)}</Td><Td right className="text-slate-500">{m.perDay > 0 ? fmtNum(m.perDay, 1) : "—"}</Td>
                <Td>{m.days === null ? <span className="text-slate-400">—</span> : <div><div className={`text-[12.5px] font-semibold tabular ${m.zone === "Kritik" ? "text-red-600" : m.zone === "Xavfli" ? "text-amber-600" : ""}`}>{m.days > 999 ? ">999" : fmtNum(m.days, 1)} kun</div><ProgressBar value={Math.min(m.days, 30)} max={30} tone={zoneTone[m.zone]} /></div>}</Td>
                <Td right className={m.short ? "text-red-600" : ""}>{m.planned ? qty(m.planned) : "—"}</Td><Td><Tag>{m.short ? "Kritik" : m.dead ? "Ma'lumot yo'q" : m.zone}</Tag>{m.dead && <span className="ml-1 text-[10px] text-slate-400">muzlagan</span>}</Td></Tr>
            ))}</tbody>
          </Table>
        </Panel>
        <Panel title="Bashoratli stockout timeline" info="Joriy qoldiq / kunlik sarf — eng xavfli 15 xomashyo. Kritik <7, Xavfli 7–20, Yaxshi >20 kun.">
          <div className="mb-3 grid grid-cols-4 gap-1.5 text-center text-xs">{[["Hammasi", d.materials.length, "slate"], ["Kritik", d.zones.critical, "red"], ["Xavfli", d.zones.risky, "amber"], ["Yaxshi", d.zones.good, "emerald"]].map(([l, n, col]) => <div key={l as string} className={`rounded-lg bg-${col}-50 py-1.5`}><div className={`text-lg font-bold tabular text-${col}-700`}>{n as number}</div><div className="text-[10px] text-slate-500">{l as string}</div></div>)}</div>
          {timeline.length ? <HBarList data={timeline.map((m) => ({ label: m.name, value: Math.min(60, m.days ?? 0), hint: m.days !== null && m.days > 60 ? ">60 kun" : undefined, tone: zoneTone[m.zone] === "slate" ? "slate" : zoneTone[m.zone] }))} formatValue={(v) => `${fmtNum(v, 0)} kun`} max={60} /> : <Note>Sarf ma'lumoti yo'q.</Note>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Zaxira trendi — 180 kun" info="Ombor qiymati haftalik — joriy qoldiqdan orqaga hisoblab, bugungi o'rtacha narx asosida taxminiy.">
          <LineChart labels={d.trend.map((t) => t.label)} series={[{ name: "Ombor qiymati", values: d.trend.map((t) => t.value), color: "#f59e0b" }]} formatValue={moneyShort} labelEvery={4} height={170} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <div><div className="text-slate-400">Hozirgi qiymat</div><div className="font-semibold tabular">{moneyShort(c.value)}</div></div>
            <div><div className="text-slate-400">180 kunlik o'zgarish</div><div className={`font-semibold tabular ${c.value - (d.trend[0]?.value ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{moneyShort(c.value - (d.trend[0]?.value ?? 0))}</div></div>
            <div><div className="text-slate-400">Eng yuqori nuqta</div><div className="font-semibold tabular">{moneyShort(Math.max(0, ...d.trend.map((t) => t.value)))}</div></div>
            <div><div className="text-slate-400">Davr o'rtachasi</div><div className="font-semibold tabular">{moneyShort(d.trend.reduce((s, t) => s + t.value, 0) / Math.max(1, d.trend.length))}</div></div>
          </div>
        </Panel>
        <Panel title="Kirim / chiqim balansi" info="Kirim — yetkazuvchidan (RECEIPT), chiqim — ishlab chiqarish sarfi + brak. Qiymatda." action={<div className="flex gap-1">{(["day", "week", "month"] as const).map((g) => <Chip key={g} active={gran === g} href={tabHref(range, "stock", { gran: g })}>{{ day: "Kunlik", week: "Haftalik", month: "Oylik" }[g]}</Chip>)}</div>}>
          <LineChart labels={d.inflow.map((x) => x.label)} series={[{ name: "Kirim", values: d.inflow.map((x) => x.value), color: "#10b981" }, { name: "Chiqim", values: d.outflow.map((x) => x.value), color: "#ef4444" }]} formatValue={moneyShort} labelEvery={Math.max(1, Math.ceil(d.inflow.length / 10))} height={170} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <div><div className="text-slate-400">Jami kirim</div><div className="font-semibold tabular text-emerald-600">{moneyShort(d.totalIn)}</div></div>
            <div><div className="text-slate-400">Jami chiqim</div><div className="font-semibold tabular text-red-600">{moneyShort(d.totalOut)}</div></div>
            <div><div className="text-slate-400">Sof natija</div><div className={`font-semibold tabular ${d.totalIn - d.totalOut >= 0 ? "text-emerald-600" : "text-red-600"}`}>{moneyShort(d.totalIn - d.totalOut)}</div></div>
            <div><div className="text-slate-400">Qoplash darajasi</div><div className="font-semibold tabular">{d.totalOut ? `${fmtNum((d.totalIn / d.totalOut) * 100, 0)}%` : "—"}</div></div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="ABC × ombor qiymati" info="A — sarf qiymatining 80%i. A-sinf xomashyo hech qachon tugamasligi kerak; C-sinf uchun katta zaxira — muzlagan pul.">
          <DonutChart data={d.abcStock.map((a) => ({ label: `${a.abc}-sinf (${a.items.length})`, value: a.value }))} formatValue={moneyShort} />
          <Why>{d.abcStock.map((a) => <p key={a.abc}><b>{a.abc}:</b> {a.items.map((m) => m.name).join(", ") || "—"}</p>)}</Why>
        </Panel>
        <Panel title="Omborda muzlagan kapital" info="90 kun retseptga kirmagan xomashyo + tayyor mahsulot (dona) qoldig'i.">
          <div className="text-2xl font-bold tabular text-violet-600">{moneyShort(d.deadValue)} <span className="text-sm font-normal text-slate-400">so'm</span></div>
          <div className="mt-2 space-y-1 text-[13px]">
            {d.dead.map((m) => <div key={m.id} className="flex justify-between"><span>{m.name} <span className="text-xs text-slate-400">{qty(m.balance)} {m.unit}</span></span><span className="tabular">{moneyShort(m.value)}</span></div>)}
            {d.finished.map((f) => <div key={f.id} className="flex justify-between"><span>{f.code} <span className="text-xs text-slate-400">{qty(f.qty)} dona · tayyor</span></span><span className="tabular">{moneyShort(f.value)}</span></div>)}
            {!d.dead.length && !d.finished.length && <Note>Muzlagan zaxira yo'q.</Note>}
          </div>
          {(d.dead.length > 0 || d.finished.length > 0) && <div className="mt-3"><Action href="/stock?tab=capacity">Aksiya yoki qaytarish orqali aylantiring — bu pul o'zi harakatga kelmaydi</Action></div>}
        </Panel>
        <Panel title="Yetkazuvchilar — Top 5" info="Davr ichidagi kirim summasi bo'yicha.">
          {d.suppliers.length ? <HBarList data={d.suppliers.map((s) => ({ label: s.name, value: s.value, hint: `${s.docs} hujjat` }))} formatValue={moneyShort} tone="info" /> : <Note>Davrda kirim yo'q.</Note>}
          <div className="mt-3 border-t border-slate-100 pt-3"><div className="mb-1 text-xs font-medium text-slate-500">Write-off soni (oylik)</div><BarChart data={d.woMonthly} tone="danger" height={70} formatValue={(v) => `${v} ta`} /></div>
        </Panel>
      </div>

      <Insight>Ombor qiymati {money(c.value)}. {c.stockout ? `${c.stockout} ta xomashyo 20 kundan kam qoldi — buyurtma navbatida ${moneyShort(d.queue.reduce((s, m) => s + m.suggestCost, 0))} so'mlik loyiha tayyor.` : "Barcha xomashyo 20+ kunga yetadi."} {d.deadValue > 0 ? `Muzlagan kapital ${moneyShort(d.deadValue)} so'm — bu pulni aylantirish kerak.` : ""} {d.materials.filter((m) => m.dead).length > 0 && `Oxirgi ishlatilgan sana: ${d.materials.filter((m) => m.lastConsume).map((m) => fmtDate(m.lastConsume!)).slice(0, 1)[0] ?? "—"}.`}</Insight>
      <div><Action href={tabHref(range, "forecast")}><PackagePlus size={14} className="mr-1 inline" />14 kunlik xomashyo ehtiyoji bashoratini ko'rish</Action></div>
    </div>
  );
}
