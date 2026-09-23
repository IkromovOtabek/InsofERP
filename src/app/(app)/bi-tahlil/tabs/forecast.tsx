import { PackageSearch, AlertTriangle, UserX, Gauge, CalendarDays, CalendarRange, Activity, Clock } from "lucide-react";
import { forecastTab, anomaliesTab } from "@/lib/bi/forecast";
import { fmtNum, qty, moneyShort, date as fmtDate } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Badge } from "@/components/ui";
import { BarChart, LineChart } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Tag } from "../ui";
import type { SP } from "../page";
import { cn } from "@/lib/utils";

export async function ForecastTab({ sp }: { sp: SP }) {
  const days = [7, 14, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const [f, a] = await Promise.all([forecastTab(), anomaliesTab({ level: sp.level, source: sp.source, pattern: sp.pattern, days })]);
  const critical = f.matForecast.filter((m) => m.daysLeft !== null && m.daysLeft < 7);
  const accuracy = f.wape < 30 ? "Yaxshi" : f.wape < 60 ? "O'rtacha" : "Past";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Stockout xavfi" value={String(f.zones.critical)} icon={PackageSearch} tone={f.zones.critical ? "danger" : "success"} badge={<Badge color={f.zones.critical ? "red" : "green"} dot={false}>{f.zones.critical ? "KRITIK" : "OK"}</Badge>} hint={`${f.matForecast.length} xomashyodan ${f.zones.critical} tasi 7 kun ichida tugaydi`} href="#stockout" />
        <Kpi label="Yuqori anomaliya" value={String(a.cards.high)} icon={AlertTriangle} tone={a.cards.high ? "danger" : "default"} badge={<Badge color={a.cards.high ? "red" : "slate"} dot={false}>HIGH</Badge>} hint={`jami ${a.cards.total} anomaliyaning ${a.cards.total ? fmtNum((a.cards.high / a.cards.total) * 100, 0) : 0}%i`} href="#anomalies" />
        <Kpi label="Churn xavfi" value="→" icon={UserX} tone="warning" hint="Mijozlar bo'limida — xavf zonalari va harakat markazi" href="/bi-tahlil/ml/churn" />
        <Kpi label="Model aniqligi" value={`WAPE ${fmtNum(f.wape, 1)}%`} icon={Gauge} tone={f.wape < 30 ? "success" : f.wape < 60 ? "warning" : "danger"} badge={<Badge color={f.wape < 30 ? "green" : f.wape < 60 ? "amber" : "red"} dot={false}>{accuracy}</Badge>} hint={`MAE ${fmtNum(f.mae, 1)} m³/kun · bias ${f.bias >= 0 ? "+" : ""}${fmtNum(f.bias, 0)}%`} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="7 kunlik bashorat" value={`${fmtNum(f.next7, 1)} m³`} icon={CalendarDays} tone="brand" hint={`≈ ${moneyShort(f.next7Revenue)} so'm · keyingi hafta`} />
        <Kpi label="30 kunlik bashorat" value={`${fmtNum(f.next30, 1)} m³`} icon={CalendarRange} tone="info" hint={`≈ ${moneyShort(f.next30Revenue)} so'm · keyingi oy`} />
        <Kpi label="Kerakli quvvat" value={`${fmtNum(f.capacity.needPerDay, 1)} m³/kun`} icon={Activity} tone={f.capacity.needPerDay > f.capacity.peak ? "danger" : "success"} hint={`O'rtacha ${fmtNum(f.capacity.avg, 1)} · eng yuqori ${fmtNum(f.capacity.peak, 1)} m³/kun`} />
        <Kpi label="Trend" value={f.slope > 0.05 ? "▲ O'smoqda" : f.slope < -0.05 ? "▼ Pasaymoqda" : "→ Barqaror"} icon={Clock} tone={f.slope > 0.05 ? "success" : f.slope < -0.05 ? "danger" : "default"} hint={`${f.slope >= 0 ? "+" : ""}${fmtNum(f.slope, 2)} m³/kun har kuni · ${f.histDays} kun tarix`} />
      </div>

      {f.wape >= 50 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"><b>Bashoratni ehtiyot bilan o'qing.</b> Model xatoligi WAPE = {fmtNum(f.wape, 1)}% (MAE {fmtNum(f.mae, 1)} m³), bias {fmtNum(f.bias, 0)}% — ya'ni bashorat haqiqiy sotuvdan tizimli ravishda {f.bias < 0 ? "PAST" : "YUQORI"}. Bu raqamlarni yo'nalish sifatida ishlating; buyurtma hajmini to'g'ridan-to'g'ri ularga bog'lamang — kritik xomashyo uchun qoldiq + haqiqiy sarf tezligiga tayaning.</div>}

      <Panel title="Bashorat vs haqiqiy sotuv" info="Kunlik sotuv, m³. Uzluksiz — tarix (30 kun), uzuq — bashorat (14 kun). Model: chiziqli trend × hafta kuni indeksi, 60 kun tarixda o'qitilgan, oxirgi 14 kunda tekshirilgan.">
        <LineChart labels={f.labels} series={[{ name: "Haqiqiy", values: f.histVals, color: "#ffa800" }, { name: "Bashorat", values: f.fcVals, color: "#0d78ff", dashed: true }]} formatValue={(v) => `${qty(v)} m³`} labelEvery={4} height={220} />
        <Why label="Model qanday ishlaydi?"><p>1. Har hafta kuni uchun mavsumiylik indeksi hisoblanadi (masalan, dushanba o'rtachadan {fmtNum(f.weekday[1].value, 0)}%).</p><p>2. Mavsumiylikdan tozalangan qatorga chiziqli trend o'tkaziladi.</p><p>3. Kelajak kun = trend × shu kunning indeksi.</p><p>Aniqlik: WAPE = Σ|xato| / Σ haqiqiy. Bias manfiy bo'lsa model kam baholaydi.</p></Why>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Zaxira zonalari" info="14 kunlik bashorat asosida: xomashyo necha kunga yetadi.">
          <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-red-50 py-3"><div className="text-2xl font-bold tabular text-red-700">{f.zones.critical}</div><div className="text-xs text-slate-500">&lt;7 kun</div></div><div className="rounded-lg bg-amber-50 py-3"><div className="text-2xl font-bold tabular text-amber-700">{f.zones.mid}</div><div className="text-xs text-slate-500">7–14 kun</div></div><div className="rounded-lg bg-emerald-50 py-3"><div className="text-2xl font-bold tabular text-emerald-700">{f.zones.ok}</div><div className="text-xs text-slate-500">14+ kun</div></div></div>
          <div className="mt-4"><div className="mb-1.5 text-xs font-medium text-slate-500">Hafta kuni indeksi (100 = o'rtacha)</div><BarChart data={f.weekday} tone="violet" formatValue={(v) => `${fmtNum(v, 0)}%`} height={90} /></div>
        </Panel>
        <Panel className="xl:col-span-2" title={<span id="stockout">Inventory Forecast — 14 kun</span>} info="Qaysi xomashyo qachon tugaydi va qancha buyurtma qilish kerak. Ehtiyoj = 14 kunlik m³ bashorati × so'nggi 30 kun marka aralashmasi × retsept." padded={false}>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Xomashyo</Th><Th right>Qoldiq</Th><Th right>14 kun ehtiyoj</Th><Th right>Sarf/kun (bash.)</Th><Th right>Yetadi</Th><Th right>Tugash sanasi</Th><Th right>Buyurtma</Th><Th>Zona</Th></tr></thead>
            <tbody>{f.matForecast.length === 0 && <Empty text="Xomashyo yo'q" />}{f.matForecast.slice(0, 20).map((m) => { const z = m.daysLeft === null ? "Ma'lumot yo'q" : m.daysLeft < 7 ? "Kritik" : m.daysLeft < 14 ? "Xavfli" : "Yaxshi"; return <Tr key={m.id}><Td>{m.name} <span className="text-xs text-slate-400">{m.unit}</span></Td><Td right>{fmtNum(m.balance, 0)}</Td><Td right>{m.need ? fmtNum(m.need, 0) : "—"}</Td><Td right className="text-slate-500">{m.perDayFc ? fmtNum(m.perDayFc, 1) : "—"}</Td><Td right className={cn("font-semibold", z === "Kritik" && "text-red-600", z === "Xavfli" && "text-amber-600")}>{m.daysLeft === null ? "—" : `${fmtNum(Math.min(999, m.daysLeft), 0)} kun`}</Td><Td right className="text-slate-500">{m.runsOut ? fmtDate(m.runsOut) : "—"}</Td><Td right className={m.orderQty > 0 ? "font-semibold" : "text-slate-400"}>{m.orderQty > 0 ? `${fmtNum(m.orderQty, 0)} ${m.unit}` : "—"}</Td><Td><Tag>{z}</Tag></Td></Tr>; })}</tbody>
          </Table>
          {critical.length > 0 && <div className="border-t border-slate-100 px-5 py-3"><Action href="/receipts/new">{critical.length} ta xomashyoni BUGUN buyurtma qiling: {critical.map((m) => m.name).join(", ")}</Action></div>}
        </Panel>
      </div>

      <Panel title="Model registry" info="Tizimdagi tahlil modellari va ularning holati." padded={false}>
        <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0 text-[13px]">
          {[
            { name: "Demand Forecast", type: "Trend × mavsumiylik", trained: fmtDate(f.modelTrained), retrain: "Har sahifa ochilganda", metrics: [["MAE", `${fmtNum(f.mae, 1)} m³`], ["WAPE", `${fmtNum(f.wape, 1)}%`], ["Bias", `${fmtNum(f.bias, 0)}%`]] },
            { name: "Anomaly Detection", type: "Qoidalar (7 ta qolip) + σ-chetlanish", trained: fmtDate(new Date()), retrain: `Oxirgi ${days} kun`, metrics: [["Anomaliyalar", String(a.cards.total)], ["High", String(a.cards.high)], ["Qoliplar", String(a.patterns.length)]] },
            { name: "Churn / RFM", type: "Recency-Frequency-Monetary ballari", trained: fmtDate(new Date()), retrain: "Jonli", metrics: [["Segmentlar", "6"], ["Xavf zonalari", "5"], ["Manba", "Mijozlar bo'limi"]] },
          ].map((m) => <div key={m.name} className="p-4"><div className="flex items-center justify-between"><div className="font-semibold">{m.name}</div><Badge color="green" dot>active</Badge></div><div className="mt-2 space-y-1 text-xs text-slate-600"><div className="flex justify-between"><span className="text-slate-400">Turi</span><span>{m.type}</span></div><div className="flex justify-between"><span className="text-slate-400">Oxirgi hisob</span><span>{m.trained}</span></div><div className="flex justify-between"><span className="text-slate-400">Yangilanish</span><span>{m.retrain}</span></div>{m.metrics.map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span className="font-medium text-slate-800">{v}</span></div>)}</div></div>)}
        </div>
      </Panel>

      <Insight title="XULOSA">Keyingi 7 kunda ≈ {fmtNum(f.next7, 1)} m³ ({moneyShort(f.next7Revenue)} so'm) sotuv kutilmoqda. {f.zones.critical ? `${f.zones.critical} ta xomashyo 7 kun ichida tugaydi — bugun buyurtma bering.` : "Xomashyo zaxirasi 7 kunga yetarli."} {a.cards.high ? `${a.cards.high} ta yuqori xavfli anomaliya birma-bir tekshirishni talab qiladi.` : "Yuqori xavfli anomaliya yo'q."}</Insight>
    </div>
  );
}
