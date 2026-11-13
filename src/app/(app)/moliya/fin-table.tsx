import Link from "next/link";
import { Info } from "lucide-react";
import type { FinRow } from "@/lib/fin-report/rows";
import { type MonthKey, monthLabel } from "@/lib/fin-report/period";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Moliyaviy hisobot jadvali — «Insof 2026» jadvali ko'rinishida: ustunlar oylar (yoki `labels` — balansdagi sanalar),
 * oxirida «JAMI» (`totalLabel = null` — yo'q), DDS da belgi ustuni (+ / − / ± / =). Birinchi ustun yopishib turadi
 * (telefonda keng jadval o'z ichida suriladi). Manfiy summa qizil, tekshiruv qatori 0 bo'lmasa qizil fon bilan.
 * `drill(kalit, ustun)` — son bosilganda ochiladigan manba paneli havolasi (ustun null — JAMI); null — son bosilmaydi.
 */
export function FinTable({ months, rows, labels, totalLabel = "JAMI", firstHeader = "Ko'rsatkich / Oy", drill }: {
  months: MonthKey[]; rows: FinRow[]; labels?: string[]; totalLabel?: string | null; firstHeader?: string; drill?: (key: string, col: number | null) => string | null;
}) {
  const cols = labels ?? months.map(monthLabel);
  const signs = rows.some((r) => r.sign);
  const cell = (v: number | null, kind: FinRow["kind"]) => {
    if (v === null) return "";
    if (kind === "pct") return `${fmtNum(v, 1)}%`;
    if (v === 0) return "–";
    return fmtNum(v, 0);
  };
  const width = cols.length + 1 + (signs ? 1 : 0) + (totalLabel ? 1 : 0);
  /** Son — bosiladigan havola (manba paneli); foiz qatori va bo'sh katak bosilmaydi. */
  const num = (r: FinRow, v: number | null, col: number | null) => {
    const text = cell(v, r.kind);
    const href = drill && v !== null && v !== 0 && r.kind !== "pct" ? drill(r.key, col) : null;
    return href ? <Link href={href} scroll={false} title="Qayerdan kelgan — bosing" className="-mx-1 rounded px-1 underline decoration-slate-300 decoration-dotted underline-offset-4 hover:bg-brand-100 hover:decoration-slate-500">{text}</Link> : text;
  };
  return (
    <div className="relative max-h-[75vh] max-w-full overflow-auto overscroll-x-contain rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
      <table className="w-full text-sm tabular">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-[3] min-w-40 border-b-2 border-brand-300 bg-brand-100 px-4 py-3 text-left text-[12.5px] font-bold uppercase tracking-wide text-slate-900 sm:min-w-56">{firstHeader}</th>
            {signs && <th scope="col" className="sticky top-0 z-[2] w-8 border-b-2 border-brand-300 bg-brand-100" />}
            {cols.map((c) => <th key={c} scope="col" className="sticky top-0 z-[2] whitespace-nowrap border-b-2 border-brand-300 bg-brand-100 px-3 py-3 text-right text-[12.5px] font-bold uppercase tracking-wide text-slate-900">{c}</th>)}
            {totalLabel && <th scope="col" className="sticky top-0 z-[2] whitespace-nowrap border-b-2 border-l-2 border-brand-300 bg-brand-200 px-3 py-3 text-right text-[12.5px] font-extrabold uppercase tracking-wide text-slate-900">{totalLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            if (r.kind === "head") {
              return (
                <tr key={r.key}>
                  <td colSpan={width} className="sticky left-0 border-t-2 border-slate-700 bg-slate-800 px-4 py-2 text-[12.5px] font-bold uppercase tracking-[0.1em] text-white">{r.label}</td>
                </tr>
              );
            }
            const bad = r.kind === "check" && [...r.values, r.total].some((v) => v !== null && Math.abs(v) >= 1);
            const rowCls = cn(
              r.kind === "total" && "bg-brand-100/70 text-[14.5px] font-extrabold text-slate-900 [&>td]:border-t-2 [&>td]:border-brand-300",
              r.kind === "line" && "font-bold text-slate-900",
              r.kind === "sub" && "text-slate-600",
              r.kind === "pct" && "text-[13px] font-semibold italic text-blue-700",
              r.kind === "check" && (bad ? "bg-red-50 font-semibold text-red-700" : "text-emerald-700"),
            );
            return (
              <tr key={r.key} className={rowCls}>
                <td className={cn("sticky left-0 z-[1] border-t border-slate-100 px-4 py-2", r.kind === "total" ? "bg-brand-100" : bad ? "bg-red-50" : "bg-white", r.kind === "sub" && "pl-8", r.kind === "pct" && "text-right")} title={r.hint}>
                  {r.label}
                  {r.hint && <Info size={12} className="ml-1 inline cursor-help align-[-1px] text-slate-400" />}
                </td>
                {signs && <td className="border-t border-slate-100 px-1 py-2 text-center font-semibold not-italic text-slate-400">{r.sign ?? ""}</td>}
                {r.values.map((v, i) => (
                  <td key={i} className={cn("whitespace-nowrap border-t border-slate-100 px-3 py-2 text-right", v !== null && v < 0 && r.kind !== "check" && r.kind !== "pct" && "text-red-600")}>{num(r, v, i)}</td>
                ))}
                {totalLabel && <td className={cn("whitespace-nowrap border-l-2 border-t border-l-brand-200 border-t-slate-100 bg-brand-50/70 px-3 py-2 text-right font-bold text-slate-900", r.total !== null && r.total < 0 && r.kind !== "check" && r.kind !== "pct" && "text-red-600")}>{num(r, r.total, null)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Excel varag'i uchun: sarlavha → qiymat (ExcelButton formatida). */
export function finSheetRows(cols: string[], rows: FinRow[], totalLabel: string | null = "JAMI"): Record<string, string | number | null>[] {
  return rows.map((r) => ({
    "Ko'rsatkich": r.kind === "sub" ? `   ${r.label}` : r.kind === "head" ? r.label.toUpperCase() : r.label,
    ...(rows.some((x) => x.sign) ? { "": r.sign ?? "" } : {}),
    ...Object.fromEntries(cols.map((c, i) => [c, r.values[i] ?? null])),
    ...(totalLabel ? { [totalLabel]: r.total } : {}),
  }));
}
