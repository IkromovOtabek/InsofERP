import Link from "next/link";
import { goLiveDate } from "@/lib/bi/core";
import { pnlReport, type PnlMode } from "@/lib/fin-report/pnl";
import { ddsReport } from "@/lib/fin-report/dds";
import { balanceReport } from "@/lib/fin-report/balance";
import { type MonthKey, addMonths, isMonthKey, monthDiff, monthKeyOf, monthLabel, monthRange } from "@/lib/fin-report/period";
import { Callout, Section, Select, Tabs } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { FinTable, finSheetRows } from "./fin-table";

export const REPORT_TABS = ["pnl", "dds", "balans"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export const isReportTab = (v: unknown): v is ReportTab => (REPORT_TABS as readonly string[]).includes(String(v));

/**
 * Moliyaviy hisobotlar — «Insof 2026» jadvalidagi PNL, Cash Flow (DDS) va BSH (Balans) varaqlari bir xil ko'rinishda.
 * Ikki joyda ishlatiladi: «Moliya → Moliyaviy hisobotlar» (`/moliya`) va direktorning «Tahlil → Moliya» bo'limi.
 * URL: `base` + `tab` (pnl / dds / balans), `oy` (boshlanish oyi), `n` (oylar soni, ≤ 12), `mode` (PNL: cash),
 * `keep` — sahifaning o'z parametrlari; `tabs = false` — PNL / DDS / Balans tanlovi sahifaning o'zida (Tahlil → Moliya).
 */
export async function FinReportView({ base, sp, keep = {}, tabs = true }: { base: string; sp: Record<string, string | undefined>; keep?: Record<string, string>; tabs?: boolean }) {
  const tab: ReportTab = isReportTab(sp.tab) ? sp.tab : "pnl";
  const mode: PnlMode = sp.mode === "cash" ? "cash" : "accrual";
  const now = monthKeyOf(new Date());
  const live = await goLiveDate();
  const liveKey = live ? monthKeyOf(live) : addMonths(now, -2);
  const defN = Math.min(12, Math.max(1, monthDiff(liveKey, now) + 1));
  const n = Math.min(12, Math.max(1, Number(sp.n) || defN));
  const from: MonthKey = isMonthKey(sp.oy) ? sp.oy : addMonths(now, -(n - 1));
  const months = monthRange(from, n);
  const q = (o: Record<string, string>, m: PnlMode = mode) => `${base}?${new URLSearchParams({ ...keep, tab, oy: from, n: String(n), ...(m === "cash" ? { mode: "cash" } : {}), ...o })}`;

  const pnl = tab === "pnl" ? await pnlReport(months, mode) : null;
  const dds = tab === "dds" ? await ddsReport(months) : null;
  const bal = tab === "balans" ? await balanceReport(months) : null;
  const cols = months.map(monthLabel);
  const sheets = pnl
    ? [{ name: mode === "cash" ? "PNL (pul asosida)" : "PNL", rows: finSheetRows(cols, pnl.rows) }]
    : dds
      ? [{ name: "Pul oqimi (DDS)", rows: finSheetRows(cols, dds.rows) }, { name: "Hisoblar", rows: finSheetRows(cols, dds.accountRows, "Davr") }]
      : bal
        ? [{ name: "BSH", rows: finSheetRows(bal.labels, bal.rows, null) }, { name: "Kapitalni tekshirish", rows: finSheetRows(bal.labels, bal.capitalRows, null) }]
        : [];
  const shortcuts = [
    { label: "Oxirgi 3 oy", from: addMonths(now, -2), n: 3 },
    { label: "Oxirgi 6 oy", from: addMonths(now, -5), n: 6 },
    { label: "Oxirgi 12 oy", from: addMonths(now, -11), n: 12 },
    { label: `${now.slice(0, 4)}-yil`, from: `${now.slice(0, 4)}-01`, n: 12 },
  ];
  const title = pnl
    ? "Korxonaning moliyaviy natijalarini ko'rsatuvchi «Foyda va zarar hisoboti» (so'm, QQSsiz)"
    : dds ? "Pul mablag'lari harakati (DDS) — pul oqimlari to'g'risida ma'lumot, so'm" : "Balans, so'm";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs && <Tabs className="mb-0" current={tab} items={[
          { key: "pnl", label: "Foyda va zarar (PNL)", href: q({ tab: "pnl" }) },
          { key: "dds", label: "Pul oqimi (DDS)", href: q({ tab: "dds" }) },
          { key: "balans", label: "Balans (BSH)", href: q({ tab: "balans" }) },
        ]} />}
        {tab === "pnl" && (
          <Tabs className="mb-0" current={mode} items={[
            { key: "accrual", label: "Hisoblangan", href: q({}, "accrual") },
            { key: "cash", label: "Pul asosida", href: q({}, "cash") },
          ]} />
        )}
        <form method="get" action={base} className="ml-auto flex flex-wrap items-center gap-2">
          {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="tab" value={tab} />
          {mode === "cash" && <input type="hidden" name="mode" value="cash" />}
          <label className="text-xs text-slate-500">Boshlanish oyi <input type="month" name="oy" defaultValue={from} className="ml-1 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" /></label>
          <Select name="n" defaultValue={String(n)} className="h-9 w-28">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k} oy</option>)}
          </Select>
          <button className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
          <ExcelButton file={`${tab === "pnl" ? "Foyda va zarar (PNL)" : tab === "dds" ? "Pul oqimi (DDS)" : "Balans (BSH)"} ${from}`} sheets={sheets} />
        </form>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {shortcuts.map((s) => {
          const on = s.from === from && s.n === n;
          return <Link key={s.label} href={q({ oy: s.from, n: String(s.n) })} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>{s.label}</Link>;
        })}
      </div>

      <h2 className="mb-3 text-[15px] font-semibold text-slate-800">{title}</h2>

      {pnl && (
        <>
          <FinTable months={months} rows={pnl.rows} />
          <ul className="mt-3 space-y-1 text-[13px] text-slate-500">{pnl.notes.map((t) => <li key={t}>{t}</li>)}</ul>
        </>
      )}

      {dds && (
        <>
          {dds.check.some((v) => Math.abs(v) >= 1) && <Callout tone="danger" title="Tekshiruv 0 emas">Hisoblararo o&apos;tkazmaning bir tomoni yetishmayapti yoki bekor qilingan. Kirim-Chiqim jurnalida o&apos;tkazmalarni tekshiring.</Callout>}
          <FinTable months={months} rows={dds.rows} firstHeader="Pul oqimi turi / Manba" />
          <Section title="Hisoblar bo'yicha qoldiq">
            <FinTable months={months} rows={dds.accountRows} totalLabel="JAMI" firstHeader="Hisob / Ko'rsatkich" />
          </Section>
          <p className="mt-3 text-[13px] text-slate-500">Boshlang&apos;ich qoldiqlar — kassa va bank hisoblarining tizimga o&apos;tish sanasidagi qoldig&apos;i (Moliya → Boshlang&apos;ich qoldiqlar).</p>
        </>
      )}

      {bal && (
        <>
          <FinTable months={months} labels={bal.labels} rows={bal.rows} totalLabel={null} firstHeader="Sana" />
          <ul className="mt-3 space-y-1 text-[13px] text-slate-500">{bal.notes.slice(0, 2).map((t) => <li key={t}>{t}</li>)}</ul>
          <Section title="KAPITALNI TEKSHIRISH (moliyaviy nazorat)">
            <FinTable months={months} labels={bal.labels} rows={bal.capitalRows} totalLabel={null} firstHeader="Ko'rsatkich" />
            <p className="mt-2 text-[13px] text-slate-500">{bal.notes[2]}</p>
          </Section>
        </>
      )}
    </div>
  );
}
