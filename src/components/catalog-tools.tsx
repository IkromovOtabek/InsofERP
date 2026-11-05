"use client";

import { useActionState, useEffect } from "react";
import { FileSpreadsheet, FolderPlus, Grid3x3, Plus, Save } from "lucide-react";
import { createCatalogProduct, createProductGroup, renameCatalogProduct } from "@/lib/catalog-actions";
import { createCatalogMaterial, createMaterialGroup } from "@/lib/material-actions";
import { MATERIAL_CATEGORY_OPTIONS } from "@/lib/material-category";
import type { PickerCtx } from "@/components/folder-picker";
import type { CatalogProduct } from "@/components/product-picker";
import { ProductExcelImport } from "@/components/product-excel-import";
import { ProductMatrixAdd } from "@/components/product-matrix-add";
import { ProductDuplicates } from "@/components/product-duplicates";
import { MoneyInput } from "@/components/money-input";
import { PRODUCT_UNITS, MATERIAL_UNITS, unitLabel } from "@/lib/unit";
import { PRODUCT_KINDS } from "@/lib/catalog";
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";

/**
 * Spravochnik oynalarining umumiy asboblari va qo'shish formalari.
 *
 * Mahsulot ro'yxati qayerda ko'rinsa (zayavka, sklad, ishlab chiqarish, retsept ingredienti) —
 * asboblar qatori ham, formalar ham aynan shu yerdan olinadi, shuning uchun hamma joyda bir xil.
 */

export type ProductPanel = "product" | "group" | "excel" | "matrix" | "dupes" | null;
export type MaterialPanel = "material" | "group" | null;

/** Mahsulot asboblari: Yangi · Papka · Excel · Matritsa · (dublikat bo'lsa) Dublikat. `addOnly` — faqat Yangi · Papka. */
export function ProductTools({ toggle, dupes, mixed, addOnly }: { toggle: (p: ProductPanel) => void; dupes: CatalogProduct[][]; mixed?: boolean; /** Faqat «Yangi mahsulot» va «Papka» */ addOnly?: boolean }) {
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => toggle("product")}>
        <Plus size={15} /> Yangi mahsulot
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => toggle("group")} title="Yangi mahsulot papkasi">
        <FolderPlus size={15} /> {mixed ? "Mahsulot papkasi" : "Papka"}
      </Button>
      {!addOnly && (<>
      {/* Ko'p mahsulotni bittalab emas, tayyor Excel ro'yxatdan qo'shish */}
      <Button type="button" size="sm" variant="ghost" onClick={() => toggle("excel")} title="Ochiq papkaga Excel fayldan ko'p mahsulotni birdan qo'shish">
        <FileSpreadsheet size={15} /> Excel orqali qo&apos;shish
      </Button>
      {/* Marka × o'lchov kesishmasi: bir necha o'nlab nomni qo'lda yozmaslik uchun */}
      <Button type="button" size="sm" variant="ghost" onClick={() => toggle("matrix")} title="Qator × ustun matritsasi bilan ko'p mahsulotni birdan qo'shish">
        <Grid3x3 size={15} /> Matritsa
      </Button>
      {dupes.length > 0 && (
        <Button type="button" size="sm" variant="ghost" onClick={() => toggle("dupes")} className="text-amber-700 hover:text-amber-900" title="Bir xil nomli mahsulotlarni bitta qilib birlashtirish">
          Dublikat: {dupes.length} nom
        </Button>
      )}
      </>)}
    </>
  );
}

/** Mahsulot paneli — tanlangan asbobga mos forma. */
export function ProductPanelBody({ panel, ctx, dupes, onDone, onCancel }: {
  panel: ProductPanel; ctx: PickerCtx; dupes: CatalogProduct[][]; onDone: () => void; onCancel: () => void;
}) {
  if (!panel) return null;
  if (panel === "group") return <NewProductGroupForm ctx={ctx} onDone={onDone} onCancel={onCancel} />;
  if (panel === "excel") return <ProductExcelImport groupId={ctx.groupId} groupName={ctx.groupName} onDone={onDone} onCancel={onCancel} />;
  if (panel === "matrix") return <ProductMatrixAdd groupId={ctx.groupId} groupName={ctx.groupName} onDone={onDone} onCancel={onCancel} />;
  if (panel === "dupes") return <ProductDuplicates groups={dupes} onDone={onDone} onCancel={onCancel} />;
  return <NewProductForm ctx={ctx} onDone={onDone} onCancel={onCancel} />;
}

