import { Info } from "lucide-react";
import type { FinRow } from "@/lib/fin-report/rows";
import { type MonthKey, monthLabel } from "@/lib/fin-report/period";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Moliyaviy hisobot jadvali — oylar ustunda, oxirida «Jami». Birinchi ustun yopishib turadi (telefonda keng jadval
 * o'z ichida suriladi). Manfiy summa qizil, tekshiruv qatori 0 bo'lmasa qizil fon bilan ajraladi.
 */
export function FinTable({ months, rows, totalLabel = "Jami" }: { months: MonthKey[]; rows: FinRow[]; totalLabel?: string }) {
  const cell = (v: number | null, kind: FinRow["kind"]) => {
    if (v === null) return "";
    if (kind === "pct") return `${fmtNum(v, 1)}%`;
    if (v === 0) return "–";
    return fmtNum(v, 0);
  };
  return (
    <div className="relative max-w-full overflow-x-auto overscroll-x-contain rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
      <table className="w-full text-sm tabular">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-[2] min-w-56 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Ko&apos;rsatkich</th>
            {months.map((m) => <th key={m} scope="col" className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">{monthLabel(m)}</th>)}
            <th scope="col" className="whitespace-nowrap border-b border-l border-slate-200 bg-slate-100 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-600">{totalLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            if (r.kind === "head") {
              return (
                <tr key={r.key}>
                  <td colSpan={months.length + 2} className="sticky left-0 border-t border-slate-200 bg-slate-50/80 px-4 pb-1.5 pt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{r.label}</td>
                </tr>
              );
            }
            const bad = r.kind === "check" && [...r.values, r.total].some((v) => v !== null && Math.abs(v) >= 1);
            const rowCls = cn(
              r.kind === "total" && "bg-slate-50 font-bold text-slate-900",
              r.kind === "line" && "font-semibold text-slate-800",
              r.kind === "sub" && "text-slate-600",
              r.kind === "pct" && "text-[13px] italic text-slate-500",
              r.kind === "check" && (bad ? "bg-red-50 font-semibold text-red-700" : "text-emerald-700"),
            );
            return (
              <tr key={r.key} className={rowCls}>
                <td className={cn("sticky left-0 z-[1] border-t border-slate-100 px-4 py-2", r.kind === "total" ? "bg-slate-50" : bad ? "bg-red-50" : "bg-white", r.kind === "sub" && "pl-8")} title={r.hint}>
                  {r.label}
                  {r.hint && <Info size={12} className="ml-1 inline cursor-help align-[-1px] text-slate-400" />}
                </td>
                {r.values.map((v, i) => (
                  <td key={i} className={cn("whitespace-nowrap border-t border-slate-100 px-3 py-2 text-right", v !== null && v < 0 && r.kind !== "check" && r.kind !== "pct" && "text-red-600")}>{cell(v, r.kind)}</td>
                ))}
                <td className={cn("whitespace-nowrap border-l border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-right font-semibold", r.total !== null && r.total < 0 && r.kind !== "check" && r.kind !== "pct" && "text-red-600")}>{cell(r.total, r.kind)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Excel varag'i uchun: sarlavha → qiymat (ExcelButton formatida). */
export function finSheetRows(months: MonthKey[], rows: FinRow[], totalLabel = "Jami"): Record<string, string | number | null>[] {
  return rows.map((r) => ({
    "Ko'rsatkich": r.kind === "sub" ? `   ${r.label}` : r.kind === "head" ? r.label.toUpperCase() : r.label,
    ...Object.fromEntries(months.map((m, i) => [monthLabel(m), r.values[i] ?? null])),
    [totalLabel]: r.total,
  }));
}
