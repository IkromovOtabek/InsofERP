"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { addStock } from "../actions";
import { ProductSelect } from "@/components/product-select";
import type { CatalogGroup, CatalogProduct } from "@/components/product-picker";
import { Button, Field, FormActions, FormError, Input, LinkButton, Select, Textarea } from "@/components/ui";

type Opt = { id: string; name: string };

export function AddForm({ products, groups, canCreateProduct, warehouses }: {
  products: CatalogProduct[];
  groups: CatalogGroup[];
  canCreateProduct: boolean;
  warehouses: Opt[];
}) {
  const [state, action, pending] = useActionState(addStock, undefined);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const unit = products.find((p) => p.id === productId)?.unit ?? "dona";
  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      {/* Zayavkadagi bilan bir xil spravochnik: nom terib ham, «…» orqali papkalardan ham tanlanadi */}
      <Field label="Mahsulot *" hint="Nomini yozing yoki «…» tugmasidan ro'yxatdan tanlang">
        <ProductSelect name="productId" products={products} groups={groups} canCreate={canCreateProduct} value={productId} onChange={setProductId} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`Miqdor, ${unit} *`}><Input name="qty" type="number" step="1" min="1" placeholder="10" required autoFocus /></Field>
        <Field label="Sklad *"><Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      </div>
      <Field label="Izoh" hint="Masalan: 17.09 smena, qolipdan chiqarildi"><Textarea name="note" /></Field>
      <FormActions>
        <Button disabled={pending || !productId}><Plus size={16} /> {pending ? "Yozilmoqda…" : "Qo'shish"}</Button>
        <LinkButton href="/stock?tab=capacity" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
