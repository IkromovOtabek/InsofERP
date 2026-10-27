import { Info } from "lucide-react";
import type { FinRow } from "@/lib/fin-report/rows";
import { type MonthKey, monthLabel } from "@/lib/fin-report/period";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Moliyaviy hisobot jadvali — «Insof 2026» jadvali ko'rinishida: ustunlar oylar (yoki `labels` — balansdagi sanalar),
 * oxirida «JAMI» (`totalLabel = null` — yo'q), DDS da belgi ustuni (+ / − / ± / =). Birinchi ustun yopishib turadi
 * (telefonda keng jadval o'z ichida suriladi). Manfiy summa qizil, tekshiruv qatori 0 bo'lmasa qizil fon bilan.
 */
export function FinTable({ months, rows, labels, totalLabel = "JAMI", firstHeader = "Ko'rsatkich / Oy" }: { months: MonthKey[]; rows: FinRow[]; labels?: string[]; totalLabel?: string | null; firstHeader?: string }) {
  const cols = labels ?? months.map(monthLabel);
  const signs = rows.some((r) => r.sign);
  const cell = (v: number | null, kind: FinRow["kind"]) => {
    if (v === null) return "";
    if (kind === "pct") return `${fmtNum(v, 1)}%`;
    if (v === 0) return "–";
    return fmtNum(v, 0);
  };
  const width = cols.length + 1 + (signs ? 1 : 0) + (totalLabel ? 1 : 0);
  return (
    <div className="relative max-h-[75vh] max-w-full overflow-auto overscroll-x-contain rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
      <table className="w-full text-sm tabular">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-[3] min-w-40 border-b sm:min-w-56 border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{firstHeader}</th>
            {signs && <th scope="col" className="sticky top-0 z-[2] w-8 border-b border-slate-200 bg-slate-50" />}
            {cols.map((c) => <th key={c} scope="col" className="sticky top-0 z-[2] whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">{c}</th>)}
            {totalLabel && <th scope="col" className="sticky top-0 z-[2] whitespace-nowrap border-b border-l border-slate-200 bg-slate-100 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-600">{totalLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            if (r.kind === "head") {
              return (
                <tr key={r.key}>
                  <td colSpan={width} className="sticky left-0 border-t border-slate-200 bg-slate-50/80 px-4 pb-1.5 pt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{r.label}</td>
                </tr>
              );
            }
            const bad = r.kind === "check" && [...r.values, r.total].some((v) => v !== null && Math.abs(v) >= 1);
            const rowCls = cn(
              r.kind === "total" && "bg-slate-50 font-bold text-slate-900",
              r.kind === "line" && "font-semibold text-slate-800",
              r.kind === "sub" && "italic text-slate-600",
              r.kind === "pct" && "text-[13px] italic text-blue-700",
              r.kind === "check" && (bad ? "bg-red-50 font-semibold text-red-700" : "text-emerald-700"),
            );
            return (
              <tr key={r.key} className={rowCls}>
                <td className={cn("sticky left-0 z-[1] border-t border-slate-100 px-4 py-2", r.kind === "total" ? "bg-slate-50" : bad ? "bg-red-50" : "bg-white", r.kind === "sub" && "pl-8", r.kind === "pct" && "text-right")} title={r.hint}>
                  {r.label}
                  {r.hint && <Info size={12} className="ml-1 inline cursor-help align-[-1px] text-slate-400" />}
                </td>
                {signs && <td className="border-t border-slate-100 px-1 py-2 text-center font-semibold not-italic text-slate-400">{r.sign ?? ""}</td>}
                {r.values.map((v, i) => (
                  <td key={i} className={cn("whitespace-nowrap border-t border-slate-100 px-3 py-2 text-right", v !== null && v < 0 && r.kind !== "check" && r.kind !== "pct" && "text-red-600")}>{cell(v, r.kind)}</td>
                ))}
                {totalLabel && <td className={cn("whitespace-nowrap border-l border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-right font-semibold", r.total !== null && r.total < 0 && r.kind !== "check" && r.kind !== "pct" && "text-red-600")}>{cell(r.total, r.kind)}</td>}
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
