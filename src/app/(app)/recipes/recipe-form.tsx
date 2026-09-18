"use client";

import { X, Plus } from "lucide-react";

import { useActionState, useState } from "react";
import { createRecipeVersion } from "./actions";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";

type Material = { id: string; name: string; unit: string };
type Row = { key: number; materialId: string; qtyPerM3: string };

export function RecipeForm({ productId, materials, initial, unit = "m³" }: { productId: string; materials: Material[]; initial: { materialId: string; qtyPerM3: string }[]; unit?: string }) {
  const [state, action, pending] = useActionState(createRecipeVersion.bind(null, productId), undefined);
  const [rows, setRows] = useState<Row[]>(
    initial.length ? initial.map((i, k) => ({ key: k + 1, ...i })) : [{ key: 1, materialId: materials[0]?.id ?? "", qtyPerM3: "" }],
  );
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      <div className="space-y-2">
        {rows.map((r) => {
          const munit = materials.find((m) => m.id === r.materialId)?.unit ?? "";
          return (
            <div key={r.key} className="grid grid-cols-[1fr_140px_50px_40px] items-center gap-2">
              <Select name="materialId[]" value={r.materialId} onChange={(e) => update(r.key, { materialId: e.target.value })}>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <Input name="qtyPerM3[]" type="number" step="0.001" min="0" value={r.qtyPerM3} onChange={(e) => update(r.key, { qtyPerM3: e.target.value })} required />
              <span className="text-sm text-slate-500">{munit}/{unit}</span>
              <button type="button" onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs)} className="text-slate-400 hover:text-red-600"><X size={16} /></button>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => setRows((rs) => [...rs, { key: Date.now(), materialId: materials[0]?.id ?? "", qtyPerM3: "" }])} className="text-sm font-medium hover:underline"><span className="inline-flex items-center gap-1"><Plus size={14} /> Xomashyo qo'shish</span></button>
      <Field label="Izoh (nima o'zgardi)"><Textarea name="note" placeholder="Masalan: laboratoriya sinovi bo'yicha sement 380 → 390 kg" /></Field>
      <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Yangi versiya sifatida saqlash"}</Button>
    </form>
  );
}
