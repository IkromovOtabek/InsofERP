"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, CornerLeftUp, Folder, Minus, MousePointerClick, Search, X } from "lucide-react";
import { Button, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Papka (1C dagi guruh) — mahsulot va xomashyo ro'yxatlarida bir xil tuzilma. */
export type PickerGroup = { id: string; code: string; name: string; parentId: string | null };

/** Ro'yxatdagi bitta yozuv. `cells` — nomdan keyingi ustunlar, `hint` — nom yonidagi kichik izoh. */
export type PickerItem = {
  id: string;
  name: string;
  code: string;
  groupId: string | null;
  cells: React.ReactNode[];
  hint?: string | null;
};

export type PickerCol = { label: string; className?: string; right?: boolean };

/**
 * Ochiq turgan papka — "Yangi", "Papka", "Excel" tugmalari shu papkaga qo'shadi.
 * `query` — qidiruv katagida yozilgan matn (ro'yxatda yo'q nomni shu yerdan olib qo'shish uchun).
 */
export type PickerCtx = { groupId: string | null; groupName: string | null; query: string };

type Sel = { type: "group" | "item"; id: string };

/**
 * 1C dagi spravochnik oynasi: papkalar ichiga kiriladi, qidiruv butun ro'yxat bo'yicha ishlaydi,
 * qatorga ikki marta bosilsa papka ochiladi yoki yozuv tanlanadi.
 *
 * Mahsulot (`ProductPicker`) va xomashyo (`MaterialPicker`) shu oynani ishlatadi — farqi
 * faqat ustunlar va "Yangi / Papka / Excel" panellarida: ular `tools` va `panel` orqali beriladi
 * (ikkalasi ochiq papkani `PickerCtx` bo'lib oladi).
 */
export function FolderPicker({
  open, title, ariaLabel, nameLabel = "Nomi", cols, items, groups, initialQuery,
  emptyText = "Bu papka bo'sh", noMatchText = "Mos yozuv topilmadi", footerHint,
  onPick, onClose, tools, panel, rowAction,
}: {
  open: boolean;
  title: string;
  ariaLabel: string;
  nameLabel?: string;
  cols: PickerCol[];
  items: PickerItem[];
  groups: PickerGroup[];
  initialQuery?: string;
  emptyText?: string;
  noMatchText?: string;
  footerHint?: string;
  onPick: (id: string) => void;
  onClose: () => void;
  tools?: (ctx: PickerCtx) => React.ReactNode;
  panel?: (ctx: PickerCtx) => React.ReactNode;
  /** Qator oxiridagi amal (masalan o'chirish tugmasi); berilmasa ustun ham chizilmaydi. */
  rowAction?: (row: { id: string; name: string; kind: "group" | "item" }) => React.ReactNode;
}) {
  const [path, setPath] = useState<PickerGroup[]>([]); // ochilgan papkalar zanjiri
  const [q, setQ] = useState(initialQuery ?? "");
  const [sel, setSel] = useState<Sel | null>(null);
  const [mounted, setMounted] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Oyna forma ichida emas, <body> da chiziladi — aks holda forma forma ichiga tushadi
  useEffect(() => setMounted(true), []);

  const current = path.at(-1) ?? null;
  const currentId = current?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setQ(initialQuery ?? "");
    setSel(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, initialQuery, onClose]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    // Qidiruvda papkalar bo'ylab yurilmaydi — butun ro'yxatdan mos kelganlari chiqadi
    if (term) {
      return {
        groups: [] as PickerGroup[],
        items: items.filter((x) => x.name.toLowerCase().includes(term) || x.code.toLowerCase().includes(term)),
      };
    }
    return {
      groups: groups.filter((g) => (g.parentId ?? null) === currentId),
      items: items.filter((x) => (x.groupId ?? null) === currentId),
    };
  }, [q, items, groups, currentId]);

  if (!open || !mounted) return null;

  const span = cols.length + (rowAction ? 2 : 1);
  const ctx: PickerCtx = { groupId: currentId, groupName: current?.name ?? null, query: q.trim() };
  const openGroup = (id: string) => {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    setPath((p) => [...p, g]);
    setQ("");
    setSel(null);
  };
  const pick = (id: string) => { onPick(id); onClose(); };
  const confirm = () => {
    if (!sel) return;
    if (sel.type === "group") openGroup(sel.id);
    else pick(sel.id);
  };

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-(--radius-card) border border-slate-200 bg-white shadow-(--shadow-pop)"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={ariaLabel}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>

        {/* Asboblar qatori: Tanlash · (chaqiruvchining tugmalari) · qidiruv */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <Button type="button" size="sm" disabled={!sel} onClick={confirm}>
            <MousePointerClick size={15} /> Tanlash
          </Button>
          {tools?.(ctx)}
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <input ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="Qidirish (nomi yoki kodi)" className={cn(inputCls, "pr-8 pl-8")} />
            {q && <button type="button" onClick={() => setQ("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Tozalash"><X size={15} /></button>}
          </div>
        </div>

        {panel && (() => {
          const body = panel(ctx);
          return body ? <div className="max-h-[60vh] overflow-auto border-b border-slate-200 bg-blue-50/60 px-4 py-3">{body}</div> : null;
        })()}

        {/* Papka zanjiri */}
        {!q && path.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-4 py-2 text-[13px]">
            <button type="button" onClick={() => { setPath([]); setSel(null); }} className="text-slate-500 hover:text-slate-900 hover:underline">Barchasi</button>
            {path.map((g, i) => (
              <span key={g.id} className="inline-flex items-center gap-1">
                <ChevronRight size={13} className="text-slate-400" />
                <button type="button" onClick={() => { setPath((p) => p.slice(0, i + 1)); setSel(null); }} className={cn(i === path.length - 1 ? "font-medium text-slate-900" : "text-slate-500 hover:underline")}>{g.name}</button>
              </span>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2">{nameLabel}</th>
                {cols.map((c) => <th key={c.label} className={cn("px-4 py-2", c.className, c.right && "text-right")}>{c.label}</th>)}
                {rowAction && <th className="w-10 px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {!q && path.length > 0 && (
                <tr className="cursor-pointer border-b border-slate-100 text-slate-500 hover:bg-slate-50" onClick={() => { setPath((p) => p.slice(0, -1)); setSel(null); }}>
                  <td className="px-4 py-1.5" colSpan={span}><span className="inline-flex items-center gap-2"><CornerLeftUp size={14} /> Yuqoriga</span></td>
                </tr>
              )}
              {shown.groups.length === 0 && shown.items.length === 0 && (
                <tr><td colSpan={span} className="px-4 py-8 text-center text-slate-500">{q ? noMatchText : emptyText}</td></tr>
              )}
              {shown.groups.map((g) => {
                const active = sel?.type === "group" && sel.id === g.id;
                return (
                  <tr key={`group-${g.id}`} onClick={() => setSel({ type: "group", id: g.id })} onDoubleClick={() => openGroup(g.id)}
                    className={cn("cursor-pointer border-b border-slate-100", active ? "bg-slate-900 text-white" : "hover:bg-slate-50")}>
                    <td className="px-4 py-1.5">
                      <span className="inline-flex items-center gap-2">
                        <Folder size={15} className={active ? "text-amber-300" : "text-amber-500"} />
                        <span className="font-medium">{g.name}</span>
                      </span>
                    </td>
                    {cols.map((c, i) => (
                      <td key={c.label} className={cn("px-4 py-1.5", c.right && "text-right tabular", active ? "text-slate-200" : "text-slate-600")}>
                        {/* Papkada faqat oxirgi ustun (kod) to'ladi */}
                        {i === cols.length - 1 ? g.code : ""}
                      </td>
                    ))}
                    {rowAction && (
                      <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                        {rowAction({ id: g.id, name: g.name, kind: "group" })}
                      </td>
                    )}
                  </tr>
                );
              })}
              {shown.items.map((x) => {
                const active = sel?.type === "item" && sel.id === x.id;
                return (
                  <tr key={`item-${x.id}`} onClick={() => setSel({ type: "item", id: x.id })} onDoubleClick={() => pick(x.id)}
                    className={cn("cursor-pointer border-b border-slate-100", active ? "bg-slate-900 text-white" : "hover:bg-slate-50")}>
                    <td className="px-4 py-1.5">
                      <span className="inline-flex items-center gap-2">
                        <Minus size={15} className={active ? "text-slate-300" : "text-slate-400"} />
                        <span>{x.name}</span>
                        {x.hint && <span className={cn("text-xs", active ? "text-slate-300" : "text-slate-500")}>· {x.hint}</span>}
                      </span>
                    </td>
                    {cols.map((c, i) => (
                      <td key={c.label} className={cn("px-4 py-1.5", c.right && "text-right tabular", active ? "text-slate-200" : "text-slate-600")}>
                        {x.cells[i] ?? ""}
                      </td>
                    ))}
                    {rowAction && (
                      <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                        {rowAction({ id: x.id, name: x.name, kind: "item" })}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          <span>{footerHint ?? "Papkani ochish yoki yozuvni tanlash — ikki marta bosing"}</span>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Yopish</Button>
        </div>
      </div>
    </div>
  ), document.body);
}
