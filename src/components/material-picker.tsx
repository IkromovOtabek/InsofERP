"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, MousePointerClick, Search, X } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Button, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

export type MaterialRow = { id: string; name: string; code: string; unit: string; price?: number; balance?: number };

/** Nom yoki kod bo'yicha filtr: avval nomi shu harflar bilan boshlanadiganlar. */
function filterMaterials(list: MaterialRow[], term: string) {
  const t = term.trim().toLowerCase();
  if (!t) return list;
  const starts = list.filter((m) => m.name.toLowerCase().startsWith(t));
  const rest = list.filter((m) => !m.name.toLowerCase().startsWith(t) && (m.name.toLowerCase().includes(t) || m.code.toLowerCase().includes(t)));
  return [...starts, ...rest];
}

/**
 * Xomashyo spravochnigi — 1C dagi oynaga o'xshash: qidiruv, ro'yxat, "Tanlash".
 * Yozilgan nom ro'yxatda bo'lmasa — shu nom bilan yangi xomashyo ochish taklif qilinadi.
 */
export function MaterialPicker({ open, materials, initialQuery, onPick, onCreate, onClose }: {
  open: boolean;
  materials: MaterialRow[];
  initialQuery?: string;
  onPick: (m: MaterialRow) => void;
  onCreate?: (name: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [sel, setSel] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    setQ(initialQuery ?? "");
    setSel(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, initialQuery, onClose]);

  const rows = useMemo(() => filterMaterials(materials, q).slice(0, 200), [materials, q]);
  if (!open || !mounted) return null;

  const pick = (m: MaterialRow) => { onPick(m); onClose(); };
  const newName = q.trim();
  const exact = materials.some((m) => m.name.trim().toLowerCase() === newName.toLowerCase());

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-(--radius-card) border border-slate-200 bg-white shadow-(--shadow-pop)"
        onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Xomashyo tanlash">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-base font-semibold tracking-tight">XOMASHYO</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <Button type="button" size="sm" disabled={!sel} onClick={() => { const m = materials.find((x) => x.id === sel); if (m) pick(m); }}>
            <MousePointerClick size={15} /> Tanlash
          </Button>
          {onCreate && newName && !exact && (
            <Button type="button" size="sm" variant="secondary" onClick={() => { onCreate(newName); onClose(); }}>
              «{newName}» ni yangi qo&apos;shish
            </Button>
          )}
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <input ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="Qidirish (nomi yoki kodi)" className={cn(inputCls, "pr-8 pl-8")} />
            {q && <button type="button" onClick={() => setQ("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Tozalash"><X size={15} /></button>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2">Nomi</th>
                <th className="w-24 px-4 py-2">Birlik</th>
                <th className="w-32 px-4 py-2 text-right">Qoldiq</th>
                <th className="w-32 px-4 py-2 text-right">Kod</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  {materials.length === 0 ? "Skladda hali xomashyo yo'q" : "Mos xomashyo topilmadi"}
                </td></tr>
              )}
              {rows.map((m) => (
                <tr key={m.id} onClick={() => setSel(m.id)} onDoubleClick={() => pick(m)}
                  className={cn("cursor-pointer border-b border-slate-100", sel === m.id ? "bg-slate-900 text-white" : "hover:bg-slate-50")}>
                  <td className="px-4 py-1.5">
                    <span className="inline-flex items-center gap-2"><Minus size={15} className={sel === m.id ? "text-slate-300" : "text-slate-400"} />{m.name}</span>
                  </td>
                  <td className={cn("px-4 py-1.5", sel === m.id ? "text-slate-200" : "text-slate-600")}>{unitLabel(m.unit)}</td>
                  <td className={cn("px-4 py-1.5 text-right tabular", sel === m.id ? "text-slate-200" : "text-slate-600")}>{m.balance != null ? fmtNum(m.balance, 3) : "—"}</td>
                  <td className={cn("px-4 py-1.5 text-right tabular", sel === m.id ? "text-slate-200" : "text-slate-500")}>{m.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          <span>Tanlash uchun qatorga ikki marta bosing</span>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Yopish</Button>
        </div>
      </div>
    </div>
  ), document.body);
}

/**
 * Xomashyo maydoni: yozilgan har bir harf bo'yicha ro'yxat qisqaradi,
 * oxiridagi "…" tugmasi to'liq spravochnikni ochadi.
 */
export function MaterialField({ materials, value, onPick, placeholder }: {
  materials: MaterialRow[];
  value: string; // tanlangan xomashyo id'si
  onPick: (m: MaterialRow) => void;
  placeholder?: string;
}) {
  const selected = materials.find((m) => m.id === value) ?? null;
  const [q, setQ] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => filterMaterials(materials, q ?? "").slice(0, 50), [materials, q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setQ(null); } };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  const choose = (m: MaterialRow) => { onPick(m); setOpen(false); setQ(null); };

  return (
    <div ref={boxRef} className="relative flex">
      <input
        value={q ?? (selected ? `${selected.name} (${selected.code})` : "")}
        placeholder={placeholder ?? "Xomashyo nomi yoki kodi"}
        autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setCursor(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && open && matches[cursor]) { e.preventDefault(); choose(matches[cursor]); }
          else if (e.key === "Escape") { setOpen(false); setQ(null); }
        }}
        className={cn(inputCls, "rounded-r-none")}
      />
      <button type="button" onClick={() => { setOpen(false); setModal(true); }} title="Ro'yxatdan tanlash" aria-label="Xomashyo tanlash"
        className="-ml-px flex h-10 w-10 shrink-0 items-center justify-center rounded-r-lg border border-slate-200 bg-slate-50 pb-1 text-base leading-none font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900">
        …
      </button>

      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-(--shadow-pop)">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Mos xomashyo topilmadi</div>}
          {matches.map((m, i) => (
            <button key={m.id} type="button" onMouseEnter={() => setCursor(i)} onClick={() => choose(m)}
              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === cursor ? "bg-slate-100" : "hover:bg-slate-50")}>
              <Minus size={14} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{unitLabel(m.unit)}</span>
              <span className="shrink-0 text-xs text-slate-400 tabular">{m.code}</span>
            </button>
          ))}
        </div>
      )}

      <MaterialPicker open={modal} materials={materials} initialQuery={q ?? ""} onPick={choose} onClose={() => setModal(false)} />
    </div>
  );
}
