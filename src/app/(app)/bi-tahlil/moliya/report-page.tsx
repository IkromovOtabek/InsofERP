import { ArrowDownCircle, ArrowUpCircle, Banknote, Calculator, FileWarning, Landmark, Percent, PiggyBank, Receipt, Scale, TrendingUp, Wallet } from "lucide-react";
import { delta, goLiveDate } from "@/lib/bi/core";
import { pnlReport } from "@/lib/fin-report/pnl";
import { ddsReport } from "@/lib/fin-report/dds";
import { balanceReport } from "@/lib/fin-report/balance";
import { type MonthKey, addMonths, isMonthKey, monthDiff, monthKeyOf, monthLabel, monthRange } from "@/lib/fin-report/period";
import type { FinRow } from "@/lib/fin-report/rows";
import { moneyShort, pct } from "@/lib/format";
import { biContext, BiPage, type SP } from "../shell";
import { Kpi } from "../ui";
import { FinReportView, type ReportTab } from "../../moliya/report-view";

/**
 * Tahlil → Moliya bo'limining sahifalari: «Tahlil» (`/bi-tahlil/moliya`) va «Insof 2026» jadvalidagi rasmiy hisobotlar —
 * Foyda va zarar (`/pnl`), Pul oqimi (`/dds`), Balans (`/balans`), To'lov kalendari va To'lov rejasi, Mahsulot foydasi va
 * Tannarx hisobi. Ular orasida o'tish — sidebar'da «Moliya» ostida (`lib/nav.ts`).
 */
export type MoliyaKey = "tahlil" | ReportTab | "ish-haqi" | "kalendar" | "tolov-rejasi" | "mahsulot-foydasi" | "tannarx";
const BASE = "/bi-tahlil/moliya";
export const MOLIYA_LINKS: { key: MoliyaKey; label: string; href: string }[] = [
  { key: "tahlil", label: "Tahlil", href: BASE },
  { key: "pnl", label: "Foyda va zarar (PNL)", href: `${BASE}/pnl` },
  { key: "dds", label: "Pul oqimi (DDS)", href: `${BASE}/dds` },
  { key: "balans", label: "Balans (BSH)", href: `${BASE}/balans` },
  { key: "ish-haqi", label: "Ish haqi vedomosti", href: `${BASE}/ish-haqi` },
  { key: "kalendar", label: "To'lov kalendari", href: `${BASE}/kalendar` },
  { key: "tolov-rejasi", label: "To'lov rejasi", href: `${BASE}/tolov-rejasi` },
  { key: "mahsulot-foydasi", label: "Mahsulot foydasi", href: `${BASE}/mahsulot-foydasi` },
  { key: "tannarx", label: "Tannarx hisobi", href: `${BASE}/tannarx` },
];

/** Hisobot davri — `FinReportView` bilan aynan bir xil (`oy`, `n`, sukut: tizimga o'tilgan oydan), KPI jadval bilan bir raqam bersin. */
async function reportMonths(sp: SP): Promise<MonthKey[]> {
  const now = monthKeyOf(new Date());
  const live = await goLiveDate();
  const liveKey = live ? monthKeyOf(live) : addMonths(now, -2);
  const defN = Math.min(12, Math.max(1, monthDiff(liveKey, now) + 1));
  const n = Math.min(12, Math.max(1, Number(sp.n) || defN));
  const from: MonthKey = isMonthKey(sp.oy) ? sp.oy : addMonths(now, -(n - 1));
  return monthRange(from, n);
}

const rowOf = (rows: FinRow[], key: string) => rows.find((r) => r.key === key);
/** Qatorning davr jami (PNL/DDS) — yo'q bo'lsa 0. */
const totalOf = (rows: FinRow[], key: string) => rowOf(rows, key)?.total ?? 0;
/** Balans qatorining `i`-ustuni (0 — davr boshi, oxirgisi — oxirgi oy oxiri). */
const valueAt = (rows: FinRow[], key: string, i: number) => rowOf(rows, key)?.values[i] ?? 0;
const signTone = (v: number) => (v >= 0 ? "success" : "danger");