/** Xomashyo asboblari: Yangi · Papka. */
export function MaterialTools({ toggle, mixed }: { toggle: (p: MaterialPanel) => void; mixed?: boolean }) {
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => toggle("material")}>
        <Plus size={15} /> Yangi xomashyo
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => toggle("group")} title="Yangi xomashyo papkasi">
        <FolderPlus size={15} /> {mixed ? "Xomashyo papkasi" : "Papka"}
      </Button>
    </>
  );
}

/** Xomashyo paneli — tanlangan asbobga mos forma. */
export function MaterialPanelBody({ panel, ctx, onDone, onCancel }: {
  panel: MaterialPanel; ctx: PickerCtx; onDone: () => void; onCancel: () => void;
}) {
  if (!panel) return null;
  return panel === "group"
    ? <NewMaterialGroupForm ctx={ctx} onDone={onDone} onCancel={onCancel} />
    : <NewMaterialForm ctx={ctx} onDone={onDone} onCancel={onCancel} />;
}

/**
 * Bir xil nomli mahsulotlar: nom harf-raqamlargacha solishtiriladi — bo'sh joy, tire,
 * nuqta va katta-kichik harf farqi hisobga olinmaydi ("PK 61-10-8" = "pk61108").
 */
export function duplicateNames(products: CatalogProduct[]) {
  const by = new Map<string, CatalogProduct[]>();
  for (const p of products) {
    const k = p.name.toLowerCase().replace(/[^a-z0-9а-яёўқғҳ]+/gi, "");
    if (!k) continue;
    const list = by.get(k);
    if (list) list.push(p); else by.set(k, [p]);
  }
  return [...by.values()].filter((l) => l.length > 1);
}

/** Yangi mahsulot papkasi — ingredient tanlagichda ham ishlatiladi. */
export function NewProductGroupForm({ ctx, onDone, onCancel }: { ctx: PickerCtx; onDone: () => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createProductGroup, undefined);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="parentId" value={ctx.groupId ?? ""} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Papka nomi *" className="min-w-52 flex-1"><Input name="name" required autoComplete="off" placeholder="Masalan: Plita" /></Field>
        <Button size="sm" disabled={pending}><FolderPlus size={15} /> Qo&apos;shish</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>
      </div>
      <p className="text-xs text-slate-600">Joylashuvi: <b>{ctx.groupName ?? "Ro'yxat ildizi"}</b></p>
      <FormError error={state?.error} />
    </form>
  );
}

