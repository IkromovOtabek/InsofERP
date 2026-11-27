"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PieChart, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { money, pct } from "@/lib/format";
import type { BreakdownLine } from "@/lib/fin-report/income-breakdown";

/** Foyda tarkibi qatori — `lib/fin-report/income-breakdown.ts` (veb PNL va mobil direktor bosh sahifasi bitta hisobdan). */
export type { BreakdownLine };

/**
 * «Jami daromad» kartasi — bosilganda foyda tarkibi oynasi: daromad qismlari → tannarx → xarajatlar → sof foyda.
 * Karta o'zi server'da chiziladi (`children`), bu komponent faqat uni tugmaga o'raydi va oynani ochadi.
 */
export function ProfitBreakdown({ title, period, base, lines, notes, children }: {
  title: string; period: string;
  /** Ulush (%) shu summaga nisbatan — jami daromad */
  base: number;
  lines: BreakdownLine[]; notes?: string[]; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setOpen(false); btn.current?.focus(); }, []);
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
        className="block h-full w-full rounded-(--radius-card) text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&>*]:h-full [&>*]:hover:border-slate-300 [&>*]:hover:shadow-md">
        {children}
      </button>
      {open && <Dialog title={title} period={period} base={base} lines={lines} notes={notes} onClose={close} />}
    </>
  );
}

/** Oddiy qatorda belgi chapda turadi («−»), summa ishorasiz; natija qatorlari — o'z ishorasi bilan. */
const shown = (l: BreakdownLine) => (l.kind === "total" || l.kind === "grand" ? l.value : Math.abs(l.value));

function Dialog({ title, period, base, lines, notes, onClose }: { title: string; period: string; base: number; lines: BreakdownLine[]; notes?: string[]; onClose: () => void }) {
  const titleId = useId();
  const router = useRouter();
  const go = (href: string) => { onClose(); router.push(href); };
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal((
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold tracking-tight text-slate-900">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700"><PieChart size={16} aria-hidden /></span>
              {title}
            </h2>
            <div className="mt-0.5 pl-9 text-xs text-slate-500">{period}</div>
          </div>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Yopish" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="py-1.5 text-left font-medium">Qator</th>
              <th className="py-1.5 text-right font-medium">Summa</th>
              <th className="w-16 py-1.5 text-right font-medium">Ulush</th>
            </tr>
          </thead>
          <tbody>
            {lines.filter((l) => !(l.kind === undefined || l.kind === "line" || l.kind === "sub") || l.value !== 0).map((l, i) => l.kind === "head" ? (
              <tr key={i}><td colSpan={3} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{l.label}</td></tr>
            ) : (
              <tr key={i} onClick={l.href ? () => go(l.href!) : undefined}
                className={cn("border-b border-slate-100", l.kind === "sub" && "text-[13px] text-slate-600 [&>td:first-child]:pl-6", l.kind === "excluded" && "opacity-60", l.kind === "total" && "bg-slate-50 font-medium", l.kind === "grand" && "border-t-2 border-slate-300 bg-brand-50 font-semibold", l.href && "cursor-pointer hover:bg-brand-50/60")}>
                <td className="py-1.5 pr-2 text-slate-700">
                  <span className="inline-block w-4 text-slate-400">{l.sign ?? ""}</span>
                  {l.href ? <Link href={l.href} onClick={(e) => { e.stopPropagation(); onClose(); }} className="decoration-slate-300 underline-offset-2 hover:text-brand-700 hover:underline">{l.label}</Link> : l.label}
                  {l.hint && <div className="pl-4 text-xs font-normal text-slate-400">{l.hint}</div>}
                </td>
                <td className={cn("whitespace-nowrap py-1.5 text-right tabular", (l.kind === "total" || l.kind === "grand") && l.value < 0 ? "text-rose-600" : "text-slate-900")}>{money(shown(l))}</td>
                <td className="py-1.5 text-right tabular text-slate-500">{l.kind === "excluded" ? <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">kirmaydi</span> : base > 0 ? pct((shown(l) / base) * 100) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {notes && notes.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-500">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </div>
    </div>
  ), document.body);
}
