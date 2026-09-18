"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { addStock } from "../actions";
import { Button, Field, FormActions, FormError, Input, LinkButton, Select, Textarea } from "@/components/ui";

type Opt = { id: string; name: string };

export function AddForm({ products, warehouses }: { products: (Opt & { unit: string })[]; warehouses: Opt[] }) {
  const [state, action, pending] = useActionState(addStock, undefined);
  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Mahsulot *">
        <Select name="productId" defaultValue={products[0]?.id}>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Miqdor *"><Input name="qty" type="number" step="1" min="1" placeholder="10" required autoFocus /></Field>
        <Field label="Sklad *"><Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      </div>
      <Field label="Izoh" hint="Masalan: 17.09 smena, qolipdan chiqarildi"><Textarea name="note" /></Field>
      <FormActions>
        <Button disabled={pending || !products.length}><Plus size={16} /> {pending ? "Yozilmoqda…" : "Qo'shish"}</Button>
        <LinkButton href="/astatka" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
