"use client";

import { X, Plus } from "lucide-react";

import { fmtNum, isoDate } from "@/lib/format";

import { useActionState, useState } from "react";
import { createReceipt } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Select, Textarea, FormActions } from "@/components/ui";

type Opt = { id: string; name: string };
type Material = Opt & { unit: string };
type Row = { key: number; materialId: string; qty: string; price: string };

export function ReceiptForm({ suppliers, warehouses, materials }: { suppliers: Opt[]; warehouses: Opt[]; materials: Material[] }) {
  const [state, action, pending] = useActionState(createReceipt, undefined);
  const [rows, setRows] = useState<Row[]>([{ key: 1, materialId: materials[0]?.id ?? "", qty: "", price: "" }]);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);

  return (
    <form action={action} className="max-w-3xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Yetkazuvchi *">
          <Select name="supplierId" defaultValue="" required>
            <option value="" disabled>Tanlang…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Sklad *"><Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Xomashyo *</div>
        <div className="space-y-2">
          {rows.map((r) => {
            const unit = materials.find((m) => m.id === r.materialId)?.unit ?? "";
            return (
              <div key={r.key} className="space-y-2 rounded-lg border border-slate-100 p-2 sm:grid sm:grid-cols-[1fr_140px_50px_160px_40px] sm:items-center sm:gap-2 sm:space-y-0 sm:border-0 sm:p-0">
                <Select name="materialId[]" value={r.materialId} onChange={(e) => update(r.key, { materialId: e.target.value })}>
                  {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
                <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:contents">
                  <Input name="qty[]" type="number" step="0.001" min="0" placeholder="Miqdor" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} required />
                  <span className="text-sm text-slate-500">{unit}</span>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:contents">
                  <Input name="price[]" type="number" step="0.01" min="0" placeholder={`Narx / ${unit}`} value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} required />
                  <button type="button" onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs)} className="flex h-10 w-10 items-center justify-center text-slate-400 hover:text-red-600 sm:h-auto sm:w-auto"><X size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setRows((rs) => [...rs, { key: Date.now(), materialId: materials[0]?.id ?? "", qty: "", price: "" }])} className="mt-2 text-sm font-medium hover:underline"><span className="inline-flex items-center gap-1"><Plus size={14} /> Qator qo'shish</span></button>
        <div className="mt-3 text-right text-base font-semibold">Jami: {fmtNum(total)} so'm</div>
      </div>

      <Field label="Izoh"><Textarea name="note" placeholder="Nakladnoy raqami, mashina, tarozi ko'rsatkichi…" /></Field>
      <FormActions>
        <Button disabled={pending}>{pending ? "Yozilmoqda…" : "Kirimni qayd etish"}</Button>
        <LinkButton href="/receipts" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
