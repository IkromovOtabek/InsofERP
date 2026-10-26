import Link from "next/link";
import { requirePage } from "@/lib/page-guard";
import { goLiveDate } from "@/lib/bi/core";
import { pnlReport, type PnlMode } from "@/lib/fin-report/pnl";
import { ddsReport } from "@/lib/fin-report/dds";
import { balanceReport } from "@/lib/fin-report/balance";
import { type MonthKey, addMonths, isMonthKey, monthDiff, monthKeyOf, monthLabel, monthRange } from "@/lib/fin-report/period";
import { Callout, PageHeader, Section, Select, Tabs } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { FinTable, finSheetRows } from "./fin-table";
import { MoliyaTabs } from "./moliya-tabs";

const TABS = ["pnl", "dds", "balans"] as const;
type Tab = (typeof TABS)[number];

/**
 * Moliyaviy hisobotlar — «Insof 2026» jadvalidagi PNL, Cash Flow va BSH varaqlari o'rnida (`lib/fin-report`).
 * Oylar ustunda (eng ko'pi 12). Davr: `from` (oy) va `n` (oylar soni); sukut — tizimga o'tgan oydan joriy oygacha.
 */
export default async function MoliyaPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; n?: string; mode?: string }> }) {
  await requirePage("/moliya");
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "pnl";
  const mode: PnlMode = sp.mode === "cash" ? "cash" : "accrual";

  const now = monthKeyOf(new Date());
  const live = await goLiveDate();
  const liveKey = live ? monthKeyOf(live) : addMonths(now, -2);
  const defN = Math.min(12, Math.max(1, monthDiff(liveKey, now) + 1));
  const n = Math.min(12, Math.max(1, Number(sp.n) || defN));
  const from: MonthKey = isMonthKey(sp.from) ? sp.from : addMonths(now, -(n - 1));
  const months = monthRange(from, n);
  const q = (o: Record<string, string>, m: PnlMode = mode) => "?" + new URLSearchParams({ tab, from, n: String(n), ...(m === "cash" ? { mode: "cash" } : {}), ...o }).toString();

  const pnl = tab === "pnl" ? await pnlReport(months, mode) : null;
  const dds = tab === "dds" ? await ddsReport(months) : null;
  const bal = tab === "balans" ? await balanceReport(months) : null;

  const periodLabel = `${monthLabel(months[0]!)} — ${monthLabel(months[n - 1]!)}`;
  const sheets = pnl
    ? [{ name: mode === "cash" ? "PNL (pul asosida)" : "PNL", rows: finSheetRows(months, pnl.rows) }]
    : dds
      ? [{ name: "Pul oqimi (DDS)", rows: finSheetRows(months, dds.rows) }, { name: "Hisoblar", rows: finSheetRows(months, dds.accountRows, "Davr") }]
      : bal
        ? [{ name: "Balans", rows: finSheetRows(months, bal.rows, "Oxirgi oy") }, { name: "Kapital tekshiruvi", rows: finSheetRows(months, bal.capitalRows) }]
        : [];
  const shortcuts = [
    { label: "Oxirgi 3 oy", from: addMonths(now, -2), n: 3 },
    { label: "Oxirgi 6 oy", from: addMonths(now, -5), n: 6 },
    { label: "Oxirgi 12 oy", from: addMonths(now, -11), n: 12 },
    { label: `${now.slice(0, 4)}-yil`, from: `${now.slice(0, 4)}-01`, n: 12 },
  ];

  return (
    <div>
      <PageHeader eyebrow="Moliya" title="Moliyaviy hisobotlar" subtitle={`Foyda-zarar, pul oqimi va balans · ${periodLabel}`} action={<ExcelButton file={`Moliya ${tab} ${from}`} sheets={sheets} />} />
      <MoliyaTabs current="/moliya" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs className="mb-0" current={tab} items={[
          { key: "pnl", label: "Foyda va zarar (PNL)", href: q({ tab: "pnl" }) },
          { key: "dds", label: "Pul oqimi (DDS)", href: q({ tab: "dds" }) },
          { key: "balans", label: "Balans", href: q({ tab: "balans" }) },
        ]} />
        {tab === "pnl" && (
          <Tabs className="mb-0" current={mode} items={[
            { key: "accrual", label: "Hisoblangan", href: q({}, "accrual") },
            { key: "cash", label: "Pul asosida", href: q({}, "cash") },
          ]} />
        )}
        <form method="get" className="ml-auto flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          {mode === "cash" && <input type="hidden" name="mode" value="cash" />}
          <label className="text-xs text-slate-500">Boshlanish oyi <input type="month" name="from" defaultValue={from} className="ml-1 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" /></label>
          <Select name="n" defaultValue={String(n)} className="h-9 w-28">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k} oy</option>)}
          </Select>
          <button className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
        </form>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {shortcuts.map((s) => {
          const on = s.from === from && s.n === n;
          return <Link key={s.label} href={q({ from: s.from, n: String(s.n) })} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>{s.label}</Link>;
        })}
      </div>

      {pnl && (
        <>
          <FinTable months={months} rows={pnl.rows} />
          <ul className="mt-3 space-y-1 text-[13px] text-slate-500">{pnl.notes.map((t) => <li key={t}>{t}</li>)}</ul>
        </>
      )}

      {dds && (
        <>
          {dds.check.some((v) => Math.abs(v) >= 1) && <Callout tone="danger" title="Tekshiruv 0 emas">Hisoblararo o&apos;tkazmaning bir tomoni yetishmayapti yoki bekor qilingan. Kirim-Chiqim jurnalida o&apos;tkazmalarni tekshiring.</Callout>}
          <FinTable months={months} rows={dds.rows} />
          <Section title="Hisoblar bo'yicha qoldiq">
            <FinTable months={months} rows={dds.accountRows} totalLabel="Davr" />
          </Section>
        </>
      )}

      {bal && (
        <>
          <FinTable months={months} rows={bal.rows} totalLabel="Oxirgi oy" />
          <Section title="Kapitalni tekshirish">
            <FinTable months={months} rows={bal.capitalRows} />
          </Section>
          <ul className="mt-3 space-y-1 text-[13px] text-slate-500">{bal.notes.map((t) => <li key={t}>{t}</li>)}</ul>
        </>
      )}
    </div>
  );
}