/** Yangi mahsulot — ingredient tanlagichda ham ishlatiladi. */
export function NewProductForm({ ctx, onDone, onCancel }: { ctx: PickerCtx; onDone: () => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createCatalogProduct, undefined);
  // Mavjud nom kiritilgan bo'lsa server yangisini ochmaydi, mavjudini yangilaydi va shuni aytadi
  useEffect(() => { if (state?.ok && !state.note) onDone(); }, [state, onDone]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={ctx.groupId ?? ""} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Mahsulot nomi *" className="sm:col-span-3"><Input name="name" required autoComplete="off" placeholder="Masalan: PK 71-12-8 A 400" /></Field>
        {/* Kod o'rniga: 1 dona plitadan necha kub chiqadi — ishlab chiqarish samaradorligi m³ da */}
        <Field label="1 dona hajmi, m³" hint="bo'sh — taxminiy"><Input name="volumeM3" inputMode="decimal" autoComplete="off" placeholder="1,05" /></Field>
        <Field label="Tovar turi">
          <Select name="kind" defaultValue={PRODUCT_KINDS[1]}>
            {PRODUCT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
        <Field label="O'lchov birligi *">
          <Select name="unit" defaultValue="dona">{PRODUCT_UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="Sotuv narxi"><MoneyInput name="price" defaultValue="0" /></Field>
        <Field label="Papka"><Input value={ctx.groupName ?? "Ro'yxat ildizi"} readOnly /></Field>
        <Field label="Izoh" className="sm:col-span-4"><Textarea name="note" rows={2} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending}><Plus size={15} /> Saqlash</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>
        <span className="text-xs text-slate-600">Beton markasi bo&apos;lsa retseptni <b>Retseptlar</b> bo&apos;limidan kiriting.</span>
      </div>
      <FormError error={state?.error} />
      {/* "Bu nomli mahsulot bor edi — yangisi ochilmadi" xabari shu yerda chiqadi */}
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}

/** Mavjud mahsulot nomini tuzatish — tanlagichdagi qalam va Sklad → Tayyor mahsulot qo'shish. */
export function RenameProductForm({ product, onDone, onCancel }: { product: Pick<CatalogProduct, "id" | "name" | "unit" | "volumeM3" | "m3">; onDone: () => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(renameCatalogProduct.bind(null, product.id), undefined);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mahsulot nomi *" hint={`${product.unit} — o'zgarmaydi`} className="min-w-64 flex-1">
          <Input name="name" required autoComplete="off" defaultValue={product.name} autoFocus />
        </Field>
        {/* Beton (m³) o'zi kub — hajm faqat dona / m² mahsulotda */}
        {product.unit !== "m³" && (
          <Field label={`1 ${product.unit} hajmi, m³`} hint="bo'sh — taxminiy" className="w-36">
            <Input name="volumeM3" inputMode="decimal" autoComplete="off" defaultValue={product.volumeM3 != null ? String(product.volumeM3).replace(".", ",") : ""} placeholder={product.m3 ?? "1,05"} />
          </Field>
        )}
        <Button size="sm" disabled={pending}><Save size={15} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>
      </div>
      <p className="text-xs text-slate-600">Yangi nom eski zayavka, sklad va hisobotlarda ham ko&apos;rinadi (hujjatlar mahsulotga bog&apos;langan, nomga emas).</p>
      <FormError error={state?.error} />
    </form>
  );
}

/** Yangi xomashyo papkasi — ingredient tanlagichda ham ishlatiladi. */
export function NewMaterialGroupForm({ ctx, onDone, onCancel }: { ctx: PickerCtx; onDone: () => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createMaterialGroup, undefined);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="parentId" value={ctx.groupId ?? ""} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Papka nomi *" className="min-w-52 flex-1"><Input name="name" required autoComplete="off" placeholder="Masalan: Inertlar" /></Field>
        <Field label="Kod" hint="bo'sh qoldirsangiz — avtomatik" className="w-28"><Input name="code" autoComplete="off" /></Field>
        <Button size="sm" disabled={pending}><FolderPlus size={15} /> Qo&apos;shish</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>
      </div>
      <p className="text-xs text-slate-600">Joylashuvi: <b>{ctx.groupName ?? "Ro'yxat ildizi"}</b></p>
      <FormError error={state?.error} />
    </form>
  );
}

/** Yangi xomashyo — ingredient tanlagichda ham ishlatiladi. */
export function NewMaterialForm({ ctx, onDone, onCancel }: { ctx: PickerCtx; onDone: () => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createCatalogMaterial, undefined);
  useEffect(() => { if (state?.ok && !state.note) onDone(); }, [state, onDone]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={ctx.groupId ?? ""} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Kod" hint="bo'sh bo'lsa nomdan"><Input name="code" autoComplete="off" placeholder="CEM400" /></Field>
        <Field label="Xomashyo nomi *" className="sm:col-span-3"><Input name="name" required autoComplete="off" placeholder="Masalan: Sement M400" /></Field>
        <Field label="O'lchov birligi *">
          <Select name="unit" defaultValue="kg">{MATERIAL_UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</Select>
        </Field>
        <Field label="Minimal qoldiq" hint="kam qolsa signal"><Input name="minStock" type="number" step="0.001" min="0" placeholder="0" /></Field>
        <Field label="Kategoriya">
          <Select name="category" defaultValue="XOMASHYO">{MATERIAL_CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="Papka"><Input value={ctx.groupName ?? "Ro'yxat ildizi"} readOnly /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending}><Plus size={15} /> Saqlash</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>
        <span className="text-xs text-slate-600">Qoldiqni <b>Xomashyo qo&apos;shish</b> jadvalidan kiritasiz.</span>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}