/** Hisobot ustidagi statistika qatori — jadval bilan bir xil hisob (`cache`: jadval qayta hisoblamaydi). */
async function ReportKpis({ tab, sp }: { tab: ReportTab; sp: SP }) {
  const months = await reportMonths(sp);
  const period = months.length > 1 ? `${monthLabel(months[0]!)} — ${monthLabel(months[months.length - 1]!)}` : monthLabel(months[0]!);
  const grid = "grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 [&>*]:min-w-0";

  /** Karta bosilsa — jadval qatorining manba paneli (`m` — oy; berilmasa davr jami). */
  const dq = (t: ReportTab, key: string, m?: MonthKey) => `${BASE}/${t}?${new URLSearchParams({ ...(sp.oy ? { oy: sp.oy } : {}), ...(sp.n ? { n: sp.n } : {}), ...(sp.mode === "cash" ? { mode: "cash" } : {}), drill: key, ...(m ? { m } : {}) })}`;

  if (tab === "pnl") {
    const cash = sp.mode === "cash";
    const { rows } = await pnlReport(months, cash ? "cash" : "accrual");
    const income = totalOf(rows, "income"), cogs = -totalOf(rows, "cogs"), gross = totalOf(rows, "gross"), net = totalOf(rows, "net");
    const expenses = -["prod", "admin", "comm", "unknown", "tax", "interest"].reduce((s, k) => s + totalOf(rows, k), 0);
    const netPct = rowOf(rows, "net-pct")?.total ?? null, grossPct = rowOf(rows, "gross-pct")?.total ?? null, cogsPct = rowOf(rows, "cogs-pct")?.total ?? null;
    const uncosted = totalOf(rows, "uncosted");
    return (
      <div className={grid}>
        <Kpi label="Daromad" value={moneyShort(income)} icon={TrendingUp} tone="brand" hint={`${period} · ${cash ? "pul asosida" : "QQSsiz"}`} href={dq("pnl", "income")} />
        <Kpi label="Sotuv tannarxi" value={moneyShort(cogs)} icon={Calculator} tone="info" hint={cogsPct !== null ? `daromadning ${pct(cogsPct)}` : "daromad yo'q"} href={dq("pnl", "cogs")} />
        <Kpi label="Yalpi foyda" value={moneyShort(gross)} icon={Wallet} tone={signTone(gross)} hint={grossPct !== null ? `marja ${pct(grossPct)}` : undefined} href={dq("pnl", "gross")} />
        <Kpi label="Xarajatlar" value={moneyShort(expenses)} icon={Receipt} tone="warning" hint="ishlab chiqarish, ma'muriy, tijoriy, soliq, foiz" href={dq("pnl", "expenses")} />
        <Kpi label="Zavod sof foydasi" value={moneyShort(net)} icon={PiggyBank} tone={signTone(net)} hint={period} href={dq("pnl", "net")} />
        <Kpi label="Sof rentabellik" value={netPct !== null ? pct(netPct) : "–"} icon={Percent} tone={netPct === null ? "default" : signTone(netPct)} hint={uncosted > 0 ? `tannarxsiz tushum ${moneyShort(uncosted)} — foyda oshib ko'rinadi` : "sof foyda ÷ daromad"} />
      </div>
    );
  }

  if (tab === "dds") {
    const { rows, accountRows } = await ddsReport(months);
    const close = totalOf(accountRows, "all:close"), open = totalOf(accountRows, "all:open"), net = totalOf(rows, "net");
    return (
      <div className={grid}>
        <Kpi label="Davr boshi qoldig'i" value={moneyShort(open)} icon={Landmark} hint={`${monthLabel(months[0]!)} boshida, barcha hisoblar`} />
        <Kpi label="Kirim" value={moneyShort(totalOf(accountRows, "all:in"))} icon={ArrowDownCircle} tone="success" hint="barcha hisoblarga, ichki o'tkazmalarsiz" href={dq("dds", "all:in")} />
        <Kpi label="Chiqim" value={moneyShort(-totalOf(accountRows, "all:out"))} icon={ArrowUpCircle} tone="danger" hint="barcha hisoblardan, ichki o'tkazmalarsiz" href={dq("dds", "all:out")} />
        <Kpi label="Sof pul oqimi" value={moneyShort(net)} icon={Scale} tone={signTone(net)} hint={`moliyaviy ${moneyShort(totalOf(rows, "FINANCING:net"))} · investitsion ${moneyShort(totalOf(rows, "INVESTING:net"))}`} href={dq("dds", "net")} />
        <Kpi label="Joriy pul oqimi" value={moneyShort(totalOf(rows, "OPERATING:net"))} icon={Wallet} tone={signTone(totalOf(rows, "OPERATING:net"))} hint="savdo tushumi − joriy chiqimlar" href={dq("dds", "OPERATING:net")} />
        <Kpi label="Davr oxiri qoldig'i" value={moneyShort(close)} icon={Banknote} tone="brand" delta={delta(close, open)} deltaLabel="davr boshidan" hint={period} />
      </div>
    );
  }

  const { rows, capitalRows, labels } = await balanceReport(months);
  const last = labels.length - 1;
  const at = (key: string) => valueAt(rows, key, last);
  const ch = (key: string) => delta(at(key), valueAt(rows, key, 0));
  const equity = at("equity"), diff = valueAt(capitalRows, "cap:diff", last);
  const bq = (key: string) => dq("balans", key, months[months.length - 1]);
  return (
    <div className={grid}>
      <Kpi label="Aktivlar" value={moneyShort(at("a:total"))} icon={Landmark} tone="brand" delta={ch("a:total")} deltaLabel="davr boshidan" hint={`${labels[last]} holatiga`} href={bq("a:total")} />
      <Kpi label="Majburiyatlar" value={moneyShort(at("liab"))} icon={FileWarning} tone="warning" delta={ch("liab")} invert deltaLabel="davr boshidan" hint="ta'minotchi, avans, kredit, qarz" href={bq("liab")} />
      <Kpi label="Shaxsiy kapital" value={moneyShort(equity)} icon={Scale} tone={signTone(equity)} delta={ch("equity")} deltaLabel="davr boshidan" hint={Math.abs(diff) >= 1 ? `kapital tekshiruvi farqi ${moneyShort(diff)}` : "aktiv − majburiyatlar"} href={bq("equity")} />
      <Kpi label="Debitorka (xaridorlar)" value={moneyShort(at("deb:cust"))} icon={Receipt} tone="info" delta={ch("deb:cust")} invert deltaLabel="davr boshidan" href={bq("deb:cust")} />
      <Kpi label="Kreditorka (ta'minotchilar)" value={moneyShort(at("liab:sup"))} icon={ArrowUpCircle} tone="danger" delta={ch("liab:sup")} invert deltaLabel="davr boshidan" href={bq("liab:sup")} />
      <Kpi label="Pul mablag'lari" value={moneyShort(at("cash"))} icon={Banknote} tone="success" delta={ch("cash")} deltaLabel="davr boshidan" href={bq("cash")} />
    </div>
  );
}

export async function MoliyaReportPage({ tab, searchParams }: { tab: ReportTab; searchParams: Promise<SP> }) {
  const { sp, range } = await biContext(searchParams, `${BASE}/${tab}`);
  return (
    <BiPage title="Moliya" info="Foyda va zarar, pul mablag'lari harakati va balans — oylar bo'yicha" tab="finance" range={range} period={false}>
      <div className="space-y-5">
        <ReportKpis tab={tab} sp={sp} />
        <FinReportView base={MOLIYA_LINKS.find((l) => l.key === tab)!.href} sp={{ ...sp, tab }} tabs={false} />
      </div>
    </BiPage>
  );
}
