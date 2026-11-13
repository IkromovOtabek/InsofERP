"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Filter, FilterX, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string; count: number };
export type SortDir = "asc" | "desc";

/** Oynada bir vaqtda chiziladigan qiymatlar (izoh kabi ustunda minglab bo'lishi mumkin) — qolgani qidiruv bilan topiladi. */
const LIST_CAP = 400;

/**
 * Excel uslubidagi ustun filtri — sarlavha katagidagi kichik tugma. Bosilsa oyna: saralash, filtrni olib tashlash,
 * qidiruv, «Barchasini belgilash» va qiymatlar ro'yxati (katakcha + nechta qator), OK / Bekor qilish.
 *  · `options()` oyna ochilganda chaqiriladi — Excel'dagidek BOSHQA filtrlardan o'tgan qatorlarning qiymatlari;
 *  · `selected` — null: filtr yo'q; Set — faqat shu qiymatlar ko'rinadi (hammasi belgilansa filtr olib tashlanadi);
 *  · qidiruvda (Excel'dagidek) topilganlar belgilanadi va OK bosilsa faqat ular qoladi.
 * Oyna `document.body` ga chiziladi: jadval qobig'i `overflow: auto`, ichida qirqilib qolardi.
 */
export function ColumnFilter({ label, options, selected, onChange, sort, onSort, sortText = ["A → Z", "Z → A"] }: {
  label: string;
  options: () => FilterOption[];
  selected: Set<string> | null | undefined;
  onChange: (next: Set<string> | null) => void;
  sort?: SortDir | null;
  onSort?: (dir: SortDir) => void;
  sortText?: [string, string];
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const active = selected != null;
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((v) => !v)}
        title={active ? `«${label}» bo'yicha filtr qo'yilgan — o'zgartirish` : `«${label}»: filtr va saralash`}
        aria-label={`${label}: filtr`} aria-haspopup="dialog" aria-expanded={open}
        className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition",
          active ? "border-brand-600 bg-brand-400 text-slate-950 hover:bg-brand-300" : "border-slate-300 bg-white text-slate-500 hover:border-slate-500 hover:text-slate-900")}>
        {active ? <Filter size={11} strokeWidth={2.5} /> : <ChevronDown size={13} strokeWidth={2.5} />}
      </button>
      {open && (
        <FilterPanel anchor={btn} label={label} options={options} selected={selected ?? null} onChange={onChange}
          sort={sort} onSort={onSort} sortText={sortText} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ’‘`]/g, "'");

function FilterPanel({ anchor, label, options, selected, onChange, sort, onSort, sortText, onClose }: {
  anchor: React.RefObject<HTMLButtonElement | null>; label: string; options: () => FilterOption[]; selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void; sort?: SortDir | null; onSort?: (dir: SortDir) => void; sortText: [string, string]; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Qiymatlar oyna ochilgan paytdagi holatdan — oyna ochiq turganda ro'yxat sakramasin
  const [opts] = useState(options);
  const [base] = useState(() => new Set(opts.filter((o) => !selected || selected.has(o.value)).map((o) => o.value)));
  const [draft, setDraft] = useState(base);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const nq = norm(q.trim());
  const matches = nq ? opts.filter((o) => norm(o.label).includes(nq)) : opts;
  const picked = matches.filter((o) => draft.has(o.value)).length;
  const allOn = matches.length > 0 && picked === matches.length;

  // Joylashuv: tugma ostida, ekrandan chiqsa — yuqorida / chetga suriladi. Sahifa yoki jadval aylantirilsa — tugmaga ergashadi
  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const p = panel.current;
    if (!a || !p) return;
    const w = p.offsetWidth, h = p.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(a.left, vw - w - 8));
    let top = a.bottom + 4;
    if (top + h > vh - 8) top = a.top - h - 4 >= 8 ? a.top - h - 4 : Math.max(8, vh - h - 8);
    setPos((o) => (o && o.top === top && o.left === left ? o : { top, left }));
  }, [anchor]);
  useLayoutEffect(place, [place]);
  // Fokus — oyna joyiga qo'yilgach (yashirin maydonga autoFocus ishlamaydi); preventScroll — sahifa sakramasin
  const shown = pos != null;
  useEffect(() => { if (shown) input.current?.focus({ preventScroll: true }); }, [shown]);

  // Tashqariga bosish va Esc — yopiladi
  useEffect(() => {
    const inside = (t: EventTarget | null) => !!t && (panel.current?.contains(t as Node) || anchor.current?.contains(t as Node));
    const down = (e: MouseEvent) => { if (!inside(e.target)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const move = (e: Event) => { if (!panel.current?.contains(e.target as Node)) place(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, onClose, place]);

  const search = (v: string) => {
    setQ(v);
    const n = norm(v.trim());
    // Excel'dagidek: qidirilganda topilganlarning hammasi belgilanadi; qidiruv tozalansa — oldingi tanlov
    setDraft(n ? new Set(opts.filter((o) => norm(o.label).includes(n)).map((o) => o.value)) : base);
  };
  const toggle = (v: string) => setDraft((d) => { const n = new Set(d); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const toggleAll = () => setDraft((d) => {
    const n = new Set(d);
    for (const o of matches) if (allOn) n.delete(o.value); else n.add(o.value);
    return n;
  });
  const apply = () => {
    if (picked === 0) return;
    const next = nq ? new Set(matches.filter((o) => draft.has(o.value)).map((o) => o.value)) : draft;
    onChange(!nq && next.size === opts.length ? null : next);
    onClose();
  };

  return createPortal((
    <div ref={panel} role="dialog" aria-label={`${label} — filtr`}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-50 w-80 max-w-[calc(100vw-16px)] rounded-xl border border-slate-200 bg-white p-2 text-left text-[13px] font-normal normal-case tracking-normal text-slate-700 shadow-(--shadow-pop)">
      {onSort && (
        <div className="mb-1 border-b border-slate-100 pb-1">
          <MenuItem icon={ArrowUpNarrowWide} on={sort === "asc"} onClick={() => { onSort("asc"); onClose(); }}>{sortText[0]}</MenuItem>
          <MenuItem icon={ArrowDownWideNarrow} on={sort === "desc"} onClick={() => { onSort("desc"); onClose(); }}>{sortText[1]}</MenuItem>
        </div>
      )}
      <MenuItem icon={FilterX} disabled={!selected} onClick={() => { onChange(null); onClose(); }}>«{label}» filtrini olib tashlash</MenuItem>
      <div className="relative mt-1.5">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
        <input ref={input} value={q} onChange={(e) => search(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
          placeholder="Qidirish…" aria-label="Qiymatni qidirish"
          className="h-8 w-full rounded-md border border-slate-300 bg-white pr-2 pl-8 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none" />
      </div>
      <div className="mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-md border border-slate-200 py-1">
        {matches.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 px-2 py-1 font-medium hover:bg-slate-50">
            <input type="checkbox" className="accent-brand-600" checked={allOn} onChange={toggleAll}
              ref={(el) => { if (el) el.indeterminate = picked > 0 && !allOn; }} />
            {nq ? "(Topilganlarning hammasi)" : "(Barchasini belgilash)"}
          </label>
        )}
        {matches.slice(0, LIST_CAP).map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-slate-50">
            <input type="checkbox" className="accent-brand-600" checked={draft.has(o.value)} onChange={() => toggle(o.value)} />
            <span className={cn("min-w-0 flex-1 truncate", !o.value && "text-slate-400 italic")} title={o.label}>{o.label}</span>
            <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{o.count}</span>
          </label>
        ))}
        {matches.length > LIST_CAP && <div className="px-2 py-1 text-xs text-slate-500">… yana {matches.length - LIST_CAP} ta — qidiruv bilan toraytiring</div>}
        {matches.length === 0 && <div className="px-2 py-3 text-center text-xs text-slate-500">Topilmadi</div>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs whitespace-nowrap text-slate-500 tabular-nums" title="belgilangan / jami qiymat">{picked} / {matches.length}</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={onClose} className="h-8 rounded-md border border-slate-200 px-3 font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50">Bekor qilish</button>
          <button type="button" onClick={apply} disabled={picked === 0} className="h-8 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-40">OK</button>
        </div>
      </div>
    </div>
  ), document.body);
}

function MenuItem({ icon: Icon, on, disabled, onClick, children }: { icon: LucideIcon; on?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40", on && "font-semibold text-brand-700")}>
      <Icon size={14} className="shrink-0 text-slate-500" /> {children}
    </button>
  );
}
