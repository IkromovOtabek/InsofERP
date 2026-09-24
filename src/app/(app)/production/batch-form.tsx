"use client";

import { useActionState, useState } from "react";
import { createBatch } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Select, Textarea, FormActions } from "@/components/ui";

/** unit — zayavkadagi mahsulot birligi ("m³", "dona"…). */
type Order = { id: string; orderNo: string; customer: string; productId: string; remainingM3: number; unit: string };
type Product = { id: string; name: string; hasRecipe: boolean; unit: string };
type Wh = { id: string; name: string };

export function BatchForm({ orders, products, warehouses }: { orders: Order[]; products: Product[]; warehouses: Wh[] }) {
  const [state, action, pending] = useActionState(createBatch, undefined);
  const [orderId, setOrderId] = useState("");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const order = orders.find((o) => o.id === orderId);
  const unit = products.find((p) => p.id === productId)?.unit ?? "m³";

  const pickOrder = (id: string) => {
    setOrderId(id);
    const o = orders.find((x) => x.id === id);
    if (o) { setProductId(o.productId); setQty(String(o.remainingM3)); }
  };

  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Zayavka" hint="Ixtiyoriy — zayavkasiz zames (sklad uchun) ham bo'ladi">
        <Select name="orderId" value={orderId} onChange={(e) => pickOrder(e.target.value)}>
          <option value="">— zayavkasiz —</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNo} · {o.customer} · qoldi {o.remainingM3} {o.unit}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Marka *">
          <Select name="productId" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!!order}>
            {products.map((p) => <option key={p.id} value={p.id} disabled={!p.hasRecipe}>{p.name}{!p.hasRecipe ? " (retsept yo'q)" : ""}</option>)}
          </Select>
          {order && <input type="hidden" name="productId" value={productId} />}
        </Field>
        <Field label={`Miqdor, ${unit} *`}><Input name="qtyM3" type="number" step={unit === "m³" ? "0.5" : "1"} min={unit === "m³" ? "0.5" : "1"} value={qty} onChange={(e) => setQty(e.target.value)} required /></Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Smena"><Select name="shift" defaultValue="1"><option value="1">1-smena</option><option value="2">2-smena</option><option value="3">3-smena</option></Select></Field>
        <Field label="Sklad *"><Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      </div>
      <Field label="Izoh"><Textarea name="note" /></Field>
      <FormActions>
        <Button disabled={pending}>{pending ? "Yozilmoqda…" : "Zamesni qayd etish"}</Button>
        <LinkButton href="/production" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
