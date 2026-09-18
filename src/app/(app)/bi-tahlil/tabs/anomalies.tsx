import Link from "next/link";
import { AlertTriangle, Activity, Clock } from "lucide-react";
import { anomaliesTab } from "@/lib/bi/forecast";
import { fmtNum, moneyShort, dateTime } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Badge } from "@/components/ui";
import { BarChart, HBarList, LineChart } from "@/components/ui/charts";
import { Kpi, Panel, Insight, Note, Tag, Chip } from "../ui";
import type { SP } from "../page";
import { cn } from "@/lib/utils";

export async function AnomaliesTab({ sp }: { sp: SP }) {
  const days = [7, 14, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const a = await anomaliesTab({ level: sp.level, source: sp.source, pattern: sp.pattern, days });
  const href = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams({ days: String(days) }); for (const [k, v] of Object.entries({ level: sp.level, source: sp.source, pattern: sp.pattern, ...extra })) if (v) p.set(k, v); return `/bi-tahlil/ml/anomaliyalar?${p}`; };

  return (
    <div className="space-y-6">

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Jami anomaliyalar" value={String(a.cards.total)} icon={AlertTriangle} hint={`Oxirgi 7 kun: ${a.cards.last7} ${a.cards.prev7 ? `(${a.cards.last7 >= a.cards.prev7 ? "▲" : "▼"} ${fmtNum(Math.abs(((a.cards.last7 - a.cards.prev7) / a.cards.prev7) * 100), 0)}%)` : ""}`} />
        <Kpi label="Yuqori xavfli" value={String(a.cards.high)} icon={AlertTriangle} tone={a.cards.high ? "danger" : "default"} hint={`Jamining ${a.cards.total ? fmtNum((a.cards.high / a.cards.total) * 100, 0) : 0}%i`} href={href({ level: "High" })} />
        <Kpi label="Ta'sirlangan pul" value={moneyShort(a.cards.money)} icon={Activity} tone="warning" hint="High anomaliyalar summasi" />
        <Kpi label="Ish vaqtidan tashqari" value={String(a.cards.offHours)} icon={Clock} tone={a.cards.offHours ? "warning" : "default"} hint="20:00–07:00 oralig'ida" href={href({ pattern: "Ish vaqtidan tashqari" })} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-slate-500">Daraja:</span>{["High", "Medium", "Low"].map((l) => <Chip key={l} active={sp.level === l} href={href({ level: sp.level === l ? undefined : l })}>{l}</Chip>)}
        <span className="ml-2 font-medium text-slate-500">Manba:</span>{a.sources.map((s) => <Chip key={s} active={sp.source === s} href={href({ source: sp.source === s ? undefined : s })}>{s}</Chip>)}
        <span className="ml-2 font-medium text-slate-500">Davr:</span>{[7, 14, 30, 90].map((dd) => <Chip key={dd} active={days === dd} href={`/bi-tahlil/ml/anomaliyalar?days=${dd}`}>{dd} kun</Chip>)}
        {(sp.level || sp.source || sp.pattern) && <Link href={`/bi-tahlil/ml/anomaliyalar?days=${days}`} className="ml-2 text-slate-500 hover:underline">Tozalash</Link>}
      </div>

      <Panel title="Shubhali qoliplar" info="Kartani bosing — ro'yxat shu qolip bo'yicha filtrlanadi.">
        {a.patterns.length ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{a.patterns.map((p) => <Link key={p.pattern} href={href({ pattern: sp.pattern === p.pattern ? undefined : p.pattern })} className={cn("rounded-lg border p-3 transition hover:border-slate-300", sp.pattern === p.pattern ? "border-slate-900 bg-slate-50" : "border-slate-200")}><div className="flex items-start justify-between gap-2"><div className="font-semibold text-[13px]">{p.pattern}</div>{p.high > 0 && <Badge color="red" dot={false}>{p.high} HIGH</Badge>}</div><div className="mt-1 text-xl font-bold tabular">{p.count} <span className="text-xs font-normal text-slate-400">qator</span></div><div className="text-xs text-slate-500">{p.source}{p.amount > 0 && ` · ${moneyShort(p.amount)} so'm`}</div></Link>)}</div> : <Note>Anomaliya topilmadi — hammasi toza.</Note>}
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Daraja bo'yicha trend" info="Kunlik anomaliyalar soni; qizil — High.">
          <LineChart labels={a.trend.map((t) => t.label)} series={[{ name: "Jami", values: a.trend.map((t) => t.value), color: "#64748b" }, { name: "High", values: a.trendHigh.map((t) => t.value), color: "#ef4444" }]} formatValue={(v) => `${v} ta`} labelEvery={Math.max(1, Math.ceil(a.trend.length / 10))} height={150} />
        </Panel>
        <Panel title="Kim bilan bog'liq" info="Xodim kesimida — kim ko'p anomal yozuv kiritgan.">{a.who.length ? <HBarList data={a.who.map((w) => ({ label: w.label, value: w.value, hint: w.high ? `${w.high} high` : undefined, tone: w.high ? ("danger" as const) : ("slate" as const) }))} formatValue={(v) => `${v} ta`} /> : <Note>—</Note>}</Panel>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Hafta kuni bo'yicha"><BarChart data={a.byWeekday} tone="slate" formatValue={(v) => `${v} ta`} height={100} /></Panel>
        <Panel title="Soat bo'yicha (faqat to'lovlar)"><BarChart data={a.byHour.map((h) => ({ ...h, tone: Number(h.label) >= 20 || Number(h.label) < 7 ? ("danger" as const) : ("info" as const) }))} formatValue={(v) => `${v} ta`} height={100} labelEvery={3} /></Panel>
      </div>

      <Panel title="Anomaliyalar ro'yxati" info="Ball bo'yicha saralangan. Qatorni bosing — hujjat ochiladi." padded={false} action={<span>{a.list.length} qator</span>}>
        <Table className="rounded-none border-0 shadow-none">
          <thead><tr><Th>Sana</Th><Th>Daraja</Th><Th right>Ball</Th><Th>Manba</Th><Th>Qolip</Th><Th>Tavsif</Th><Th right>Summa</Th><Th>Kim</Th></tr></thead>
          <tbody>{a.list.length === 0 && <Empty text="Anomaliya yo'q" />}{a.list.map((x) => <Tr key={x.id}><Td className="whitespace-nowrap text-slate-500">{dateTime(x.date)}</Td><Td><Tag>{x.level}</Tag></Td><Td right>{x.score}</Td><Td className="text-xs">{x.source}</Td><Td className="text-xs">{x.pattern}</Td><Td>{x.href ? <Link href={x.href} className="hover:underline">{x.title}</Link> : x.title}<div className="text-xs text-slate-500">{x.detail}</div></Td><Td right>{x.amount ? moneyShort(x.amount) : "—"}</Td><Td className="text-xs text-slate-500">{x.who ?? "—"}</Td></Tr>)}</tbody>
        </Table>
      </Panel>
      <Insight title="XULOSA">{a.cards.high ? `${a.cards.high} ta yuqori xavfli anomaliya bor — avval «Manba: To'lov» filtridan boshlang, keyin narx chetlanishlarini tekshiring.` : "Yuqori xavfli anomaliya yo'q — tizim toza."} Oxirgi 7 kunda {a.cards.last7} ta holat{a.cards.prev7 ? ` (oldingi haftada ${a.cards.prev7})` : ""}. Har bir qator — hujjatga havola: bosib, kim va nima uchun kiritganini aniqlang.</Insight>
    </div>
  );
}
