"use client";

import { X, Plus } from "lucide-react";

import { fmtNum, isoDate } from "@/lib/format";

import { useActionState, useState } from "react";
import { createOrder } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Select, Textarea, FormActions, Checkbox } from "@/components/ui";

type Product = { id: string; code: string; name: string; price: string; unit: string };
type Customer = { id: string; name: string };
type Row = { key: number; productId: string; qtyM3: string; price: string };

export function OrderForm({ customers, products }: { customers: Customer[]; products: Product[] }) {
  const [state, action, pending] = useActionState(createOrder, undefined);
  const [rows, setRows] = useState<Row[]>([{ key: 1, productId: products[0]?.id ?? "", qtyM3: "", price: products[0]?.price ?? "0" }]);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const onProduct = (key: number, productId: string) =>
    update(key, { productId, price: products.find((p) => p.id === productId)?.price ?? "0" });

  const total = rows.reduce((s, r) => s + (Number(r.qtyM3) || 0) * (Number(r.price) || 0), 0);
  const tomorrow = isoDate(new Date(Date.now() + 86400000));

  return (
    <form action={action} className="max-w-3xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mijoz *">
          <Select name="customerId" required defaultValue="">
            <option value="" disabled>Tanlang…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Yetkazish sanasi *"><Input name="deliveryDate" type="date" defaultValue={tomorrow} required /></Field>
      </div>
      <Field label="Obyekt manzili *"><Input name="deliveryAddress" placeholder="Ko'cha, mo'ljal, obyekt nomi" required /></Field>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Mahsulotlar *</div>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="space-y-2 rounded-lg border border-slate-100 p-2 sm:grid sm:grid-cols-[1fr_120px_160px_40px] sm:items-center sm:gap-2 sm:space-y-0 sm:border-0 sm:p-0">
              <Select name="productId[]" value={r.productId} onChange={(e) => onProduct(r.key, e.target.value)}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 sm:contents">
                <Input name="qtyM3[]" type="number" step={products.find((p) => p.id === r.productId)?.unit === "m³" ? "0.5" : "1"} min="0.5" placeholder={products.find((p) => p.id === r.productId)?.unit ?? "m³"} value={r.qtyM3} onChange={(e) => update(r.key, { qtyM3: e.target.value })} required />
                <Input name="price[]" type="number" step="1" min="0" placeholder={`Narx / ${products.find((p) => p.id === r.productId)?.unit ?? "m³"}`} value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} required />
                <button type="button" onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs)} className="flex h-10 w-10 items-center justify-center text-slate-400 hover:text-red-600 sm:h-auto sm:w-auto" aria-label="O'chirish"><X size={16} /></button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows((rs) => [...rs, { key: Date.now(), productId: products[0]?.id ?? "", qtyM3: "", price: products[0]?.price ?? "0" }])} className="mt-2 text-sm font-medium text-slate-700 hover:underline">
          <span className="inline-flex items-center gap-1"><Plus size={14} /> Qator qo'shish</span>
        </button>
        <div className="mt-3 text-right text-base font-semibold">Jami: {fmtNum(total)} so'm</div>
      </div>

      <Checkbox name="needsPump" label="Nasos kerak" />
      <Field label="Izoh"><Textarea name="note" /></Field>

      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash (qoralama)"}</Button>
        <LinkButton href="/orders" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
