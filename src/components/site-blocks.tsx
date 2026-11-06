"use client";

import { useState } from "react";
import { Building2, Plus, X } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Obyekt bloklari (A blok, B blok… — obyekt ichidagi binolar) uchun ikki katak:
 *  · `BlocksEditor` — mijoz kartasidagi obyekt formasida bloklar ro'yxati (chip'lar);
 *  · `BlockField` — zayavka qatoridagi «Blok»: obyekt bloklaridan tanlanadi yoki yangi nom yoziladi
 *    (saqlanganda obyektga qo'shiladi — `lib/site-blocks.ts`).
 */

const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 40).trim();
const cap = (s: string) => (s ? s[0]!.toLocaleUpperCase("uz") + s.slice(1) : s);
const same = (a: string, b: string) => a.toLocaleLowerCase("uz") === b.toLocaleLowerCase("uz");
const QUICK = ["A blok", "B blok", "C blok", "D blok"];

/** Obyekt formasidagi bloklar ro'yxati. Formaga `block[]` va `blocksSent=1` bo'lib boradi (bo'sh ro'yxat — bloklar olib tashlandi). */
export function BlocksEditor({ defaultValue = [] }: { defaultValue?: string[] }) {
  const [list, setList] = useState(defaultValue);
  const [draft, setDraft] = useState("");
  const add = (names: string[]) => {
    setList((cur) => {
      const out = [...cur];
      for (const raw of names) { const n = cap(clean(raw)); if (n && !out.some((x) => same(x, n))) out.push(n); }
      return out;
    });
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <input type="hidden" name="blocksSent" value="1" />
      {list.map((b) => <input key={b} type="hidden" name="block[]" value={b} />)}
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((b) => (
          <span key={b} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 py-1 pr-1 pl-2 text-[13px] font-medium text-indigo-800 ring-1 ring-indigo-200 ring-inset">
            <Building2 size={12} className="text-indigo-400" /> {b}
            <button type="button" onClick={() => setList((cur) => cur.filter((x) => x !== b))} aria-label={`${b} — olib tashlash`} className="rounded p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"><X size={12} /></button>
          </span>
        ))}
        {list.length === 0 && <span className="text-[13px] text-slate-400">Blok yo&apos;q — obyekt bitta bino</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Masalan: A blok, 2-bino" maxLength={40} aria-label="Yangi blok nomi" className="h-9 w-56"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(draft.split(",")); } }} />
        <button type="button" onClick={() => add(draft.split(","))} disabled={!clean(draft)}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Plus size={14} /> Blok qo&apos;shish</button>
        {list.length === 0 && (
          <button type="button" onClick={() => add(QUICK)} className="text-[13px] font-medium text-indigo-700 hover:underline">A, B, C, D bloklar</button>
        )}
      </div>
    </div>
  );
}

/** Zayavka qatoridagi blok katagi: ro'yxatdan tanlash yoki yangi nom yozish. `value` — blok nomi ("" — blokka bog'lanmagan). */
export function BlockField({ value, onChange, options, className, disabled }: {
  value: string; onChange: (v: string) => void; options: string[]; className?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = clean(value).toLocaleLowerCase("uz");
  const exact = options.some((o) => same(o, clean(value)));
  const list = exact || !q ? options : options.filter((o) => o.toLocaleLowerCase("uz").includes(q));
  const fresh = !!q && !exact;
  return (
    <div className={cn("relative", className)}>
      <Building2 size={14} className={cn("pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2", value ? "text-indigo-500" : "text-slate-300")} />
      <Input value={value} disabled={disabled} placeholder={options.length ? "Tanlang" : "Blok"} maxLength={40} autoComplete="off" aria-label="Blok"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => { setTimeout(() => setOpen(false), 150); if (value && clean(value) !== value) onChange(cap(clean(value))); }}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        className={cn("h-9 pr-7 pl-8", value && "font-medium text-indigo-900")} />
      {value && !disabled && (
        <button type="button" onClick={() => onChange("")} aria-label="Blokni olib tashlash" className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={13} /></button>
      )}
      {open && !disabled && (list.length > 0 || fresh) && (
        <div className="absolute z-30 mt-1 w-full min-w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {list.map((o) => (
            <button key={o} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o); setOpen(false); }}
              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50", same(o, value) && "bg-indigo-50 font-medium text-indigo-900")}>
              <Building2 size={13} className="shrink-0 text-indigo-400" /> {o}
            </button>
          ))}
          {fresh && <div className={cn("px-3 py-1.5 text-xs text-slate-500", list.length > 0 && "border-t border-slate-100")}>«{cap(clean(value))}» — yangi blok, saqlanganda obyektga qo&apos;shiladi</div>}
        </div>
      )}
    </div>
  );
}

/** Blok yorlig'i — zayavka qatori, matritsa ustuni, doska kartasi va obyekt kartasida bir xil ko'rinadi */
export function BlockTag({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-px text-[11.5px] leading-4 font-semibold text-indigo-800 ring-1 ring-indigo-200 ring-inset", className)}>
      <Building2 size={11} className="shrink-0 text-indigo-400" /><span className="break-words">{name}</span>
    </span>
  );
}
