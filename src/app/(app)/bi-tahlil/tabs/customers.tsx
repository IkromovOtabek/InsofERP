import Link from "next/link";
import { Users, CheckCircle2, Star, AlertTriangle, Receipt, FileWarning, PhoneCall } from "lucide-react";
import { customersTab, SEGMENT_COLOR } from "@/lib/bi/customers";
import type { Range } from "@/lib/bi/core";
import { money, moneyShort, fmtNum, date as fmtDate } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Select, Input, Badge } from "@/components/ui";
import { DonutChart, HBarList, Heatmap, LineChart, Scatter } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, Pager, ExportLink, Tag, tabHref } from "../ui";
import { ROUTES } from "../ui";
import type { SP } from "../page";

export async function CustomersTab({ range, sp }: { range: Range; sp: SP }) {
  const page = Math.max(1, Number(sp.page) || 1), size = [25, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 25;
  const d = await customersTab(range, { segment: sp.segment, risk: sp.risk, debt: sp.debt, q: sp.q, page, size });
  const c = d.cards;
  const quick = [
    { title: "Aloqa uzilgan", sub: "14–49 KUN", n: c.silent, text: "2 haftadan beri jim — tezkor qo'ng'iroq", color: "border-orange-400", href: tabHref(range, "customers", { segment: "At Risk" }) },
    { title: "Xarid to'xtatgan", sub: "50+ KUN", n: c.stopped, text: "50+ kun buyurtma bermagan mijozlar", color: "border-red-400", href: tabHref(range, "customers", { segment: "Lost" }) },
    { title: "Qarzdorlar", sub: money(c.debt), n: c.debtors, text: "Ochiq schyoti bor mijozlar", color: "border-red-400", href: tabHref(range, "customers", { debt: "yes" }) },
    { title: "At Risk", sub: "SEGMENT", n: c.atRisk, text: "Ketish xavfi ostidagi mijozlar (At Risk + Lost)", color: "border-amber-400", href: tabHref(range, "customers", { risk: "Yuqori" }) },
    { title: "Yangi mijozlar", sub: "30 KUN", n: c.newCount, text: "Oxirgi 30 kunda birinchi buyurtma", color: "border-emerald-400", href: tabHref(range, "customers", { segment: "New" }) },
  ];
  const filterHref = (extra: Record<string, string>) => tabHref(range, "customers", { ...(sp.segment ? { segment: sp.segment } : {}), ...(sp.risk ? { risk: sp.risk } : {}), ...(sp.debt ? { debt: sp.debt } : {}), ...(sp.q ? { q: sp.q } : {}), ...extra });

  return (
    <div className="space-y-6">
      {/* Qaror qatlami */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Next Best Action" eyebrow="Mijozlar — qaror qatlami" info="Har mijoz uchun bitta aniq harakat. Pul bo'yicha tartiblangan: muddati o'tgan qarz × 1.5 + kutilayotgan yo'qotish." padded={false}>
          {d.nba.length ? <ul className="divide-y divide-slate-100">{d.nba.map((x) => (
            <li key={x.id} className="flex items-start gap-3 px-5 py-2.5 text-[13px]">
              <PhoneCall size={15} className="mt-0.5 shrink-0 text-brand-500" />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Link href={`/customers/${x.id}`} className="font-semibold hover:underline">{x.name}</Link><span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: SEGMENT_COLOR[x.segment] }}>{x.segment}</span>{x.phone && <span className="text-xs text-slate-400">{x.phone}</span>}</div><div className="text-slate-600">{x.action}</div></div>
              <div className="shrink-0 text-right text-xs"><div className="font-semibold tabular text-red-600">{x.overdueDebt > 0 ? moneyShort(x.overdueDebt) : moneyShort(x.expectedLoss)}</div><div className="text-slate-400">{x.overdueDebt > 0 ? "muddati o'tgan" : "yo'qotish xavfi"}</div></div>
            </li>
          ))}</ul> : <div className="p-5"><Note>Shoshilinch harakat talab qiladigan mijoz yo'q.</Note></div>}
        </Panel>
        <Panel title="Lifetime Value — yo'qotish narxi" info="Bu mijozni yo'qotsam qancha zarar? Umumiy sotuv (butun tarix) va so'nggi 180 kun. Pufak — buyurtmalar soni.">
          {d.clv.length ? <Scatter points={d.clv} xLabel="Umumiy sotuv (LTV)" yLabel="So'nggi 180 kun" formatX={moneyShort} formatY={moneyShort} height={220} /> : <Note>Ma'lumot yo'q.</Note>}
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">{Object.entries(SEGMENT_COLOR).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: v }} />{k}</span>)}</div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Jami mijozlar" value={String(c.total)} icon={Users} hint={`Faollik ${fmtNum(c.activityRate, 0)}%`} />
        <Kpi label="Faol mijozlar" value={String(c.active)} icon={CheckCircle2} tone="success" hint="30 kunda buyurtma" />
        <Kpi label="VIP mijozlar" value={String(c.vip)} icon={Star} tone="brand" hint="top 20% tushum" />
        <Kpi label="Xavf ostida" value={String(c.atRisk)} icon={AlertTriangle} tone={c.atRisk ? "danger" : "default"} hint="At Risk + Lost" />
        <Kpi label="O'rtacha chek" value={moneyShort(c.avgCheck)} icon={Receipt} hint="so'm / zayavka" />
        <Kpi label="Jami qarz" value={moneyShort(c.debt)} icon={FileWarning} tone={c.debt ? "warning" : "default"} hint={`${c.debtors} ta qarzdor`} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {quick.map((q) => (
          <div key={q.title} className={`rounded-(--radius-card) border border-slate-200/80 border-l-4 bg-white p-3.5 shadow-(--shadow-card) ${q.color}`}>
            <div className="flex items-baseline justify-between"><div className="text-[13px] font-semibold">{q.title}</div><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{q.sub}</div></div>
            <div className="mt-1 text-2xl font-bold tabular">{q.n}</div>
            <div className="text-xs text-slate-500">{q.text}</div>
            <Link href={q.href} className="mt-1.5 inline-block text-xs font-medium text-blue-600 hover:underline">Jadvalda ko'rish →</Link>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="RFM segmentatsiya" info="Recency (oxirgi buyurtmadan beri kunlar), Frequency (180 kunda buyurtmalar), Monetary (180 kun tushum). VIP — top 20% tushum, Loyal — 3+ buyurtma, At Risk — 45–89 kun, Lost — 90+ kun.">
          <DonutChart data={d.segments.filter((s) => s.count).map((s) => ({ label: s.segment, value: s.count, color: s.color }))} formatValue={(v) => `${v} ta`} center={{ value: String(c.total), label: "mijoz" }} />
          <div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><thead><tr><Th>Segment</Th><Th right>Mijoz</Th><Th right>180 kun tushum</Th><Th right>Qarz</Th></tr></thead><tbody>{d.segments.filter((s) => s.count).map((s) => <Tr key={s.segment}><Td><Link href={tabHref(range, "customers", { segment: s.segment })} className="hover:underline">{s.segment}</Link></Td><Td right>{s.count}</Td><Td right>{moneyShort(s.revenue)}</Td><Td right className={s.debt ? "text-red-600" : ""}>{moneyShort(s.debt)}</Td></Tr>)}</tbody></table></div>
        </Panel>
        <Panel title="RFM matritsa · Recency × Frequency" info="Katakda — mijozlar soni. Yuqori chap — faol va tez-tez; pastki o'ng — uzoq vaqt kelmagan lekin ilgari tez-tez xarid qilgan (eng qimmat yo'qotish).">
          <Heatmap rows={d.rfm.rows.map((r) => `${r} kun`)} cols={d.rfm.cols.map((f) => `${f} buyurtma`)} cells={d.rfm.cells} rowLabel="Recency" colLabel="Frequency" />
          <Why>Pastki qatorlar (45+ kun) va o'ng ustunlar (4+ buyurtma) kesishmasi — ilgari faol bo'lgan, hozir yo'qolgan mijozlar. Ularga qo'ng'iroq eng yuqori qaytim beradi: {d.rfm.cells[2][2] + d.rfm.cells[2][3] + d.rfm.cells[3][2] + d.rfm.cells[3][3]} ta mijoz, {moneyShort(d.rfm.cellMoney[2][2] + d.rfm.cellMoney[2][3] + d.rfm.cellMoney[3][2] + d.rfm.cellMoney[3][3])} so'm (180 kun).</Why>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Qarz aging" info="Ochiq schyotlar yoshi bo'yicha. 90+ kun — undirish ehtimoli keskin tushadi.">
          <HBarList data={Object.entries(d.aging).map(([k, v], i) => ({ label: `${k} kun`, value: v, tone: (["success", "info", "warning", "danger"] as const)[i] }))} formatValue={moneyShort} />
          <div className="mt-3 text-xs text-slate-500">Jami: <b className="text-slate-800">{money(Object.values(d.aging).reduce((a, b) => a + b, 0))}</b></div>
        </Panel>
        <Panel className="xl:col-span-2" title="Eng katta qarzdorlar — aging bo'yicha" padded={false}>
          <Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Mijoz</Th><Th right>0–30</Th><Th right>31–60</Th><Th right>61–90</Th><Th right>90+</Th><Th right>Jami</Th></tr></thead><tbody>{d.agingTop.length === 0 && <Empty text="Qarzdor yo'q" />}{d.agingTop.map((x) => <Tr key={x.id}><Td><Link href={`/customers/${x.id}`} className="hover:underline">{x.name}</Link></Td>{x.b.map((v, i) => <Td key={i} right className={i === 3 && v ? "text-red-600" : ""}>{v ? moneyShort(v) : "·"}</Td>)}<Td right className="font-semibold">{moneyShort(x.total)}</Td></Tr>)}</tbody></Table>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Mijoz oqimi" info="Oy bo'yicha: birinchi buyurtma bergan yangi mijozlar va 90 kun jim qolib Lost bo'lganlar.">
          <LineChart labels={d.flow.map((f) => f.label)} series={[{ name: "Yangi", values: d.flow.map((f) => f.newC), color: "#00cb80" }, { name: "Yo'qotilgan", values: d.flow.map((f) => f.lost), color: "#fa1636" }]} formatValue={(v) => `${v} ta`} height={160} />
        </Panel>
        <Panel title="Churn tahlili" info="Xavf bali: recency (60 ballgacha) + qarz (15) + muddati o'tgan qarz (15) + chastota pasayishi (10). Kutilayotgan yo'qotish = o'rtacha oylik × 12 × bal/100.">
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-lg bg-red-50 p-3"><div className="text-xs text-red-700">Ketish xavfida</div><div className="text-xl font-bold tabular text-red-700">{d.churn.atRisk}</div><div className="text-xs text-red-600">O'rta+ xavf</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Kutilayotgan yo'qotish</div><div className="text-xl font-bold tabular">{moneyShort(d.churn.expectedLoss)}</div><div className="text-xs text-slate-500">yillik aylanmadan</div></div>
            <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Saqlab qolish imkoniyati</div><div className="text-xl font-bold tabular text-emerald-700">{moneyShort(d.churn.recoverable)}</div><div className="text-xs text-emerald-600">At Risk — hali yetib borish mumkin</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">O'rtacha xavf bali</div><div className="text-xl font-bold tabular">{fmtNum(d.churn.avgScore, 0)}</div><div className="text-xs text-slate-500">/ 100</div></div>
          </div>
          <div className="mt-4"><div className="mb-1.5 text-xs font-medium text-slate-500">Xavf zonalari</div><HBarList data={d.churn.zones.map((z) => ({ label: z.label, value: z.value, hint: moneyShort(z.loss), tone: ({ Kritik: "danger", Yuqori: "danger", "O'rta": "warning", Past: "info", Xavfsiz: "success" } as const)[z.label] }))} formatValue={(v) => `${v} ta`} /></div>
          <div className="mt-4"><div className="mb-1.5 text-xs font-medium text-slate-500">Churn sabablari — omillar</div><HBarList data={d.churn.factors} tone="slate" formatValue={(v) => `${v} ta`} /></div>
        </Panel>
      </div>

      {/* Harakat markazi */}
      <Panel title="Harakat markazi — mijozlar ro'yxati" info="Pul bo'yicha saralangan (kutilayotgan yo'qotish + qarz). Filtrlang va eksport qiling." padded={false} action={<ExportLink type="customers" range={range} />}>
        <form method="get" action={ROUTES.customers} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-[13px]">
          <input type="hidden" name="period" value={range.period === "custom" ? "month" : range.period} />
          <Select name="segment" defaultValue={sp.segment ?? ""} className="h-8 w-44"><option value="">Barcha segmentlar</option>{["VIP", "Loyal", "Regular", "New", "At Risk", "Lost", "Yangi (xaridsiz)"].map((s) => <option key={s}>{s}</option>)}</Select>
          <Select name="risk" defaultValue={sp.risk ?? ""} className="h-8 w-36"><option value="">Barcha xavf</option>{["Kritik", "Yuqori", "O'rta", "Past", "Xavfsiz"].map((s) => <option key={s}>{s}</option>)}</Select>
          <Select name="debt" defaultValue={sp.debt ?? ""} className="h-8 w-32"><option value="">Barchasi</option><option value="yes">Qarzdor</option><option value="no">Qarzsiz</option></Select>
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Mijoz qidirish" className="h-8 w-44" />
          <button className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white">Qo'llash</button>
          {(sp.segment || sp.risk || sp.debt || sp.q) && <Link href={tabHref(range, "customers")} className="text-xs text-slate-500 hover:underline">Tozalash</Link>}
        </form>
        <Table className="rounded-none border-0 shadow-none">
          <thead><tr><Th>Mijoz</Th><Th>Segment</Th><Th>Xavf</Th><Th right>Bal</Th><Th right>Oxirgi</Th><Th right>Buyurtma (180k)</Th><Th right>Sotuv (180k)</Th><Th right>Qarz</Th><Th right>Kutilayotgan yo'qotish</Th><Th>Harakat</Th></tr></thead>
          <tbody>
            {d.list.rows.length === 0 && <Empty text="Mijoz topilmadi" icon={Users} />}
            {d.list.rows.map((x) => (
              <Tr key={x.id}>
                <Td><Link href={`/customers/${x.id}`} className="hover:underline">{x.name}</Link>{x.abc === "A" && <Badge color="green" dot={false}>A</Badge>}</Td>
                <Td><span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: SEGMENT_COLOR[x.segment] }}>{x.segment}</span></Td>
                <Td><Tag>{x.risk}</Tag></Td><Td right>{x.riskScore}</Td>
                <Td right className="whitespace-nowrap text-slate-500">{x.lastOrder ? `${fmtDate(x.lastOrder)} · ${x.recency} k` : "—"}</Td>
                <Td right>{x.frequency}</Td><Td right>{moneyShort(x.monetary)}</Td>
                <Td right className={x.overdueDebt > 0 ? "font-semibold text-red-600" : x.debt > 0 ? "text-amber-600" : ""}>{x.debt ? moneyShort(x.debt) : "—"}</Td>
                <Td right>{moneyShort(x.expectedLoss)}</Td>
                <Td className="text-xs text-slate-600">{x.action}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <Pager total={d.list.total} page={d.list.page} size={d.list.size} href={(p) => filterHref({ page: String(p), size: String(size) })} />
      </Panel>
      <Insight>{c.atRisk} ta mijoz xavf ostida — ular oyiga {moneyShort(d.churn.recoverable / 12)} so'm olib kelardi. Eng katta 5 tasiga bugun qo'ng'iroq qiling. Muddati o'tgan qarz {moneyShort(d.aging["61–90"] + d.aging["90+"])} so'm (60+ kun) — undirish ehtimoli har hafta pasayadi.</Insight>
      <div><Action href="/customers">Mijozlar ro'yxatiga o'tish</Action></div>
    </div>
  );
}
