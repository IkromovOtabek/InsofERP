"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus } from "lucide-react";
import { deleteCatalogMaterial, deleteMaterialGroup } from "@/lib/material-actions";
import { FolderPicker, type PickerGroup } from "@/components/folder-picker";
import { DeleteButton } from "@/components/delete-button";
import { MaterialPanelBody, MaterialTools, type MaterialPanel } from "@/components/catalog-tools";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Button, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

export type MaterialRow = { id: string; name: string; code: string; unit: string; price?: number; balance?: number; groupId?: string | null };
export type MaterialGroup = PickerGroup;

/** Nom yoki kod bo'yicha filtr: avval nomi shu harflar bilan boshlanadiganlar. */
function filterMaterials(list: MaterialRow[], term: string) {
  const t = term.trim().toLowerCase();
  if (!t) return list;
  const starts = list.filter((m) => m.name.toLowerCase().startsWith(t));
  const rest = list.filter((m) => !m.name.toLowerCase().startsWith(t) && (m.name.toLowerCase().includes(t) || m.code.toLowerCase().includes(t)));
  return [...starts, ...rest];
}

/**
 * Xomashyo spravochnigi — mahsulot spravochnigi bilan bir xil 1C uslubidagi oyna
 * (umumiy `FolderPicker`): papkalar, qidiruv, "Tanlash".
 * `canCreate` bo'lsa shu oynadan yangi xomashyo va papka qo'shiladi.
 * Yozilgan nom ro'yxatda bo'lmasa — shu nom bilan qatorga yozish taklif qilinadi (`onCreate`).
 */
export function MaterialPicker({ open, materials, groups = [], canCreate = false, initialQuery, onPick, onCreate, onClose }: {
  open: boolean;
  materials: MaterialRow[];
  groups?: MaterialGroup[];
  canCreate?: boolean;
  initialQuery?: string;
  onPick: (m: MaterialRow) => void;
  onCreate?: (name: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<MaterialPanel>(null);
  useEffect(() => { if (!open) setPanel(null); }, [open]);

  const toggle = (p: MaterialPanel) => setPanel((cur) => (cur === p ? null : p));
  const afterCreate = () => { setPanel(null); router.refresh(); };
  /** Qidiruvga yozilgan nom ro'yxatda bormi — bo'lmasa "«X» ni yangi qo'shish" taklif qilinadi. */
  const isNew = (name: string) => !!name && !materials.some((m) => m.name.trim().toLowerCase() === name.toLowerCase());

  return (
    <FolderPicker
      open={open}
      title="XOMASHYO"
      ariaLabel="Xomashyo tanlash"
      nameLabel="Nomi"
      cols={[
        { label: "Birlik", className: "w-24" },
        { label: "Qoldiq", className: "w-32", right: true },
        { label: "Kod", className: "w-32", right: true },
      ]}
      items={materials.map((m) => ({
        id: m.id, name: m.name, code: m.code, groupId: m.groupId ?? null,
        cells: [unitLabel(m.unit), m.balance != null ? fmtNum(m.balance, 3) : "—", m.code],
      }))}
      groups={groups}
      initialQuery={initialQuery}
      emptyText={materials.length === 0 ? "Skladda hali xomashyo yo'q" : "Bu papka bo'sh"}
      noMatchText="Mos xomashyo topilmadi"
      footerHint="Papkani ochish yoki xomashyoni tanlash — ikki marta bosing"
      onPick={(id) => { const m = materials.find((x) => x.id === id); if (m) onPick(m); }}
      onClose={onClose}
      /* O'chirish: hujjatlarda ishlatilmagan xomashyo butunlay o'chadi, ishlatilgani arxivga olinadi */
      rowAction={canCreate ? (row) => (
        <DeleteButton
          action={row.kind === "group" ? deleteMaterialGroup : deleteCatalogMaterial}
          id={row.id}
          name={row.name}
          title={row.kind === "group" ? "Papkani o'chirish" : "Xomashyoni o'chirish"}
        />
      ) : undefined}
      tools={(ctx) => (
        <>
          {canCreate && <MaterialTools toggle={toggle} />}
          {/* Qatorga yozilgan nom ro'yxatda yo'q — shu nom bilan davom etish (qo'shilishi saqlashda bo'ladi) */}
          {onCreate && isNew(ctx.query) && (
            <Button type="button" size="sm" variant="ghost" onClick={() => { onCreate(ctx.query); onClose(); }}>
              «{ctx.query}» ni yangi qo&apos;shish
            </Button>
          )}
        </>
      )}
      panel={(ctx) => (canCreate ? <MaterialPanelBody panel={panel} ctx={ctx} onDone={afterCreate} onCancel={() => setPanel(null)} /> : null)}
    />
  );
}

/**
 * Xomashyo maydoni: yozilgan har bir harf bo'yicha ro'yxat qisqaradi,
 * oxiridagi "…" tugmasi to'liq spravochnikni (papkalari bilan) ochadi.
 */
export function MaterialField({ materials, groups, canCreate, value, onPick, placeholder }: {
  materials: MaterialRow[];
  groups?: MaterialGroup[];
  canCreate?: boolean;
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

      <MaterialPicker open={modal} materials={materials} groups={groups} canCreate={canCreate} initialQuery={q ?? ""} onPick={choose} onClose={() => setModal(false)} />
    </div>
  );
}
