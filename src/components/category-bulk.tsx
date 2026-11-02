"use client";

import { useEffect, useRef, useState } from "react";
import { FolderInput } from "lucide-react";
import { MATERIAL_CATEGORY_OPTIONS } from "@/lib/material-category";
import { Button, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { MaterialCategory } from "@/generated/prisma";

/** Qatordagi kategoriya tanlovi (kirim formasi, Excel jurnal ro'yxati). */
export function CategorySelect({ value, onChange, disabled, className, title }: {
  value: MaterialCategory; onChange: (c: MaterialCategory) => void; disabled?: boolean; className?: string; title?: string;
}) {
  return (
    <Select aria-label="Kategoriya" title={title} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as MaterialCategory)}
      className={cn("h-8 w-auto py-0 pl-2 text-xs pointer-coarse:h-9", className)}>
      {MATERIAL_CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
}

/** Qator belgisi — jadvaldagi boshqa belgilar bilan bir xil ko'rinish. */
export function RowCheck({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <label className="-m-1.5 inline-flex cursor-pointer items-center justify-center p-1.5 pointer-coarse:min-h-11">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="h-4 w-4 cursor-pointer accent-slate-900 pointer-coarse:h-5 pointer-coarse:w-5" />
    </label>
  );
}

/**
 * Belgilangan qatorlarga birdan kategoriya berish paneli: «Hammasini belgilash», soni, kategoriya va «Qo'llash».
 * Holat (qaysi qatorlar belgilangan) chaqiruvchida — panel faqat tugmalar.
 */
export function CategoryBulkBar({ total, selected, onToggleAll, onApply, className, children }: {
  total: number; selected: number; onToggleAll: (on: boolean) => void; onApply: (c: MaterialCategory) => void; className?: string; children?: React.ReactNode;
}) {
  const [cat, setCat] = useState<MaterialCategory | "">("");
  const all = useRef<HTMLInputElement>(null);
  const allOn = total > 0 && selected === total;
  useEffect(() => { if (all.current) all.current.indeterminate = selected > 0 && !allOn; }, [selected, allOn]);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2", className)}>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 pointer-coarse:min-h-11">
        <input ref={all} type="checkbox" aria-label="Hammasini belgilash" checked={allOn} disabled={total === 0} onChange={(e) => onToggleAll(e.target.checked)} className="h-4 w-4 cursor-pointer accent-slate-900 pointer-coarse:h-5 pointer-coarse:w-5" />
        Hammasini belgilash
      </label>
      <span className="text-sm text-slate-600">Belgilangan: <b className="tabular text-slate-900">{selected}</b> / {total}</span>
      <span className="inline-flex items-center gap-1.5">
        <Select aria-label="Belgilanganlar kategoriyasi" value={cat} onChange={(e) => setCat(e.target.value as MaterialCategory | "")} className="h-8 w-auto py-0 text-sm pointer-coarse:h-9">
          <option value="">Kategoriya…</option>
          {MATERIAL_CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Button type="button" variant="secondary" size="sm" disabled={!cat || selected === 0} onClick={() => { if (cat) onApply(cat); }}>
          <FolderInput size={15} /> Belgilanganlarga qo&apos;llash
        </Button>
      </span>
      {children}
    </div>
  );
}
