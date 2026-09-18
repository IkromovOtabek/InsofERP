import Link from "next/link";
import { AlertOctagon, Wallet, Repeat1, UserPlus, Users, Gauge, PiggyBank, ShieldAlert } from "lucide-react";
import { biContext, BiPage } from "../../shell";
import { customerBase, SEGMENT_COLOR, SEGMENT_ORDER, type Risk, type Segment } from "@/lib/bi/customers";
import { sum, safeDiv, addDays, startOfDay } from "@/lib/bi/core";
import { money, moneyShort, fmtNum, date as fmtDate } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Select, Input, Badge } from "@/components/ui";
import { BarChart, HBarList, Scatter } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, Tag, Chip, Pager } from "../../ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
const ZONES: Risk[] = ["Kritik", "Yuqori", "O'rta", "Past", "Xavfsiz"];

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  const base = (await customerBase()).filter((c) => c.segment !== "Yangi (xaridsiz)");
  const today = startOfDay(new Date());
  const page = Math.max(1, Number(sp.page) || 1), size = 25;
  const href = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ zone: sp.zone, segment: sp.segment, abc: sp.abc, debt: sp.debt, q: sp.q, ...extra })) if (v) p.set(k, v); return `/bi-tahlil/ml/churn?${p}`; };

  const inRisk = base.filter((c) => ["Kritik", "Yuqori", "O'rta"].includes(c.risk));
  const critical = base.filter((c) => c.risk === "Kritik");
  const expected = sum(inRisk.map((c) => c.expectedLoss)), annual = sum(base.map((c) => c.avgMonthly * 12));
  const recoverable = sum(inRisk.filter((c) => c.recency !== null && c.recency < 90).map((c) => c.expectedLoss));
  const debtRisk = inRisk.filter((c) => c.debt > 0);
  const oneTime = base.filter((c) => c.orders === 1);
  const newC = base.filter((c) => c.firstOrder && c.firstOrder >= addDays(today, -30));
  const active = base.filter((c) => c.recency !== null && c.recency < 30);
  const reactivated = base.filter((c) => c.lastOrder && c.lastOrder >= addDays(today, -30) && c.orders > 1 && c.frequency <= 2 && c.recency !== null && c.recency < 30 && c.firstOrder && (today.getTime() - c.firstOrder.getTime()) / 86400000 > 120);
  const avgScore = safeDiv(sum(base.map((c) => c.riskScore)), base.length);
  const avgRecency = safeDiv(sum(base.filter((c) => c.recency !== null).map((c) => c.recency as number)), base.filter((c) => c.recency !== null).length);

  // Ball taqsimoti (10 lik bucketlar)
  const dist = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}–${i * 10 + 9}`, value: base.filter((c) => Math.min(99, c.riskScore) >= i * 10 && Math.min(99, c.riskScore) < i * 10 + 10).length, loss: sum(base.filter((c) => Math.min(99, c.riskScore) >= i * 10 && Math.min(99, c.riskScore) < i * 10 + 10).map((c) => c.expectedLoss)) }));
  // Segment × zona
  const segRows = SEGMENT_ORDER.filter((s) => s !== "Yangi (xaridsiz)").map((s) => { const list = base.filter((c) => c.segment === s); return { segment: s, count: list.length, risk: list.filter((c) => ["Kritik", "Yuqori", "O'rta"].includes(c.risk)).length, avgScore: safeDiv(sum(list.map((c) => c.riskScore)), list.length), loss: sum(list.filter((c) => ["Kritik", "Yuqori", "O'rta"].includes(c.risk)).map((c) => c.expectedLoss)), debt: sum(list.map((c) => c.debt)), zones: ZONES.map((z) => sum(list.filter((c) => c.risk === z).map((c) => c.expectedLoss))) }; }).filter((r) => r.count);
  // Omillar
  const baseRate = safeDiv(inRisk.length, base.length) * 100;
  const factors = [
    { label: "45+ kun buyurtma yo'q", has: (c: typeof base[number]) => c.recency !== null && c.recency >= 45 },
    { label: "Muddati o'tgan qarz", has: (c: typeof base[number]) => c.overdueDebt > 0 },
    { label: "Chastota pasaygan (180 kunda ≤1)", has: (c: typeof base[number]) => c.frequency <= 1 && c.orders > 1 },
    { label: "Faqat 1 marta xarid qilgan", has: (c: typeof base[number]) => c.orders === 1 },
    { label: "Kredit limiti tugagan", has: (c: typeof base[number]) => c.creditLimit > 0 && c.debt >= c.creditLimit },
  ].map((f) => { const w = base.filter(f.has); const r = safeDiv(w.filter((c) => ["Kritik", "Yuqori", "O'rta"].includes(c.risk)).length, w.length) * 100; return { label: f.label, count: w.length, rate: r, lift: baseRate ? r / baseRate : 0 }; }).sort((a, b) => b.lift - a.lift);
  // Scatter: qiymat × xavf
  const scatter = base.filter((c) => c.avgMonthly > 0).sort((a, b) => b.avgMonthly - a.avgMonthly).slice(0, 120).map((c) => ({ x: c.riskScore, y: c.avgMonthly * 12, r: Math.max(2, Math.min(14, c.debt / 5e6)), label: c.name, color: SEGMENT_COLOR[c.segment] }));
  // Oqim (6 oy): faol mijozlar soni oy bo'yicha — o'sha oyda xarid qilganlar taxminan lastOrder bo'yicha
  const flow = Array.from({ length: 6 }, (_, i) => { const d = new Date(today.getFullYear(), today.getMonth() - 5 + i, 1), e = new Date(today.getFullYear(), today.getMonth() - 4 + i, 1); return { label: `${["Yan", "Fev", "Mar", "Apr", "May", "Iyn", "Iyl", "Avg", "Sen", "Okt", "Noy", "Dek"][d.getMonth()]}`, value: base.filter((c) => c.lastOrder && c.lastOrder >= d && c.lastOrder < e).length + base.filter((c) => c.lastOrder && c.lastOrder >= e && c.firstOrder && c.firstOrder < e).length }; });

  let list = base;
  if (sp.zone) list = list.filter((c) => c.risk === sp.zone);
  if (sp.segment) list = list.filter((c) => c.segment === sp.segment);
  if (sp.abc) list = list.filter((c) => c.abc === sp.abc);
  if (sp.debt === "yes") list = list.filter((c) => c.debt > 0);
  if (sp.q) { const q = sp.q.toLowerCase(); list = list.filter((c) => c.name.toLowerCase().includes(q)); }
  list = [...list].sort((a, b) => b.expectedLoss - a.expectedLoss);
  const rows = list.slice((page - 1) * size, page * size);

  return (
    <BiPage title="Churn tahlili" subtitle="Kim ketyapti, qancha pul xavf ostida va nima qilish kerak. Gibrid xavf bali: mijozning o'z xarid ritmidan kechikishi + qarz + chastota. Sana filtriga bog'liq emas." eyebrow="ML tahlil" tab="churn" range={range} period={false}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { title: "Kritik zonada", sub: `${critical.length} MIJOZ`, value: moneyShort(sum(critical.map((c) => c.expectedLoss))), unit: "so'm/yil", text: "o'z xarid ritmidan bir necha barobar kechikkan — zudlik bilan aloqa kerak", href: href({ zone: "Kritik" }), color: "border-red-400", Icon: AlertOctagon },
            { title: "Qarz + ketish xavfi", sub: `${debtRisk.length} MIJOZ`, value: moneyShort(sum(debtRisk.map((c) => c.debt))), unit: "so'm qarz", text: "ketish xavfidagi mijozlarda turgan qarz — ular ketsa, bu pul ham muzlab qoladi", href: href({ debt: "yes" }), color: "border-amber-400", Icon: Wallet },
            { title: "Bir martalik xaridor", sub: `${fmtNum(safeDiv(oneTime.length, base.length) * 100, 1)}%`, value: String(oneTime.length), unit: "mijoz", text: "faqat bir marta xarid qilgan — bu ushlab qolish emas, ikkinchi xaridni yaratish vazifasi", href: href({ segment: "New" }), color: "border-blue-400", Icon: Repeat1 },
            { title: "Saqlab qolish imkoniyati", sub: "YETIB BORISH MUMKIN", value: moneyShort(recoverable), unit: "so'm/yil", text: `yo'qotishning ${fmtNum(safeDiv(recoverable, expected) * 100, 0)}% i hali qaytarilishi mumkin (90 kundan kam sukut)`, href: href({ zone: "Yuqori" }), color: "border-emerald-400", Icon: PiggyBank },
          ].map((c) => <Link key={c.title} href={c.href} className={cn("rounded-(--radius-card) border border-slate-200/80 border-l-4 bg-white p-3.5 shadow-(--shadow-card) transition hover:shadow-md", c.color)}><div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-[12px] font-semibold"><c.Icon size={14} /> {c.title}</div><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{c.sub}</div></div><div className="mt-1.5 text-2xl font-bold tabular">{c.value}<span className="ml-1 text-xs font-medium text-slate-400">{c.unit}</span></div><div className="mt-1 text-xs text-slate-500">{c.text}</div><div className="mt-1.5 text-xs font-medium text-blue-600">Ro'yxatni ochish →</div></Link>)}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Ketish xavfida" value={String(inRisk.length)} icon={ShieldAlert} tone={inRisk.length ? "danger" : "success"} hint={`bazaning ${fmtNum(baseRate, 1)}%i · jami ${base.length}`} />
          <Kpi label="Kutilayotgan yo'qotish" value={moneyShort(expected)} icon={Wallet} tone="warning" hint={`yillik aylanmaning ${fmtNum(safeDiv(expected, annual) * 100, 1)}%i`} />
          <Kpi label="Saqlab qolish imkoniyati" value={moneyShort(recoverable)} icon={PiggyBank} tone="success" hint="90 kundan kam sukut" />
          <Kpi label="O'rtacha xavf bali" value={fmtNum(avgScore, 0)} icon={Gauge} hint={`o'rtacha ${fmtNum(avgRecency, 0)} kun oldin xarid`} />
          <Kpi label="Yangi mijozlar" value={String(newC.length)} icon={UserPlus} tone="info" hint={`faol (30 kun): ${active.length}`} />
          <Kpi label="Qaytgan mijozlar" value={String(reactivated.length)} icon={Users} tone="violet" hint="uzoq tanaffusdan keyin yana xarid" />
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 text-[13px] text-blue-950"><b>Bu sahifa nimaga tayanadi.</b> Xavf bali — gibrid: recency (oxirgi buyurtmadan beri kunlar, 60 ballgacha) + qarz (15) + muddati o'tgan qarz (15) + chastota pasayishi (10). ML modeli o'rniga qoida — chunki mijoz xatti-harakati ERP da to'liq ko'rinadi. Kutilayotgan yo'qotish = o'rtacha oylik × 12 × bal/100. Har mijozning bali jadvalda.</div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-slate-500">Zona:</span>{ZONES.map((z) => <Chip key={z} active={sp.zone === z} href={href({ zone: sp.zone === z ? undefined : z })}>{z} ({base.filter((c) => c.risk === z).length})</Chip>)}
          <span className="ml-2 font-medium text-slate-500">ABC:</span>{["A", "B", "C"].map((a) => <Chip key={a} active={sp.abc === a} href={href({ abc: sp.abc === a ? undefined : a })}>{a}</Chip>)}
          <Chip active={sp.debt === "yes"} href={href({ debt: sp.debt === "yes" ? undefined : "yes" })}>Qarzi bor</Chip>
          {(sp.zone || sp.segment || sp.abc || sp.debt || sp.q) && <Link href="/bi-tahlil/ml/churn" className="ml-2 text-slate-500 hover:underline">Tozalash</Link>}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="Xavf zonalari" info="Segmentni bosing — filtrlanadi."><HBarList data={ZONES.map((z) => ({ label: z, value: base.filter((c) => c.risk === z).length, hint: moneyShort(sum(base.filter((c) => c.risk === z).map((c) => c.expectedLoss))), tone: ({ Kritik: "danger", Yuqori: "warning", "O'rta": "info", Past: "slate", Xavfsiz: "success" } as const)[z] }))} formatValue={(v) => `${v} ta`} /></Panel>
          <Panel title="Xavf bali taqsimoti" info="Ustun — mijoz soni; pastda — kutilayotgan yo'qotish."><BarChart data={dist.map((d) => ({ label: d.label, value: d.value, tone: Number(d.label.split("–")[0]) >= 80 ? ("danger" as const) : Number(d.label.split("–")[0]) >= 60 ? ("warning" as const) : ("info" as const) }))} formatValue={(v) => `${v} mijoz`} height={140} /><div className="mt-2"><BarChart data={dist.map((d) => ({ label: d.label, value: d.loss }))} tone="slate" formatValue={(v) => `${moneyShort(v)} so'm`} height={70} /></div></Panel>
          <Panel title="Mijoz bazasi harakati" info="Oy bo'yicha faol mijozlar (taxminiy — oxirgi va birinchi xarid sanalari bo'yicha)."><BarChart data={flow} tone="brand" formatValue={(v) => `${v} mijoz`} height={140} /></Panel>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Mijoz qiymati va ketish xavfi" info="X — xavf bali, Y — yillik qiymat (o'rtacha oylik × 12). Pufakcha — qarz. O'ng yuqori burchak — eng qimmat va eng xavfli.">
            {scatter.length ? <Scatter points={scatter} xLabel="Xavf bali" yLabel="Yillik qiymat" formatX={(v) => fmtNum(v, 0)} formatY={moneyShort} height={240} xMedian={60} /> : <Note>Ma'lumot yo'q.</Note>}
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">{Object.entries(SEGMENT_COLOR).filter(([k]) => k !== "Yangi (xaridsiz)").map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: v }} />{k}</span>)}</div>
          </Panel>
          <Panel title="Churn sabablari — omillar ta'siri" info={`Bazaviy xavf darajasi ${fmtNum(baseRate, 1)}%. Lift — omil bor mijozlarda xavf necha barobar yuqori.`}>
            <div className="space-y-2.5">{factors.map((f) => <div key={f.label} className="text-[13px]"><div className="flex justify-between"><span>{f.label} <span className="text-xs text-slate-400">· {f.count} mijoz</span></span><span className="tabular"><b>{fmtNum(f.rate, 0)}%</b> xavfda · <span className={f.lift >= 1.5 ? "text-red-600" : "text-slate-500"}>×{fmtNum(f.lift, 1)}</span></span></div><div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", f.lift >= 1.5 ? "bg-red-500" : "bg-slate-500")} style={{ width: `${Math.min(100, f.rate)}%` }} /></div></div>)}</div>
            <Why>Eng kuchli omil — <b>{factors[0]?.label}</b> (×{fmtNum(factors[0]?.lift ?? 0, 1)}). Bu omilga ega mijozlar bilan ishlash eng katta qaytim beradi: ular xavf zonasiga o'tmasdan oldin aloqa qiling.</Why>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Kesim bo'yicha churn" info="Segment kesimida — mijoz soni, xavfdagilar, o'rtacha bal, kutilayotgan yo'qotish, qarz." padded={false}>
            <Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Segment</Th><Th right>Mijoz</Th><Th right>Xavfda</Th><Th right>O'rt. bal</Th><Th right>Yo'qotish</Th><Th right>Qarz</Th></tr></thead><tbody>{segRows.map((r) => <Tr key={r.segment}><Td><Link href={href({ segment: r.segment })} className="inline-flex items-center gap-1.5 hover:underline"><span className="h-2 w-2 rounded-full" style={{ background: SEGMENT_COLOR[r.segment as Segment] }} />{r.segment}</Link></Td><Td right>{r.count}</Td><Td right>{r.risk} <span className="text-xs text-slate-400">{fmtNum(safeDiv(r.risk, r.count) * 100, 0)}%</span></Td><Td right>{fmtNum(r.avgScore, 0)}</Td><Td right className="font-medium">{moneyShort(r.loss)}</Td><Td right>{moneyShort(r.debt)}</Td></Tr>)}</tbody></Table>
          </Panel>
          <Panel title="Kesim × xavf zonasi" info="Katakda — kutilayotgan yo'qotish, so'm." padded={false}>
            <Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Segment</Th>{ZONES.map((z) => <Th key={z} right>{z}</Th>)}<Th right>Jami</Th></tr></thead><tbody>{segRows.map((r) => <Tr key={r.segment}><Td>{r.segment}</Td>{r.zones.map((v, i) => <Td key={i} right className={v ? "" : "text-slate-300"}>{v ? moneyShort(v) : "·"}</Td>)}<Td right className="font-medium">{moneyShort(sum(r.zones))}</Td></Tr>)}</tbody></Table>
          </Panel>
        </div>

        <Panel title="Mijozlar ro'yxati" info="Kutilayotgan yo'qotish bo'yicha saralangan. Qatorni bosing — mijoz kartasi." padded={false} action={<span>{list.length} mijoz</span>}>
          <form method="get" action="/bi-tahlil/ml/churn" className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-[13px]">
            {sp.zone && <input type="hidden" name="zone" value={sp.zone} />}{sp.abc && <input type="hidden" name="abc" value={sp.abc} />}{sp.debt && <input type="hidden" name="debt" value={sp.debt} />}
            <Select name="segment" defaultValue={sp.segment ?? ""} className="h-8 w-44"><option value="">Barcha segmentlar</option>{SEGMENT_ORDER.filter((s) => s !== "Yangi (xaridsiz)").map((s) => <option key={s}>{s}</option>)}</Select>
            <Input name="q" defaultValue={sp.q ?? ""} placeholder="Mijoz qidirish" className="h-8 w-44" />
            <button className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white">Qo'llash</button>
          </form>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Mijoz</Th><Th>Segment</Th><Th>Zona</Th><Th right>Bal</Th><Th right>Oxirgi xarid</Th><Th right>Ritm</Th><Th right>Yillik qiymat</Th><Th right>Qarz</Th><Th right>Yo'qotish</Th><Th>Harakat</Th></tr></thead>
            <tbody>
              {rows.length === 0 && <Empty text="Mijoz topilmadi" icon={Users} />}
              {rows.map((c) => { const rhythm = c.orders > 1 && c.firstOrder && c.lastOrder ? Math.max(1, (c.lastOrder.getTime() - c.firstOrder.getTime()) / 86400000 / (c.orders - 1)) : null; return (
                <Tr key={c.id}><Td><Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link> {c.abc === "A" && <Badge color="green" dot={false}>A</Badge>}</Td><Td><span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: SEGMENT_COLOR[c.segment] }}>{c.segment}</span></Td><Td><Tag>{c.risk}</Tag></Td><Td right className="font-semibold">{c.riskScore}</Td><Td right className="whitespace-nowrap text-slate-500">{c.lastOrder ? `${fmtDate(c.lastOrder)} · ${c.recency} k` : "—"}</Td><Td right className="text-slate-500">{rhythm ? `har ${fmtNum(rhythm, 0)} kunda` : "—"}</Td><Td right>{moneyShort(c.avgMonthly * 12)}</Td><Td right className={c.overdueDebt > 0 ? "font-semibold text-red-600" : c.debt > 0 ? "text-amber-600" : ""}>{c.debt ? moneyShort(c.debt) : "—"}</Td><Td right className="font-medium">{moneyShort(c.expectedLoss)}</Td><Td className="text-xs text-slate-600">{c.action}</Td></Tr>
              ); })}
            </tbody>
          </Table>
          <Pager total={list.length} page={page} size={size} href={(p) => href({ page: String(p) })} />
        </Panel>
        <Insight tone={critical.length ? "danger" : "success"}>{inRisk.length} ta mijoz ketish xavfida ({fmtNum(baseRate, 1)}% baza) — kutilayotgan yo'qotish {money(expected)}/yil, shundan {money(recoverable)} hali qaytarilishi mumkin. {critical.length ? `Kritik zonadagi ${critical.length} mijozdan boshlang: ${critical.sort((a, b) => b.expectedLoss - a.expectedLoss).slice(0, 3).map((c) => c.name).join(", ")}.` : "Kritik zonada mijoz yo'q."}</Insight>
        <div><Action href="/bi-tahlil/mijozlar">Mijozlar bo'limi — Next Best Action ro'yxati</Action></div>
      </div>
    </BiPage>
  );
}
