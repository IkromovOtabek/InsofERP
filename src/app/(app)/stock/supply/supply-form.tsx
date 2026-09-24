"use client";

import { useActionState, useMemo, useState } from "react";
import { ClipboardList, MoreHorizontal, Plus, TriangleAlert, X } from "lucide-react";
import { createRequest } from "@/lib/supply-actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import { MaterialPicker, type MaterialGroup } from "@/components/material-picker";
import { fmtNum } from "@/lib/format";
import { MATERIAL_UNITS, unitLabel } from "@/lib/unit";
import { cn } from "@/lib/utils";

/** Spravochnikdagi xomashyo — qoldig'i va minimal chegarasi bilan (nima kamayganini shu yerda ko'rish uchun). */
export type SupplyOpt = { id: string; name: string; code: string; unit: string; balance: number; minStock: number; groupId?: string | null };

type Row = { key: number; materialId: string | null; name: string; unit: string; qty: string; note: string };

const blank = (key: number): Row => ({ key, materialId: null, name: "", unit: "kg", qty: "", note: "" });
const GRID = "lg:grid-cols-[minmax(220px,2fr)_110px_120px_minmax(160px,1fr)_32px]";

/** Nomi katagi: terilganda spravochnik chiqadi; ro'yxatda yo'q nom ham yoziladi (qabulda shu nom bilan ochiladi). */
function NameCell({ row, options, groups, canCreate, onPick, onText }: {
  row: Row; options: SupplyOpt[]; groups: MaterialGroup[]; canCreate: boolean; onPick: (m: SupplyOpt) => void; onText: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const list = useMemo(() => {
    const t = row.name.trim().toLowerCase();
    if (!t) return options.slice(0, 60);
    const starts = options.filter((o) => o.name.toLowerCase().startsWith(t));
    const rest = options.filter((o) => !o.name.toLowerCase().startsWith(t) && (o.name.toLowerCase().includes(t) || o.code.toLowerCase().includes(t)));
    return [...starts, ...rest].slice(0, 60);
  }, [options, row.name]);

  return (
    <div className="relative">
      <Input value={row.name} placeholder="Sement M400 / ehtiyot qism…" autoComplete="off" className="pr-10"
        onChange={(e) => { onText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      <button type="button" aria-label="Spravochnikdan tanlash" title="Xomashyo spravochnigi"
        onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); setModal(true); }}
        className="absolute top-1/2 right-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
        <MoreHorizontal size={16} />
      </button>
      <MaterialPicker open={modal} materials={options} groups={groups} canCreate={canCreate} initialQuery={row.name}
        onPick={(m) => { const o = options.find((x) => x.id === m.id); if (o) onPick(o); }}
        onCreate={(name) => onText(name)} onClose={() => setModal(false)} />
      {open && list.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[280px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {list.map((o) => (
            <button key={o.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(o); setOpen(false); }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">{o.name}</span>
                <span className="block truncate text-xs text-slate-500">{o.code} · {unitLabel(o.unit)}</span>
              </span>
              <span className={cn("shrink-0 text-xs", o.balance < o.minStock ? "font-medium text-red-600" : "text-slate-500")}>
                qoldiq {fmtNum(o.balance, 3)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Sklad → «Kerakli mahsulotlar jadvali». Jadval snabjeniyega narx qo'yish uchun ketadi;
 * miqdorni sklad belgilaydi, narxni bu yerda umuman so'ramaymiz.
 */
export function SupplyForm({ options, low, groups = [], canCreate = false, warehouses }: {
  options: SupplyOpt[];
  low: SupplyOpt[]; // minimal chegaradan kam qolganlar — bitta bosishda jadvalga tushadi
  groups?: MaterialGroup[];
  canCreate?: boolean;
  warehouses: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createRequest, undefined);
  const [rows, setRows] = useState<Row[]>([blank(1)]);
  const [seq, setSeq] = useState(2);

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => { setRows((rs) => [...rs, blank(seq)]); setSeq((n) => n + 1); };
  const drop = (key: number) => setRows((rs) => (rs.length === 1 ? [blank(seq)] : rs.filter((r) => r.key !== key)));

  /** Kam qolganlarni jadvalga tushirish: kerak = minimal × 2 − qoldiq (kamida minimal). */
  const fillLow = () => {
    let n = seq;
    const add = low.map((o) => ({ key: n++, materialId: o.id, name: o.name, unit: o.unit, qty: String(Math.max(o.minStock, o.minStock * 2 - o.balance) || 1), note: `Qoldiq ${fmtNum(o.balance, 3)}, minimal ${fmtNum(o.minStock, 3)}` }));
    setRows((rs) => [...rs.filter((r) => r.name.trim()), ...add.filter((a) => !rs.some((r) => r.materialId === a.materialId))]);
    setSeq(n);
  };

  const payload = rows
    .filter((r) => r.name.trim())
    .map((r) => ({ materialId: r.materialId, name: r.name.trim(), unit: r.unit, qty: Number(r.qty) || 0, note: r.note.trim() || null }));
  const filled = payload.length;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Qaysi skladga kerak *">
          <Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        </Field>
      </div>

      {low.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span className="inline-flex items-center gap-2"><TriangleAlert size={15} /> Minimal chegaradan kam qolgan xomashyo: <b>{low.length} ta</b></span>
          <Button type="button" variant="secondary" size="sm" onClick={fillLow}>Hammasini jadvalga tushirish</Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[760px] space-y-2">
          <div className={cn("grid grid-cols-1 gap-2 px-1 text-xs font-medium text-slate-500", GRID)}>
            <span>Nomi *</span><span>Birlik</span><span>Kerak miqdor *</span><span>Izoh</span><span />
          </div>
          {rows.map((r) => {
            const picked = r.materialId ? options.find((o) => o.id === r.materialId) : null;
            return (
              <div key={r.key} className={cn("grid grid-cols-1 items-start gap-2", GRID)}>
                <div>
                  <NameCell row={r} options={options} groups={groups} canCreate={canCreate}
                    onPick={(m) => set(r.key, { materialId: m.id, name: m.name, unit: m.unit })}
                    onText={(v) => set(r.key, { name: v, materialId: null })} />
                  {picked ? (
                    <p className={cn("mt-1 text-xs", picked.balance < picked.minStock ? "text-red-600" : "text-slate-500")}>
                      Skladda: {fmtNum(picked.balance, 3)} {unitLabel(picked.unit)}{picked.minStock > 0 ? ` · minimal ${fmtNum(picked.minStock, 3)}` : ""}
                    </p>
                  ) : r.name.trim() ? (
                    <p className="mt-1 text-xs text-blue-600">Spravochnikda yo&apos;q — qabul qilinganda shu nom bilan ochiladi</p>
                  ) : null}
                </div>
                <Select value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} disabled={!!picked}>
                  {MATERIAL_UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </Select>
                <Input value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })} type="number" step="0.001" min="0" placeholder="0" inputMode="decimal" />
                <Input value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} placeholder="Marka, o'lcham…" autoComplete="off" />
                <button type="button" onClick={() => drop(r.key)} aria-label="Qatorni o'chirish"
                  className="mt-1 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"><X size={16} /></button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" onClick={add}><Plus size={16} /> Qator qo&apos;shish</Button>
        <span className="text-xs text-slate-500">To&apos;ldirilgan qator: {filled} ta</span>
      </div>

      <FormError error={state?.error} />
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-slate-500">Narxni snabjeniye qo&apos;yadi — siz faqat miqdorni belgilaysiz</span>
        <Button disabled={pending || filled === 0}><ClipboardList size={16} /> {pending ? "Yuborilmoqda…" : "Snabjeniyega yuborish"}</Button>
      </div>
    </form>
  );
}
