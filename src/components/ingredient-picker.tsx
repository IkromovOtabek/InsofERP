"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus } from "lucide-react";
import { FolderPicker, type PickerGroup } from "@/components/folder-picker";
import { unitLabel } from "@/lib/unit";
import { Badge, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Retsept ingrediyenti — xomashyo yoki boshqa mahsulot (masalan FBS blok) bo'lishi mumkin. */
export type IngredientRow = { id: string; kind: "material" | "product"; name: string; code: string; unit: string; groupId: string | null };

/** Nom yoki kod bo'yicha filtr: avval nomi shu harflar bilan boshlanadiganlar. */
function filterIngredients(list: IngredientRow[], term: string) {
  const t = term.trim().toLowerCase();
  if (!t) return list;
  const starts = list.filter((m) => m.name.toLowerCase().startsWith(t));
  const rest = list.filter((m) => !m.name.toLowerCase().startsWith(t) && (m.name.toLowerCase().includes(t) || m.code.toLowerCase().includes(t)));
  return [...starts, ...rest];
}

/**
 * Xomashyo + mahsulot spravochnigi bitta oynada — retsept qatoriga ingredient tanlash uchun.
 * Ikkala ro'yxat (papkalari bilan) birlashtirilgan, har yozuv yonida qaysi ro'yxatdan
 * ekani ("Xomashyo" / "Mahsulot") ko'rinadi. Bu yerdan yangi yozuv qo'shilmaydi —
 * kerak bo'lsa Sklad → Xomashyo qo'shish yoki mahsulot spravochnigidan kiritiladi.
 */
export function IngredientPicker({ open, ingredients, groups, initialQuery, onPick, onClose }: {
  open: boolean;
  ingredients: IngredientRow[];
  groups: PickerGroup[];
  initialQuery?: string;
  onPick: (row: IngredientRow) => void;
  onClose: () => void;
}) {
  return (
    <FolderPicker
      open={open}
      title="XOMASHYO / MAHSULOT"
      ariaLabel="Retsept ingredienti tanlash"
      nameLabel="Nomi"
      cols={[
        { label: "Turi", className: "w-28" },
        { label: "Birlik", className: "w-20" },
        { label: "Kod", className: "w-28", right: true },
      ]}
      items={ingredients.map((x) => ({
        id: x.id, name: x.name, code: x.code, groupId: x.groupId,
        cells: [x.kind === "product" ? <Badge key="k" color="blue">Mahsulot</Badge> : <span key="k" className="text-slate-500">Xomashyo</span>, unitLabel(x.unit), x.code],
      }))}
      groups={groups}
      initialQuery={initialQuery}
      emptyText="Bu papka bo'sh"
      noMatchText="Mos yozuv topilmadi"
      footerHint="Papkani ochish yoki tanlash — ikki marta bosing"
      onPick={(id) => { const x = ingredients.find((r) => r.id === id); if (x) onPick(x); }}
      onClose={onClose}
    />
  );
}

/**
 * Retsept qatoridagi ingredient maydoni: yozilgan har harf bo'yicha ro'yxat qisqaradi
 * (xomashyo va mahsulot bir ro'yxatda, mahsulotlar "mahsulot" belgisi bilan ajratiladi),
 * oxiridagi "…" tugmasi to'liq spravochnikni (papkalari bilan) ochadi.
 */
export function IngredientField({ ingredients, groups, value, onPick }: {
  ingredients: IngredientRow[];
  groups: PickerGroup[];
  value: string;
  onPick: (row: IngredientRow) => void;
}) {
  const selected = ingredients.find((x) => x.id === value) ?? null;
  const [q, setQ] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => filterIngredients(ingredients, q ?? "").slice(0, 50), [ingredients, q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setQ(null); } };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  const choose = (x: IngredientRow) => { onPick(x); setOpen(false); setQ(null); };

  return (
    <div ref={boxRef} className="relative flex">
      <input
        value={q ?? (selected ? `${selected.name} (${selected.code})` : "")}
        placeholder="Xomashyo yoki mahsulot nomi"
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
      <button type="button" onClick={() => { setOpen(false); setModal(true); }} title="Ro'yxatdan tanlash" aria-label="Ingredient tanlash"
        className="-ml-px flex h-10 w-10 shrink-0 items-center justify-center rounded-r-lg border border-slate-200 bg-slate-50 pb-1 text-base leading-none font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900">
        …
      </button>

      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-(--shadow-pop)">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Mos yozuv topilmadi</div>}
          {matches.map((x, i) => (
            <button key={x.id} type="button" onMouseEnter={() => setCursor(i)} onClick={() => choose(x)}
              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === cursor ? "bg-slate-100" : "hover:bg-slate-50")}>
              <Minus size={14} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{x.name}</span>
              {x.kind === "product" && <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">mahsulot</span>}
              <span className="shrink-0 text-xs text-slate-500">{unitLabel(x.unit)}</span>
              <span className="shrink-0 text-xs text-slate-400 tabular">{x.code}</span>
            </button>
          ))}
        </div>
      )}

      <IngredientPicker open={modal} ingredients={ingredients} groups={groups} initialQuery={q ?? ""} onPick={choose} onClose={() => setModal(false)} />
    </div>
  );
}
