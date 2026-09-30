import Link from "next/link";
import { AlertTriangle, ArrowRight, Banknote, Boxes, CheckCircle2, ClipboardList, Factory, FileText, Gauge, Landmark, ShieldAlert, Sliders, TrendingDown, TrendingUp, Truck, Wallet } from "lucide-react";
import { ownerDashboard, LEVEL_LABEL, type Level } from "@/lib/owner-dashboard";
import { moneyShort, pct, qty, date, fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, Progress, Td, Th, Tr } from "@/components/ui";
import { Panel } from "../bi-tahlil/ui";
import { HBarList, LineChart } from "@/components/ui/charts";
import { cn } from "@/lib/utils";
import { reportHistory } from "@/lib/production-report";
import { ReportHistory } from "./hisobot/history";

/* ───────────────────────── Holat ranglari (norma / e'tibor / kritik) ───────────────────────── */
const LV: Record<Level, { dot: string; text: string; bg: string; badge: "green" | "amber" | "red" }> = {
  ok: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "border-emerald-200 bg-emerald-50/60", badge: "green" },
  warn: { dot: "bg-amber-500", text: "text-amber-700", bg: "border-amber-200 bg-amber-50/60", badge: "amber" },
  crit: { dot: "bg-red-500", text: "text-red-700", bg: "border-red-200 bg-red-50/60", badge: "red" },
};
const Dot = ({ level, title }: { level: Level; title?: string }) => <span title={title ?? LEVEL_LABEL[level]} className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", LV[level].dot)} />;
const Lvl = ({ level }: { level: Level }) => <Badge color={LV[level].badge}>{LEVEL_LABEL[level]}</Badge>;
const Dev = ({ v, invert, unit = "so'm" }: { v: number | null; invert?: boolean; unit?: string }) => {
  if (v === null) return <span className="text-slate-400">—</span>;
  const good = invert ? v <= 0 : v >= 0;
  return <span className={cn("tabular", good ? "text-emerald-700" : "text-red-600")}>{v > 0 ? "+" : v < 0 ? "−" : ""}{unit === "so'm" ? moneyShort(Math.abs(v)) : `${fmtNum(Math.abs(v), 1)} ${unit}`}</span>;
};
const m = (v: number | null | undefined) => (v === null || v === undefined ? "—" : moneyShort(v));
const more = (href: string, text: React.ReactNode = "Batafsil") => <Link href={href} className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900">{text} <ArrowRight size={13} /></Link>;

/** Yuqori panel kartasi — raqam + holat nuqtasi + bir qatorli izoh. */
function Top({ label, value, sub, level, href, icon: Icon }: { label: string; value: string; sub: React.ReactNode; level: Level; href: string; icon: typeof Wallet }) {
  return (
    <Link href={href} className={cn("flex flex-col rounded-(--radius-card) border p-4 shadow-(--shadow-card) transition hover:shadow-md", LV[level].bg)}>
      <div className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-slate-600"><span className="inline-flex items-center gap-1.5"><Icon size={14} className="text-slate-400" /> {label}</span><Dot level={level} /></div>
      <div className={cn("mt-1 text-[22px] font-semibold leading-tight tracking-tight tabular", level === "ok" ? "text-slate-900" : LV[level].text)}>{value}</div>
      <div className="mt-1 text-xs text-slate-600">{sub}</div>
    </Link>
  );
}

/**
 * Egasi dashbordi (TZ "Owner Dashboard v2.0"). Bu ERP jadvali emas — boshqaruv ekrani:
 * 30–60 soniyada qancha topdik → qancha pul bor → qayerga ketdi → qayerda oshib ketdi → qayerda pul osilib qoldi → xavf → qaror.
 * Reyslar, nakladnoylar, sklad qatorlari bu yerda ko'rsatilmaydi (TZ §22) — har blokdan tegishli bo'limga havola.
 */
