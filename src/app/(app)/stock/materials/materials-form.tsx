"use client";

import { useActionState, useState } from "react";
import { Plus, X, PackagePlus } from "lucide-react";
import { importMaterials } from "../actions";
import { Button, FormError, Input, Select } from "@/components/ui";

type Row = { key: number; name: string; code: string; unit: string; qty: string; price: string; minStock: string };
const UNITS: [string, string][] = [["kg", "kg"], ["t", "t"], ["l", "l"], ["m3", "m³"], ["dona", "dona"], ["m", "m"], ["m2", "m²"]];
const blank = (key: number): Row => ({ key, name: "", code: "", unit: "kg", qty: "", price: "", minStock: "" });

/** Qo'lda xomashyo qo'shish: bir nechta qator birdan, saqlanganda ro'yxatga tushadi va boshlang'ich qoldiq yoziladi. */
export function MaterialsForm({ children }: { children?: React.ReactNode }) {
  const [state, action, pending] = useActionState(importMaterials, undefined);
  const [rows, setRows] = useState<Row[]>([blank(1), blank(2), blank(3)]);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.name.trim());
  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      <input type="hidden" name="rows" value={JSON.stringify(filled.map((r) => ({ name: r.name, code: r.code, unit: r.unit, qty: r.qty, price: r.price, minStock: r.minStock })))} />
      {children}
      <div className="hidden grid-cols-[1fr_120px_90px_110px_120px_110px_32px] gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 lg:grid">
        <span>Nomi *</span><span>Kodi</span><span>Birlik</span><span>Qoldiq</span><span>Narx (birlik)</span><span>Minimal</span><span />
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-2 lg:grid-cols-[1fr_120px_90px_110px_120px_110px_32px] lg:items-center lg:border-0 lg:p-0">
            <Input placeholder="Sement M400" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} className="col-span-2 lg:col-span-1" />
            <Input placeholder="avto" value={r.code} onChange={(e) => update(r.key, { code: e.target.value })} />
            <Select value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <Input type="number" step="0.001" min="0" placeholder="0" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
            <Input type="number" step="0.01" min="0" placeholder="0" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} />
            <Input type="number" step="0.001" min="0" placeholder="0" value={r.minStock} onChange={(e) => update(r.key, { minStock: e.target.value })} />
            <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))} className="flex h-10 items-center justify-center text-slate-400 hover:text-red-600" aria-label="O'chirish"><X size={16} /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRows((rs) => [...rs, blank(Date.now())])} className="text-sm font-medium hover:underline"><span className="inline-flex items-center gap-1"><Plus size={14} /> Qator qo&apos;shish</span></button>
      <p className="text-xs text-slate-500">Kodi bo&apos;sh qolsa nomdan yasaladi. Qoldiq kiritilsa u boshlang&apos;ich qoldiq sifatida skladga yoziladi (Harakat jurnalida &quot;Qo&apos;lda&quot;). Mavjud nom bo&apos;lsa — qoldiq ustiga qo&apos;shiladi.</p>
      <Button disabled={pending || filled.length === 0}><PackagePlus size={15} /> {pending ? "Saqlanmoqda…" : `Saqlash${filled.length ? ` (${filled.length})` : ""}`}</Button>
    </form>
  );
}
