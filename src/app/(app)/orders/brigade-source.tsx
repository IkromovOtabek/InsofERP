"use client";

import { useCallback, useState } from "react";
import { HardHat, History, Split } from "lucide-react";
import { YardMovesDialog, type YardMovesQuery } from "@/components/yard-moves-dialog";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BrigadeStockOpt } from "@/lib/brigade-stock-source";
import { brigadeMovesInfo } from "./brigade-source-actions";

/**
 * Zayavka qatoridagi «Brigadadan olish» belgisi — faqat dona mahsulot (plita, ustun, blok…) uchun. Belgilansa qatorga
 * «Brigada omboridan» ustuni chiqadi (`BrigadeSourceCell`). Brigada omborlarida bu mahsulot bo'lmasa — bosilmaydi.
 */
export function BrigadeSourceToggle({ checked, onChange, options, className }: { checked: boolean; onChange: (on: boolean) => void; options: BrigadeStockOpt[] | undefined; className?: string }) {
  const none = !options?.length;
  const total = (options ?? []).reduce((a, o) => a + o.free, 0);
  return (
    <label className={cn("inline-flex items-center gap-1.5 text-xs select-none", none ? "cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-700", className)}
      title={none ? "Brigada omborlarida bu mahsulot yo'q" : `Brigadalarda erkin: ${fmtNum(total, 3)}`}>
      <input type="checkbox" checked={checked} disabled={none && !checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-[#25236b]" />
      <HardHat size={13} className={none ? "text-slate-300" : "text-amber-600"} />
      Brigadadan olish{!none && <span className="text-slate-500 tabular">· erkin {fmtNum(total, 3)}</span>}
    </label>
  );
}

/**
 * «Brigada omboridan» katagi: brigadalar ro'yxati — nomi va erkin turgan jami miqdori (boshqa ochiq zayavkalarga shu brigadadan
 * olinadigani ayirilgan, shu formadagi boshqa qatorlar olgani ham). Bittasi tanlanadi; nom yonidagi soat belgisi — shu brigada
 * omboridagi harakatlar oynasi (kim, qachon kiritgan/chiqargan). Kerakli miqdor erkinidan ko'p bo'lsa — qolganini boshqa
 * brigadadan olish uchun qatorni bo'lish taklif qilinadi.
 */
export function BrigadeSourceCell({ productId, options, unit, need, value, onChange, taken, onSplit }: {
  productId: string;
  options: BrigadeStockOpt[] | undefined;
  unit: string;
  /** Qatordagi miqdor */ need: number;
  value: string;
  onChange: (brigadeId: string) => void;
  /** Shu formaning boshqa qatorlari shu mahsulotdan brigadalar bo'yicha olgani */ taken: Record<string, number>;
  /** Qolganini boshqa brigadadan — qator ostiga yangi qator (shu mahsulot, `qty`, `brigadeId`) */ onSplit?: (brigadeId: string, qty: number) => void;
}) {
  const [moves, setMoves] = useState<YardMovesQuery | null>(null);
  const close = useCallback(() => setMoves(null), []);
  const list = (options ?? []).map((o) => ({ ...o, left: Math.max(0, Math.round((o.free - (taken[o.brigadeId] ?? 0)) * 1000) / 1000) }));
  if (!list.length) return <p className="py-1 text-xs text-slate-400">Brigada omborlarida bu mahsulot yo&apos;q</p>;
  const sel = list.find((o) => o.brigadeId === value) ?? null;
  const short = sel ? Math.max(0, Math.round((need - sel.left) * 1000) / 1000) : 0;
  const next = short > 0 ? list.filter((o) => o.brigadeId !== value && o.left > 0).sort((a, b) => b.left - a.left)[0] : undefined;
  return (
    <div className="space-y-1">
      <ul role="radiogroup" aria-label="Qaysi brigada omboridan" className="space-y-0.5">
        {list.map((o) => {
          const on = o.brigadeId === value;
          return (
            <li key={o.brigadeId} className={cn("flex items-center gap-1 rounded-md border px-1.5 py-1", on ? "border-amber-400 bg-amber-50" : "border-transparent hover:bg-slate-50")}>
              <button type="button" role="radio" aria-checked={on} onClick={() => onChange(o.brigadeId)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12.5px]">
                <span className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border", on ? "border-amber-600" : "border-slate-300")}>{on && <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />}</span>
                <span className={cn("line-clamp-2 min-w-0 flex-1 leading-tight break-words", on ? "font-semibold text-slate-900" : "text-slate-700")} title={o.name}>{o.name}</span>
                <span className={cn("shrink-0 tabular", o.left > 0 ? "font-semibold text-emerald-700" : "text-slate-400")} title={`Omborda ${fmtNum(o.qty, 3)}${o.band > 0 ? `, boshqa zayavkalarga band ${fmtNum(o.band, 3)}` : ""}${taken[o.brigadeId] ? `, shu zayavkaning boshqa qatorlarida ${fmtNum(taken[o.brigadeId]!, 3)}` : ""}`}>
                  {fmtNum(o.left, 3)} <span className="font-normal text-slate-400">{unit}</span>
                </span>
              </button>
              <button type="button" onClick={() => setMoves({ productId, owner: o.brigadeId, dir: "all" })} aria-label={`${o.name} — ombordagi harakatlar`} title="Ombordagi harakatlar: kim, qachon kiritgan / chiqargan"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-white hover:text-slate-800"><History size={13} /></button>
            </li>
          );
        })}
      </ul>
      {sel && short > 0 && (
        <div className="rounded-md bg-amber-50 px-1.5 py-1 text-[11.5px] leading-snug text-amber-800">
          {sel.name} omborida {fmtNum(short, 3)} {unit} yetmaydi — qolgani ishlab chiqariladi yoki hovlidan beriladi.
          {next && onSplit && (
            <button type="button" onClick={() => onSplit(next.brigadeId, Math.min(short, next.left))}
              className="mt-0.5 flex items-center gap-1 font-medium text-amber-900 underline-offset-2 hover:underline">
              <Split size={12} /> {fmtNum(Math.min(short, next.left), 3)} {unit} — «{next.name}» dan
            </button>
          )}
        </div>
      )}
      {moves && <YardMovesDialog query={moves} load={brigadeMovesInfo} onClose={close} periodLabel="Brigada omboridagi barcha harakatlar (oxirgi 300 ta)" />}
    </div>
  );
}
