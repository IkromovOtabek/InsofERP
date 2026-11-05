"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { addStock } from "../actions";
import { ProductSelect } from "@/components/product-select";
import { NewProductForm, RenameProductForm } from "@/components/catalog-tools";
import type { CatalogGroup, CatalogProduct } from "@/components/product-picker";
import { Button, Field, FormActions, FormError, Input, LinkButton, Select, Textarea } from "@/components/ui";

type Opt = { id: string; name: string };

/**
 * Hovliga tayyor mahsulot kirimi. Mahsulot maydoni ostida — zayavkadagi spravochnik kartasi bilan bir xil
 * «Yangi mahsulot» va tanlangan mahsulotning «Nomini tahrirlash» (ikkalasi o'z formasi bilan, shuning uchun
 * asosiy kirim formasidan tashqarida turadi: forma ichida forma bo'lmaydi). Yangi mahsulot yozilgach darrov tanlanadi.
 */
export function AddForm({ products, groups, canCreateProduct, warehouses, clientToken }: {
  products: CatalogProduct[];
  groups: CatalogGroup[];
  canCreateProduct: boolean;
  warehouses: Opt[];
  /** Sahifa ochilganda server bergan bir martalik kalit — ikki marta bosish ikkinchi kirim yozmaydi */
  clientToken?: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(addStock, undefined);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [card, setCard] = useState<"new" | "rename" | null>(null);
  const [groupId, setGroupId] = useState("");
  const selected = products.find((p) => p.id === productId) ?? null;
  const unit = selected?.unit ?? "dona";

  // Yangi mahsulot saqlangach sahifa yangilanadi — ro'yxatda paydo bo'lgan yagona yangi mahsulot shu zahoti tanlanadi
  const known = useRef(new Set(products.map((p) => p.id)));
  const awaitNew = useRef(false);
  useEffect(() => {
    const fresh = products.filter((p) => !known.current.has(p.id));
    known.current = new Set(products.map((p) => p.id));
    if (awaitNew.current && fresh.length === 1) setProductId(fresh[0]!.id);
    if (fresh.length) awaitNew.current = false;
  }, [products]);

  // Papka tanlovi: «Plita / PK» ko'rinishidagi to'liq yo'l bilan
  const folders = useMemo(() => {
    const byId = new Map(groups.map((g) => [g.id, g]));
    const path = (g: CatalogGroup): string => { const p = g.parentId ? byId.get(g.parentId) : undefined; return p ? `${path(p)} / ${g.name}` : g.name; };
    return groups.map((g) => ({ id: g.id, label: path(g) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [groups]);
  const folderName = folders.find((f) => f.id === groupId)?.label ?? null;

  const toggleNew = () => { setGroupId(selected?.groupId ?? ""); setCard((c) => (c === "new" ? null : "new")); };
  const done = (created: boolean) => { awaitNew.current = created; setCard(null); router.refresh(); };

  return (
    <div className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      {/* Zayavkadagi bilan bir xil spravochnik: nom terib ham, «…» orqali papkalardan ham tanlanadi */}
      <div className="space-y-2">
        <Field label="Mahsulot *" hint="Nomini yozing yoki «…» tugmasidan ro'yxatdan tanlang">
          <ProductSelect products={products} groups={groups} canCreate={canCreateProduct} value={productId} onChange={(id) => { setProductId(id); if (card === "rename") setCard(null); }} />
        </Field>
        {canCreateProduct && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant={card === "new" ? "primary" : "secondary"} onClick={toggleNew}><Plus size={15} /> Yangi mahsulot</Button>
            {selected && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setCard((c) => (c === "rename" ? null : "rename"))}><Pencil size={14} /> Nomini tahrirlash</Button>
            )}
          </div>
        )}
      </div>

      {card === "new" && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Yangi mahsulot — spravochnikka qo&apos;shiladi</h3>
            <label className="flex items-center gap-2 text-xs text-slate-600">Papka
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="h-8 w-56">
                <option value="">Ro&apos;yxat ildizi</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            </label>
          </div>
          <NewProductForm ctx={{ groupId: groupId || null, groupName: folderName, query: "" }} onDone={() => done(true)} onCancel={() => setCard(null)} />
        </div>
      )}
      {card === "rename" && selected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <RenameProductForm key={selected.id} product={selected} onDone={() => done(false)} onCancel={() => setCard(null)} />
        </div>
      )}

      <form action={action} className="space-y-5">
        {clientToken && <input type="hidden" name="clientToken" value={clientToken} />}
        <input type="hidden" name="productId" value={productId} />
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
    </div>
  );
}