export async function OwnerHome() {
  const [d, prodReports] = await Promise.all([ownerDashboard(), reportHistory(7)]);
  const unseenReports = prodReports.filter((r) => !r.seenAt).length;
  const S = d.summary, L = d.levels;
  const worstProblem = d.problems[0];
  const problemLevel: Level = d.problems.some((p) => p.level === "crit") ? "crit" : d.problems.length ? "warn" : "ok";

  return (
    <div className="space-y-6">
      {/* ── 1. Yuqori panel: 30–60 soniya ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Top label="Tushum" value={m(S.revenue.month)} level={L.revenue} href="/bi-tahlil/sotuvlar" icon={TrendingUp}
          sub={<>bugun {m(S.revenue.today)}{S.revenue.plan ? <> · plan {m(S.revenue.plan)} <b className={LV[L.revenue].text}>{pct(S.revenue.pct ?? 0, 0)}</b></> : " · plan yo'q"}</>} />
        <Top label="Sof foyda" value={m(S.profit.month)} level={L.profit} href="/bi-tahlil/moliya" icon={Banknote}
          sub={<>bugun {m(S.profit.today)} · marja <b>{fmtNum(d.marginTotal, 1)}%</b>{S.profit.plan !== null && <> · plan {m(S.profit.plan)}</>}</>} />
        <Top label="Xarajatlar" value={m(S.expenses.month)} level={L.expenses} href="/dashboard/byudjet" icon={Wallet}
          sub={S.expenses.plan !== null ? <>byudjet {m(S.expenses.plan)} · <Dev v={S.expenses.deviation} invert /></> : <>bugun {m(S.expenses.today)} · byudjet belgilanmagan</>} />
        <Top label="Pul" value={m(S.cash.total)} level={L.cash} href="/cashflow" icon={Landmark}
          sub={<>kassa {m(S.cash.cash)} · bank {m(S.cash.bank)}{S.cash.gapDay !== null && <span className="text-red-600"> · {S.cash.gapDay} kunda uzilish</span>}</>} />
        <Top label="Debitorka" value={m(S.receivable.total)} level={L.receivable} href="/customers" icon={ClipboardList}
          sub={<>muddati o&apos;tgan <b className={S.receivable.overdue > 0 ? "text-red-600" : ""}>{m(S.receivable.overdue)}</b> · {S.receivable.debtors} mijoz</>} />
        <Top label="Muammolar" value={String(d.problems.length)} level={problemLevel} href="#qaror" icon={ShieldAlert}
          sub={worstProblem ? <span className="line-clamp-2">{worstProblem.text}</span> : "Egasi qarorini talab qiladigan masala yo'q"} />
      </div>

      {/* Ikkinchi qator: kreditorka, ishlab chiqarish, otgruzka, marja */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card className="py-3">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500"><span>Kreditorka (tasdiqlangan ta&apos;minot)</span><Dot level={L.payable} /></div>
          <div className="mt-1 text-lg font-semibold tabular">{m(S.payable.total)}</div>
          <div className="text-xs text-slate-500">7 kunda {m(S.payable.d7)}{S.payable.overdue > 0 && <span className="text-red-600"> · muddati o&apos;tgan {m(S.payable.overdue)}</span>}</div>
        </Card>
        <Card className="py-3">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500"><span>Ishlab chiqarish</span><Dot level={L.production} /></div>
          <div className="mt-1 text-lg font-semibold tabular">{qty(S.production.concreteMonth)} m³{S.production.concretePlan ? <span className="text-sm font-normal text-slate-500"> / {qty(S.production.concretePlan)}</span> : ""}</div>
          <div className="truncate text-xs text-slate-500">{S.production.pieces.length ? S.production.pieces.map((p) => `${p.code} ${qty(p.fact)}/${qty(p.plan)}`).join(" · ") : "ЖБИ plani yo'q"}{S.production.capacityPct !== null && <> · quvvat bugun {pct(S.production.capacityPct, 0)}</>}</div>
        </Card>
        <Card className="py-3">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500"><span>Otgruzka (beton)</span><Dot level={S.shipment.plan ? (S.shipment.month / S.shipment.plan >= 0.9 ? "ok" : S.shipment.month / S.shipment.plan >= 0.7 ? "warn" : "crit") : "ok"} /></div>
          <div className="mt-1 text-lg font-semibold tabular">{qty(S.shipment.month)} m³{S.shipment.plan ? <span className="text-sm font-normal text-slate-500"> / {qty(S.shipment.plan)} sotilgan</span> : ""}</div>
          <div className="text-xs text-slate-500">bugun {qty(S.shipment.today)} m³ · {S.shipment.tripsToday} reys</div>
        </Card>
        <Card className="py-3">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500"><span>Marja</span><Dot level={d.marginTotal >= 25 ? "ok" : d.marginTotal >= 15 ? "warn" : "crit"} /></div>
          <div className="mt-1 text-lg font-semibold tabular">{fmtNum(d.marginTotal, 1)}%{d.marginPlan !== null && <span className="text-sm font-normal text-slate-500"> / plan {fmtNum(d.marginPlan, 1)}%</span>}</div>
          <div className="truncate text-xs text-slate-500">{S.margin.byProduct.map((p) => `${p.code} ${fmtNum(p.margin, 0)}%`).join(" · ") || "sotuv yo'q"}</div>
        </Card>
      </div>

      {/* ── Kunlik hisobot matni (TZ §21) ── */}
      <Card className="border-l-4 border-l-brand-500">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><FileText size={17} /></div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kunlik owner report · {date(d.today)}</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-slate-800">{d.reportText}</p>
          </div>
        </div>
      </Card>

      {/* ── Ishlab chiqarishning qayd etilgan kunlik hisobotlari (sex "Qayd etish" bosganda tushadi) ── */}
      <ReportHistory rows={prodReports} current={null} title={`Ishlab chiqarish — kunlik hisobotlar${unseenReports ? ` · ${unseenReports} ta yangi` : ""}`} />

      {/* ── 15. Plan / fakt / prognoz + trend ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Plan / fakt / prognoz — joriy oy" info={`${d.wdPassed} / ${d.wdTotal} ish kuni o'tdi. Prognoz — shu kungacha bo'lgan sur'at oy oxirigacha davom etsa.`} action={more("/bi-tahlil/reja", "Reja nazorati")} padded={false}>
          <table className="w-full text-sm">
            <thead><tr><Th>Ko&apos;rsatkich</Th><Th right>Plan</Th><Th right>Fakt</Th><Th right>Prognoz (oy)</Th><Th right>Chetlanish</Th><Th className="w-40">Bajarilish</Th></tr></thead>
            <tbody>
              {[
                { label: "Tushum", plan: S.revenue.plan, fact: S.revenue.month, fc: S.revenue.forecast, invert: false, level: L.revenue },
                { label: "Sof foyda", plan: S.profit.plan, fact: S.profit.month, fc: S.profit.forecast, invert: false, level: L.profit },
                { label: "Xarajatlar", plan: S.expenses.plan, fact: S.expenses.month, fc: d.expenses.forecast, invert: true, level: L.expenses },
              ].map((r) => {
                const p = r.plan ? (r.fact / r.plan) * 100 : null;
                return (
                  <Tr key={r.label}>
                    <Td className="font-medium"><span className="inline-flex items-center gap-2"><Dot level={r.level} />{r.label}</span></Td>
                    <Td right className="tabular text-slate-500">{m(r.plan)}</Td>
                    <Td right className="tabular font-semibold">{m(r.fact)}</Td>
                    <Td right className="tabular">{m(r.fc)}</Td>
                    <Td right><Dev v={r.plan !== null ? r.fc - r.plan : null} invert={r.invert} /></Td>
                    <Td>{p === null ? <span className="text-xs text-slate-400">plan yo&apos;q</span> : <><div className="mb-1 text-right text-[11px] tabular text-slate-500">{pct(p, 0)}</div><Progress value={Math.min(p, 100)} max={100} tone={r.invert ? (p >= d.thresholds.crit ? "danger" : p >= d.thresholds.warn ? "warning" : "success") : (p >= 90 ? "success" : p >= 70 ? "warning" : "danger")} /></>}</Td>
                  </Tr>
                );
              })}
              <Tr>
                <Td className="font-medium"><span className="inline-flex items-center gap-2"><Dot level={L.production} />Beton, m³</span></Td>
                <Td right className="tabular text-slate-500">{S.production.concretePlan ? qty(S.production.concretePlan) : "—"}</Td>
                <Td right className="tabular font-semibold">{qty(S.production.concreteMonth)}</Td>
                <Td right className="tabular">{qty(d.wdPassed ? (S.production.concreteMonth / d.wdPassed) * d.wdTotal : 0)}</Td>
                <Td right><Dev v={S.production.concretePlan ? (d.wdPassed ? (S.production.concreteMonth / d.wdPassed) * d.wdTotal : 0) - S.production.concretePlan : null} unit="m³" /></Td>
                <Td>{S.production.concretePlan ? <Progress value={Math.min(100, (S.production.concreteMonth / S.production.concretePlan) * 100)} max={100} tone={L.production === "ok" ? "success" : L.production === "warn" ? "warning" : "danger"} /> : <span className="text-xs text-slate-400">plan yo&apos;q</span>}</Td>
              </Tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="Dinamika — 3 oy" info="Tushum, foyda va xarajat oylar bo'yicha; pastda 30/60/90 kunlik o'sish oldingi shunday davrga nisbatan.">
          <LineChart labels={d.trend.map((t) => t.label)} series={[{ name: "Tushum", values: d.trend.map((t) => t.revenue), color: "#0d78ff" }, { name: "Foyda", values: d.trend.map((t) => t.profit), color: "#00cb80" }, { name: "Xarajat", values: d.trend.map((t) => t.expenses), color: "#fa1636", dashed: true }]} height={150} formatValue={(v) => moneyShort(v)} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {d.dyn.map((x) => (
              <div key={x.days} className="rounded-lg bg-slate-50 px-2 py-2">
                <div className="text-[11px] text-slate-500">{x.days} kun</div>
                <div className="text-sm font-semibold tabular">{moneyShort(x.revenue)}</div>
                <div className={cn("text-xs tabular", x.delta === null ? "text-slate-400" : x.delta >= 0 ? "text-emerald-700" : "text-red-600")}>{x.delta === null ? "—" : `${x.delta >= 0 ? "▲" : "▼"} ${fmtNum(Math.abs(x.delta), 0)}%`}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-slate-500">Beton: {d.trend.map((t) => `${t.label} ${qty(t.production)} m³`).join(" · ")}</div>
        </Panel>
      </div>

      {/* ── 3. Foyda + 2. Cash flow | 4. Xarajatlar ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Panel title="Foyda" info="Tannarx — retsept × xomashyo o'rtacha kirim narxi. Operatsion xarajat — Kirim-Chiqimdagi chiqimlar, xomashyodan tashqari (u tannarxda). Plan — sotuv plani va byudjetdan." padded={false} action={more("/bi-tahlil/moliya", "Moliya")}>
            <table className="w-full text-sm">
              <thead><tr><Th>Ko&apos;rsatkich</Th><Th right>Bugun</Th><Th right>Oy</Th><Th right>Plan</Th><Th right>±</Th></tr></thead>
              <tbody>
                {d.profitTable.map((r) => (
                  <Tr key={r.key} className={r.key === "gross" || r.key === "net" ? "bg-slate-50/70 font-semibold" : ""}>
                    <Td>{r.label}</Td>
                    <Td right className="tabular">{m(r.today)}</Td>
                    <Td right className={cn("tabular", r.key === "net" && (r.month < 0 ? "text-red-600" : "text-emerald-700"))}>{m(r.month)}</Td>
                    <Td right className="tabular text-slate-500">{m(r.plan)}</Td>
                    <Td right><Dev v={r.deviation} invert={r.invert} /></Td>
                  </Tr>
                ))}
                <Tr><Td>Marja, %</Td><Td right className="tabular">—</Td><Td right className="tabular font-semibold">{fmtNum(d.marginTotal, 1)}%</Td><Td right className="tabular text-slate-500">{d.marginPlan !== null ? `${fmtNum(d.marginPlan, 1)}%` : "—"}</Td><Td right>{d.marginPlan !== null ? <Dev v={d.marginTotal - d.marginPlan} unit="%" /> : "—"}</Td></Tr>
              </tbody>
            </table>
          </Panel>

          <Panel title="Pul va cash flow" info="Kun boshi qoldig'i = hozirgi qoldiq − bugungi kirim + bugungi chiqim. Yaqin to'lovlar — ma'sul xodim tasdiqlagan, moliya hali to'lamagan ta'minot zayavkalari. Uzilish prognozi: o'rtacha kunlik tushum (30 kun) va chiqim (joriy oy) bo'yicha." action={more("/cashflow", "Kirim-Chiqim")}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["Kun boshi", d.cashflow.startOfDay], ["Kirim (bugun)", d.cashflow.inToday], ["Chiqim (bugun)", -d.cashflow.outToday], ["Kun oxiri (hozir)", d.cashflow.endOfDay]].map(([k, v]) => (
                <div key={k as string} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[11px] text-slate-500">{k as string}</div><div className={cn("text-sm font-semibold tabular", (v as number) < 0 ? "text-red-600" : "")}>{(v as number) < 0 ? "−" : ""}{moneyShort(Math.abs(v as number))}</div></div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              {d.cashflow.accounts.map((a) => <span key={a.id}>{a.type === "CASH" ? "Kassa" : "Bank"} · {a.name}: <b className="tabular text-slate-900">{moneyShort(a.balance)}</b></span>)}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Yaqin to&apos;lovlar</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[["7 kun", d.cashflow.planned.d7], ["14 kun", d.cashflow.planned.d14], ["30 kun", d.cashflow.planned.d30]].map(([k, v]) => <div key={k as string} className="rounded-lg border border-slate-200 py-1.5"><div className="text-[11px] text-slate-500">{k as string}</div><div className="text-sm font-semibold tabular">{moneyShort(v as number)}</div></div>)}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Kassa uzilishi prognozi</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {d.cashflow.gap.map((g) => <div key={g.days} className={cn("rounded-lg border py-1.5", g.balance < 0 ? "border-red-200 bg-red-50" : "border-slate-200")}><div className="text-[11px] text-slate-500">{g.days} kun</div><div className={cn("text-sm font-semibold tabular", g.balance < 0 ? "text-red-600" : "text-emerald-700")}>{g.balance < 0 ? "−" : ""}{moneyShort(Math.abs(g.balance))}</div></div>)}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Top tushumlar (oy)</div>
                {d.cashflow.topIn.length === 0 ? <div className="text-xs text-slate-400">yo&apos;q</div> : <ul className="space-y-1">{d.cashflow.topIn.map((p) => <li key={p.id} className="flex justify-between gap-2"><Link href={p.href} className="truncate hover:underline">{p.who}</Link><span className="shrink-0 tabular text-emerald-700">+{moneyShort(p.amount)}</span></li>)}</ul>}
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Top chiqimlar (oy)</div>
                {d.cashflow.topOut.length === 0 ? <div className="text-xs text-slate-400">yo&apos;q</div> : <ul className="space-y-1">{d.cashflow.topOut.map((t) => <li key={t.id} className="flex justify-between gap-2"><Link href={t.href} className="truncate hover:underline">{t.who} <span className="text-slate-400">· {t.category}</span></Link><span className="shrink-0 tabular text-red-600">−{moneyShort(t.amount)}</span></li>)}</ul>}
              </div>
            </div>
          </Panel>
        </div>

        {/* 4/6. Xarajatlar va byudjet nazorati */}
        <Panel title="Xarajatlar va byudjet nazorati" info="Har kategoriya: bugun, oy, byudjet, chetlanish, holat. Kategoriya bosilsa Kirim-Chiqimda detalizatsiya (sana → summa → kontragent → hisob → kim kiritgan)." padded={false}
          action={<><span className="text-slate-500">Xarajat / tushum: <b className={cn("tabular", d.expenses.ratio > 80 ? "text-red-600" : "text-slate-900")}>{fmtNum(d.expenses.ratio, 0)}%</b></span>{more("/dashboard/byudjet", "Byudjet")}</>}>
          <div className="max-h-[26rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Kategoriya</Th><Th right>Bugun</Th><Th right>Oy</Th><Th right>Byudjet</Th><Th right>±</Th><Th right>Prognoz</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {d.expenses.categories.filter((c) => c.month > 0 || c.plan).map((c) => (
                  <Tr key={c.cat}>
                    <Td><Link href={`/cashflow?tab=EXPENSE&category=${encodeURIComponent(c.cat)}`} className="font-medium hover:underline">{c.cat}</Link>{c.by && c.level !== "ok" && <div className="text-[11px] text-slate-400">{c.by} · {c.count} yozuv</div>}</Td>
                    <Td right className="tabular">{c.day ? moneyShort(c.day) : "—"}</Td>
                    <Td right className="tabular font-medium">{moneyShort(c.month)}</Td>
                    <Td right className="tabular text-slate-500">{c.plan !== null ? moneyShort(c.plan) : <span className="text-amber-600">yo&apos;q</span>}</Td>
                    <Td right><Dev v={c.deviation} invert /></Td>
                    <Td right className={cn("tabular", c.forecastOver ? "text-amber-700" : "text-slate-500")}>{moneyShort(c.forecast)}</Td>
                    <Td><span className="inline-flex items-center gap-1.5"><Dot level={c.level} /><span className="text-xs">{c.unplanned ? "Rejasiz" : c.anomaly ? "Anomal" : LEVEL_LABEL[c.level]}</span></span></Td>
                  </Tr>
                ))}
                {d.expenses.categories.every((c) => !c.month && !c.plan) && <tr><Td colSpan={7} className="py-6 text-center text-slate-500">Bu oyda chiqim yo&apos;q va byudjet belgilanmagan — <Link href="/dashboard/byudjet" className="underline">byudjet qo&apos;ying</Link>.</Td></tr>}
                <tr className="bg-slate-50 font-semibold"><Td>Jami</Td><Td right className="tabular">{moneyShort(S.expenses.today)}</Td><Td right className="tabular">{moneyShort(S.expenses.month)}</Td><Td right className="tabular text-slate-500">{m(S.expenses.plan)}</Td><Td right><Dev v={S.expenses.deviation} invert /></Td><Td right className="tabular">{moneyShort(d.expenses.forecast)}</Td><Td><Dot level={L.expenses} /></Td></tr>
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 px-5 py-4 text-sm md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Top-10 xarajat (oy)</div>
              {d.expenses.top10.length === 0 ? <div className="text-xs text-slate-400">yo&apos;q</div> : (
                <ol className="space-y-1">
                  {d.expenses.top10.map((t, i) => <li key={t.id} className="flex justify-between gap-2"><span className="truncate"><span className="text-slate-400">{i + 1}.</span> <Link href={t.href} className="hover:underline">{t.who}</Link> <span className="text-slate-400">· {t.category} · {t.by}</span></span><span className="shrink-0 tabular font-medium">{moneyShort(t.amount)}</span></li>)}
                </ol>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Rejalashtirilmagan</div>
                {d.expenses.unplanned.length === 0 ? <div className="text-xs text-emerald-700">Hamma xarajat byudjet ichida</div> : <ul className="space-y-1">{d.expenses.unplanned.map((c) => <li key={c.cat} className="flex justify-between gap-2"><span>{c.cat} <span className="text-slate-400">· {c.by}</span></span><span className="tabular text-amber-700">{moneyShort(c.month)}</span></li>)}</ul>}
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Anomal (3 oy o&apos;rtachasidan 1,5× ko&apos;p)</div>
                {d.expenses.anomalies.length === 0 ? <div className="text-xs text-slate-400">yo&apos;q</div> : <ul className="space-y-1">{d.expenses.anomalies.map((c) => <li key={c.cat} className="flex justify-between gap-2"><span>{c.cat}</span><span className="tabular"><span className="text-red-600">{moneyShort(c.month)}</span> <span className="text-slate-400">/ odatda {moneyShort(c.histAvg ?? 0)}</span></span></li>)}</ul>}
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Byudjetdan oshgan</div>
                {d.expenses.overspent.length === 0 ? <div className="text-xs text-emerald-700">yo&apos;q</div> : <ul className="space-y-1">{d.expenses.overspent.map((c) => <li key={c.cat} className="flex justify-between gap-2"><span>{c.cat} <span className="text-slate-400">· {c.by ?? "—"}</span></span><span className="tabular text-red-600">+{moneyShort(c.deviation ?? 0)}</span></li>)}</ul>}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── 7. Ishlab chiqarish | 8. Voronka ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Ishlab chiqarish" info="Plan — direktor belgilagan oylik plan (Ishlab chiqarish bosh sahifasi). Fakt — zames (beton) va brigada qaydlari (ЖБИ). Tannarx va marja — retsept bo'yicha." padded={false} action={more("/dashboard?view=production", "Ishlab chiqarish")}>
          <table className="w-full text-sm">
            <thead><tr><Th>Mahsulot</Th><Th right>Bugun</Th><Th right>Oy fakt</Th><Th right>Plan</Th><Th right>Orqada</Th><Th className="w-32">Bajarilish</Th></tr></thead>
            <tbody>
              {d.production.rows.length === 0 && <tr><Td colSpan={6} className="py-5 text-center text-slate-500">Bu oyga ishlab chiqarish plani belgilanmagan — <Link href="/dashboard?view=production" className="underline">plan qo&apos;ying</Link>. Beton fakt: {qty(S.production.concreteMonth)} m³.</Td></tr>}
              {d.production.rows.map((r) => (
                <Tr key={r.id}>
                  <Td><span className="font-medium">{r.code}</span> <span className="text-slate-500">{r.name}</span></Td>
                  <Td right className="tabular">{qty(r.factDay)} {unitLabel(r.unit)}</Td>
                  <Td right className="tabular font-medium">{qty(r.fact)}</Td>
                  <Td right className="tabular text-slate-500">{qty(r.plan)}</Td>
                  <Td right className={cn("tabular", r.behind > 0 ? "text-red-600" : "text-emerald-700")}>{r.behind > 0 ? `−${qty(r.behind)}` : "✓"}</Td>
                  <Td><Progress value={Math.min(100, r.pct ?? 0)} max={100} tone={r.level === "ok" ? "success" : r.level === "warn" ? "warning" : "danger"} /></Td>
                </Tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 px-5 py-4 text-sm md:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><Gauge size={12} /> Quvvat yuklanishi</div>
              {d.production.capacity ? <><div className="text-lg font-semibold tabular">{pct(d.production.capacityPct ?? 0, 0)}</div><Progress value={Math.min(100, d.production.capacityPct ?? 0)} max={100} tone={(d.production.capacityPct ?? 0) >= 70 ? "success" : "warning"} /><div className="mt-1 text-xs text-slate-500">bugun {qty(S.production.concreteToday)} / {qty(d.production.capacity)} m³ kunlik quvvat</div></> : <div className="text-xs text-slate-400">Kunlik quvvat sozlamalarda yo&apos;q</div>}
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Tannarx va marja (oy sotuvi)</div>
              <ul className="space-y-1">
                {d.production.unitCosts.slice(0, 5).map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{p.code} <span className="text-slate-400">· {p.unitCost !== null ? `${moneyShort(p.unitCost)} / ${unitLabel(p.unit)}` : "retsept yo'q"}</span></span><span className={cn("tabular font-medium", p.margin >= 25 ? "text-emerald-700" : p.margin >= 15 ? "text-amber-700" : "text-red-600")}>{fmtNum(p.margin, 0)}%</span></li>)}
                {d.production.unitCosts.length === 0 && <li className="text-xs text-slate-400">oyda sotuv yo&apos;q</li>}
              </ul>
            </div>
          </div>
        </Panel>

        <Panel title="Zayavka → ishlab chiqarish → yetkazildi → to'landi" info="Joriy oyda qabul qilingan zayavkalar bosqichlar bo'yicha: soni va summasi. Pastda osilib qolganlar — yetkazish sanasi o'tgan zayavkalar va to'lanmagan otgruzkalar." action={more("/sales", "Sotuv")}>
          <div className="grid grid-cols-5 gap-1.5">
            {d.funnel.stages.map((st, i) => {
              const base = d.funnel.stages[0].sum || 1;
              return (
                <Link key={st.key} href={st.href} className="rounded-lg border border-slate-200 p-2 text-center hover:border-slate-300">
                  <div className="text-[11px] leading-tight text-slate-500">{st.label}</div>
                  <div className="mt-1 text-base font-semibold tabular">{st.count}</div>
                  <div className="text-[11px] tabular text-slate-600">{moneyShort(st.sum)}</div>
                  <div className="mt-1.5 h-1 rounded-full bg-slate-100"><div className={cn("h-1 rounded-full", i === 4 ? "bg-emerald-500" : "bg-brand-500")} style={{ width: `${Math.min(100, (st.sum / base) * 100)}%` }} /></div>
                </Link>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><AlertTriangle size={12} className="text-amber-500" /> Muddati o&apos;tgan zayavkalar ({d.funnel.stuck.length})</div>
              {d.funnel.stuck.length === 0 ? <div className="text-xs text-emerald-700">yo&apos;q</div> : <ul className="space-y-1">{d.funnel.stuck.slice(0, 6).map((o) => <li key={o.id} className="flex justify-between gap-2"><Link href={`/orders/${o.id}`} className="truncate hover:underline">{o.orderNo} · {o.customer}</Link><span className="shrink-0 text-red-600">{o.days} kun · {moneyShort(o.sum)}</span></li>)}</ul>}
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">To&apos;lanmagan otgruzka ({d.funnel.unpaidShipments.length})</div>
              {d.funnel.unpaidShipments.length === 0 ? <div className="text-xs text-emerald-700">yo&apos;q</div> : <ul className="space-y-1">{d.funnel.unpaidShipments.slice(0, 6).map((o) => <li key={o.id} className="flex justify-between gap-2"><Link href={`/customers/${o.customerId}`} className="truncate hover:underline">{o.orderNo} · {o.customer}</Link><span className="shrink-0 tabular text-amber-700">{moneyShort(o.left)}</span></li>)}</ul>}
            </div>
          </div>
        </Panel>
      </div>

      {/* ── 9. Debitorka / kreditorka | 10. Sklad ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Debitorka va kreditorka" info={`Muddati o'tgan — ${d.thresholds.overdue} kundan eski ochiq schyotlar. Kreditorka — tasdiqlangan, hali to'lanmagan ta'minot zayavkalari.`} action={more("/customers", "Mijozlar")}>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[["0–7 kun", 0], ["8–30", 1], ["31–60", 2], ["60+", 3]].map(([k, i]) => <div key={k as string} className={cn("rounded-lg border py-2", (i as number) >= 2 && d.debt.aging[i as number] > 0 ? "border-red-200 bg-red-50" : "border-slate-200")}><div className="text-[11px] text-slate-500">{k as string}</div><div className="text-sm font-semibold tabular">{moneyShort(d.debt.aging[i as number])}</div></div>)}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Top qarzdorlar</div>
              {d.debt.topDebtors.length === 0 ? <div className="text-xs text-emerald-700">qarz yo&apos;q</div> : <ul className="space-y-1">{d.debt.topDebtors.slice(0, 7).map((c) => <li key={c.id} className="flex justify-between gap-2"><Link href={`/customers/${c.id}`} className="truncate hover:underline">{c.name}</Link><span className="shrink-0 tabular">{moneyShort(c.debt)}{c.overdue > 0 && <span className="text-red-600"> · {c.oldest} kun</span>}</span></li>)}</ul>}
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Kreditorka · yaqin to&apos;lovlar</div>
              {d.debt.payable.rows.length === 0 ? <div className="text-xs text-slate-400">tasdiq kutayotgan ta&apos;minot yo&apos;q</div> : <ul className="space-y-1">{d.debt.payable.rows.slice(0, 6).map((r) => <li key={r.id} className="flex justify-between gap-2"><Link href={`/taminot/${r.id}`} className="truncate hover:underline">{r.supplier} <span className="text-slate-400">· {r.docNo}</span></Link><span className={cn("shrink-0 tabular", r.overdue ? "text-red-600" : "")}>{moneyShort(r.amount)}{r.needBy && <span className="text-slate-400"> · {date(r.needBy)}</span>}</span></li>)}</ul>}
              {d.debt.topSuppliers.length > 0 && <div className="mt-3 text-xs text-slate-500">Eng katta yetkazuvchilar (oy): {d.debt.topSuppliers.map((s) => `${s.name} ${moneyShort(s.value)}`).join(" · ")}</div>}
            </div>
          </div>
        </Panel>

        <Panel title="Sklad va xomashyo" info={`Kunlar — hozirgi qoldiq so'nggi 30 kun o'rtacha sarfida necha kunga yetadi. ${d.thresholds.stockCrit} kundan kam — kritik (to'xtash xavfi), ${d.thresholds.stockWarn} kundan kam — e'tibor. Normadan chetlanish — fakt sarf / retsept bo'yicha kerak bo'lgani.`} padded={false} action={more("/stock", "Sklad")}>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-2 text-xs text-slate-600">
            <span>Qoldiq qiymati: <b className="tabular text-slate-900">{moneyShort(d.stock.value)}</b></span>
            {d.stock.minDays && <span>Eng avval tugaydi: <b className={cn(d.stock.minDays.days < d.thresholds.stockCrit ? "text-red-600" : "text-slate-900")}>{d.stock.minDays.name} — {fmtNum(d.stock.minDays.days, 1)} kun</b></span>}
            {d.production.materialOverspend > 0 && <span>Ortiqcha sarf: <b className="tabular text-red-600">{moneyShort(d.production.materialOverspend)}</b></span>}
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Xomashyo</Th><Th right>Qoldiq</Th><Th right>Qiymat</Th><Th right>Sarf/kun</Th><Th right>Yetadi</Th><Th right>Normadan</Th><Th /></tr></thead>
              <tbody>
                {d.stock.rows.slice(0, 12).map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td right className={cn("tabular", r.balance < r.minStock && "text-amber-700")}>{qty(r.balance)} <span className="text-slate-400">{r.unit}</span></Td>
                    <Td right className="tabular text-slate-500">{moneyShort(r.value)}</Td>
                    <Td right className="tabular text-slate-500">{r.perDay > 0 ? fmtNum(r.perDay, 1) : "—"}</Td>
                    <Td right className={cn("tabular font-semibold", r.level === "crit" ? "text-red-600" : r.level === "warn" ? "text-amber-700" : "")}>{r.days === null ? "—" : r.days > 999 ? ">999" : `${fmtNum(r.days, 1)} kun`}</Td>
                    <Td right className={cn("tabular", r.normDev === null ? "text-slate-400" : r.normDev > 5 ? "text-red-600" : "text-slate-600")}>{r.normDev === null ? "—" : `${r.normDev > 0 ? "+" : ""}${fmtNum(r.normDev, 0)}%`}</Td>
                    <Td><Dot level={r.level} title={r.short ? "Zayavkalarga yetmaydi" : undefined} /></Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* ── 11. Transport | 12. Pul oqib ketishi ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Transport va texnika" info="Holat (ta'mirda / bekor) — logistika Haydovchilar sahifasida belgilaydi. Bekor turish narxi — oylik tushumning bir texnikaga to'g'ri keladigan kunlik ulushi × texnika-kun (taxmin). Yoqilg'i normasi — byudjetdagi «Transport / yoqilg'i»." action={more("/drivers", "Haydovchilar")}>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[["Jami", d.transport.total, "ok"], ["Ishda", d.transport.working, "ok"], ["Ta'mirda", d.transport.repair.length, d.transport.repair.length ? "warn" : "ok"], ["Bekor", d.transport.idle.length, d.transport.idle.length ? "warn" : "ok"]].map(([k, v, lv]) => <div key={k as string} className={cn("rounded-lg border py-2", LV[lv as Level].bg)}><div className="text-[11px] text-slate-500">{k as string}</div><div className="text-base font-semibold tabular">{v as number}</div></div>)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            <div><div className="text-[11px] text-slate-500">Reyslar bugun / oy</div><div className="font-medium tabular">{d.transport.tripsToday} / {d.transport.tripsMonth}</div></div>
            <div><div className="text-[11px] text-slate-500">O&apos;rtacha m³ / reys</div><div className="font-medium tabular">{fmtNum(d.transport.avgM3, 1)}</div></div>
            <div><div className="text-[11px] text-slate-500">Bo&apos;sh (saflda)</div><div className="font-medium tabular">{d.transport.free}</div></div>
            <div><div className="text-[11px] text-slate-500">Yoqilg&apos;i fakt / norma</div><div className={cn("font-medium tabular", d.transport.fuelOver > 0 && "text-red-600")}>{moneyShort(d.transport.fuelFact)} / {d.transport.fuelNorm !== null ? moneyShort(d.transport.fuelNorm) : "—"}</div></div>
            <div><div className="text-[11px] text-slate-500">Ta&apos;mir xarajati (oy)</div><div className="font-medium tabular">{moneyShort(d.transport.repairFact)}</div></div>
            <div><div className="text-[11px] text-slate-500">Bekor turish narxi</div><div className={cn("font-medium tabular", d.transport.idleCost > 0 && "text-amber-700")}>{d.transport.idleDays ? `≈ ${moneyShort(d.transport.idleCost)}` : "—"}</div></div>
          </div>
          {(d.transport.repair.length > 0 || d.transport.idle.length > 0) && (
            <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
              {[...d.transport.repair, ...d.transport.idle].map((v) => <li key={v.id} className="flex justify-between gap-2"><span><Truck size={13} className="mr-1 inline text-slate-400" /><b>{v.plate}</b> <span className="text-slate-500">· {v.statusNote ?? "sabab yozilmagan"}</span></span><Badge color={v.status === "REPAIR" ? "red" : "amber"}>{v.status === "REPAIR" ? "Ta'mirda" : "Bekor"}{v.statusSince ? ` · ${date(v.statusSince)} dan` : ""}</Badge></li>)}
            </ul>
          )}
        </Panel>

        <Panel title="Pul qayerdan oqib ketyapti" info="Joriy oy. Aniq raqamlar (brak, byudjetdan oshish, takroriy to'lov) va taxminlar (bekor turish narxi). Har qator tegishli bo'limga olib boradi." action={<span className="text-slate-500">Jami <b className="tabular text-red-600">{moneyShort(d.leaks.total)}</b></span>}>
          <HBarList data={d.leaks.rows.filter((l) => l.amount > 0).map((l) => ({ label: l.title, value: l.amount, tone: (l.level === "crit" ? "danger" : "warning") as "danger" | "warning", sub: l.text }))} formatValue={(v) => moneyShort(v)} />
          {d.leaks.rows.every((l) => l.amount === 0) && <div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} /> Bu oyda aniqlangan yo&apos;qotish yo&apos;q.</div>}
          <ul className="mt-3 grid grid-cols-1 gap-1 text-xs text-slate-500 sm:grid-cols-2">
            {d.leaks.rows.filter((l) => l.amount === 0).map((l) => <li key={l.key} className="flex items-center gap-1.5"><Dot level="ok" /> {l.title}: {l.text}</li>)}
          </ul>
        </Panel>
      </div>

      {/* ── 14. Egasi qarori kerak | 13. Direktor nazorati ── */}
      <div id="qaror" className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title={<span className="inline-flex items-center gap-2"><ShieldAlert size={16} className="text-red-500" /> Egasi qarorini talab qiladi</span>} info="Avtomatik: byudjet oshishi, kassa uzilishi, katta muddati o'tgan qarz, texnika ta'miri, rejalashtirilmagan xarajat, xomashyo tugashi, takroriy to'lov. Summa bo'yicha, kritik birinchi." padded={false}>
          {d.decisions.length === 0 ? <div className="flex items-center gap-2 px-5 py-8 text-sm text-emerald-700"><CheckCircle2 size={18} /> Hozir egasi qarorini talab qiladigan masala yo&apos;q.</div> : (
            <table className="w-full text-sm">
              <thead><tr><Th>Muammo</Th><Th right>Summa / ta&apos;sir</Th><Th>Javobgar</Th><Th>Muddat</Th><Th>Qaror</Th><Th /></tr></thead>
              <tbody>
                {d.decisions.slice(0, 8).map((x) => (
                  <Tr key={x.key}>
                    <Td><span className="inline-flex items-start gap-2"><Dot level={x.level} /><span className="font-medium">{x.problem}</span></span></Td>
                    <Td right><div className="font-semibold tabular">{x.amount > 0 ? moneyShort(x.amount) : "—"}</div><div className="text-[11px] text-slate-500">{x.effect}</div></Td>
                    <Td className="text-slate-600">{x.owner}</Td>
                    <Td className={cn("whitespace-nowrap", x.due === "bugun" ? "font-medium text-red-600" : "text-slate-600")}>{x.due}</Td>
                    <Td className="text-slate-600">{x.decision}</Td>
                    <Td><Link href={x.href} className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800">Ochish</Link></Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel className="xl:col-span-2" title="Direktor nazorati — plan / fakt" info="Egasi natijani emas, direktorning tasdiqlangan planni bajarishini ham ko'radi. Teskari ko'rsatkichlarda (xarajat, brak, bekor turish) plan = 0 yoki byudjet." padded={false} action={more("/dashboard/byudjet", <><Sliders size={13} className="inline" /> Chegaralar</>)}>
          <table className="w-full text-sm">
            <thead><tr><Th>Ko&apos;rsatkich</Th><Th right>Plan</Th><Th right>Fakt</Th><Th right>%</Th><Th /></tr></thead>
            <tbody>
              {d.directorControl.map((r) => (
                <Tr key={r.label}>
                  <Td><Link href={r.href} className="hover:underline">{r.label}</Link></Td>
                  <Td right className="tabular text-slate-500">{r.plan === null ? "—" : r.unit === "so'm" ? moneyShort(r.plan) : `${qty(r.plan)} ${r.unit}`}</Td>
                  <Td right className="tabular font-medium">{r.unit === "so'm" ? moneyShort(r.fact) : `${qty(r.fact)} ${r.unit}`}</Td>
                  <Td right className="tabular text-slate-500">{r.pct === null ? "—" : pct(r.pct, 0)}</Td>
                  <Td right><Lvl level={r.level} /></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span className="inline-flex items-center gap-3"><span className="inline-flex items-center gap-1"><Dot level="ok" /> Norma</span><span className="inline-flex items-center gap-1"><Dot level="warn" /> E&apos;tibor — chetlanish nazorat talab qiladi</span><span className="inline-flex items-center gap-1"><Dot level="crit" /> Kritik — limit oshdi, to&apos;xtash yoki kassa uzilishi xavfi</span></span>
        <span className="inline-flex items-center gap-3"><Link href="/dashboard/byudjet" className="hover:text-slate-700">Byudjet va chegaralar</Link><Link href="/dashboard?view=production" className="hover:text-slate-700"><Factory size={12} className="inline" /> Ishlab chiqarish</Link><Link href="/bi-tahlil" className="hover:text-slate-700"><Boxes size={12} className="inline" /> BI tahlil</Link><Link href="/dashboard/hisobot" className="hover:text-slate-700"><TrendingDown size={12} className="inline" /> Kunlik hisobot</Link></span>
      </div>
    </div>
  );
}
