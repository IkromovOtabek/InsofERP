"use client";

import { useActionState, useState } from "react";
import { Plus, X, PackagePlus } from "lucide-react";
import { importMaterials } from "../actions";
import { Button, FormError, Input, Select } from "@/components/ui";
import { fmtNum, money } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = { key: number; name: string; code: string; unit: string; qty: string; price: string; minStock: string };
const UNITS: [string, string][] = [["kg", "kg"], ["t", "t"], ["l", "l"], ["m3", "m³"], ["dona", "dona"], ["m", "m"], ["m2", "m²"]];
const blank = (key: number): Row => ({ key, name: "", code: "", unit: "kg", qty: "", price: "", minStock: "" });
const VAT = 0.12; // NDS stavkasi — qoldiq × narxdan hisoblanadi, bazaga narx NDS'siz yoziladi
const GRID = "xl:grid-cols-[minmax(160px,1fr)_104px_80px_96px_104px_96px_104px_116px_32px]";
/** Qatordan summa, NDS va jami: bo'sh yoki xato qiymatda 0. */
const amount = (r: Row) => {
  const sum = (Number(r.qty) || 0) * (Number(r.price) || 0);
  return { sum, nds: sum * VAT, total: sum * (1 + VAT) };
};

/** Qo'lda xomashyo qo'shish: bir nechta qator birdan, saqlanganda ro'yxatga tushadi va boshlang'ich qoldiq yoziladi. */
export function MaterialsForm({ children }: { children?: React.ReactNode }) {
  const [state, action, pending] = useActionState(importMaterials, undefined);
  const [rows, setRows] = useState<Row[]>([blank(1), blank(2), blank(3)]);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.name.trim());
  const totals = rows.reduce((a, r) => { const x = amount(r); return { sum: a.sum + x.sum, nds: a.nds + x.nds, total: a.total + x.total }; }, { sum: 0, nds: 0, total: 0 });
  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      <input type="hidden" name="rows" value={JSON.stringify(filled.map((r) => ({ name: r.name, code: r.code, unit: r.unit, qty: r.qty, price: r.price, minStock: r.minStock })))} />
      {children}
      <div className={cn("hidden gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 xl:grid", GRID)}>
        <span>Nomi *</span><span>Kodi</span><span>Birlik</span><span>Qoldiq</span><span>Narx (birlik)</span><span>Minimal</span>
        <span className="text-right">NDS {fmtNum(VAT * 100)}%</span><span className="text-right">Jami summa</span><span />
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const a = amount(r);
          return (
          <div key={r.key} className={cn("grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-2 xl:items-center xl:border-0 xl:p-0", GRID)}>
            <Input placeholder="Sement M400" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} className="col-span-2 xl:col-span-1" />
            <Input placeholder="avto" value={r.code} onChange={(e) => update(r.key, { code: e.target.value })} />
            <Select value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <Input type="number" step="0.001" min="0" placeholder="0" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
            <Input type="number" step="0.01" min="0" placeholder="0" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} />
            <Input type="number" step="0.001" min="0" placeholder="0" value={r.minStock} onChange={(e) => update(r.key, { minStock: e.target.value })} />
            <div className="flex h-10 items-center justify-between gap-2 px-1 text-sm xl:justify-end">
              <span className="text-xs text-slate-400 xl:hidden">NDS {fmtNum(VAT * 100)}%</span>
              <span className="tabular text-slate-600">{a.sum > 0 ? fmtNum(a.nds) : <span className="text-slate-300">—</span>}</span>
            </div>
            <div className="flex h-10 items-center justify-between gap-2 px-1 text-sm xl:justify-end">
              <span className="text-xs text-slate-400 xl:hidden">Jami summa</span>
              <span className="tabular font-semibold text-slate-900">{a.sum > 0 ? fmtNum(a.total) : <span className="text-slate-300">—</span>}</span>
            </div>
            <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))} className="flex h-10 items-center justify-center text-slate-400 hover:text-red-600" aria-label="O'chirish"><X size={16} /></button>
          </div>
          );
        })}
      </div>

      {totals.sum > 0 && (
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">NDS&apos;siz: <b className="text-slate-800">{money(totals.sum)}</b></span>
          <span className="text-slate-500">NDS {fmtNum(VAT * 100)}%: <b className="text-slate-800">{money(totals.nds)}</b></span>
          <span className="text-slate-500">Jami: <b className="text-slate-900">{money(totals.total)}</b></span>
        </div>
      )}
      <button type="button" onClick={() => setRows((rs) => [...rs, blank(Date.now())])} className="text-sm font-medium hover:underline"><span className="inline-flex items-center gap-1"><Plus size={14} /> Qator qo&apos;shish</span></button>
      <p className="text-xs text-slate-500">NDS {fmtNum(VAT * 100)}% va jami summa qoldiq × narxdan hisoblanadi (so&apos;m) — skladga narx NDS&apos;siz yoziladi. Kodi bo&apos;sh qolsa nomdan yasaladi. Qoldiq kiritilsa u boshlang&apos;ich qoldiq sifatida skladga yoziladi (Harakat jurnalida &quot;Qo&apos;lda&quot;). Mavjud nom bo&apos;lsa — qoldiq ustiga qo&apos;shiladi.</p>
      <Button disabled={pending || filled.length === 0}><PackagePlus size={15} /> {pending ? "Saqlanmoqda…" : `Saqlash${filled.length ? ` (${filled.length})` : ""}`}</Button>
    </form>
  );
}
