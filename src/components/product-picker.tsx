"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, FolderPlus, Grid3x3, Plus } from "lucide-react";
import { createCatalogProduct, createProductGroup, deleteCatalogProduct, deleteProductGroup } from "@/lib/catalog-actions";
import { FolderPicker, type PickerCtx } from "@/components/folder-picker";
import { ProductExcelImport } from "@/components/product-excel-import";
import { ProductMatrixAdd } from "@/components/product-matrix-add";
import { ProductDuplicates } from "@/components/product-duplicates";
import { DeleteButton } from "@/components/delete-button";
import { PRODUCT_UNITS } from "@/lib/unit";
import { PRODUCT_KINDS } from "@/lib/catalog";
import { MoneyInput } from "@/components/money-input";
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";

export type CatalogProduct = { id: string; code: string; name: string; kind: string | null; unit: string; price: string; groupId: string | null };
export type CatalogGroup = { id: string; code: string; name: string; parentId: string | null };

type Panel = "product" | "group" | "excel" | "matrix" | "dupes" | null;

/**
 * Mahsulot spravochnigi — 1C dagi "TOVARLAR" oynasi (umumiy `FolderPicker` ustiga qurilgan).
 * Papkalar ichiga kiriladi, qidiruv butun ro'yxat bo'yicha ishlaydi,
 * "Yangi / Papka / Excel / Matritsa" bilan ochiq papkaga mahsulot qo'shiladi.
 * Ro'yxatda bir xil nomli mahsulot bo'lsa "Dublikat" tugmasi chiqadi — birlashtirish uchun.
 */
export function ProductPicker({ open, products, groups, onPick, onClose, canCreate, hint }: {
  open: boolean;
  products: CatalogProduct[];
  groups: CatalogGroup[];
  onPick: (productId: string) => void;
  onClose: () => void;
  canCreate: boolean;
  hint?: (p: CatalogProduct) => string | null;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  useEffect(() => { if (!open) setPanel(null); }, [open]);

  const dupes = duplicateNames(products);
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const afterCreate = () => { setPanel(null); router.refresh(); };

  return (
    <FolderPicker
      open={open}
      title="MAHSULOTLAR"
      ariaLabel="Mahsulot tanlash"
      nameLabel="Mahsulot nomi"
      cols={[
        { label: "Turi" },
        // Birlik shu yerda ko'rinsin — zayavkadagi "Hajmi" maydoni aynan shu birlikda to'ldiriladi
        { label: "Birlik", className: "w-20" },
        { label: "Kod", className: "w-24", right: true },
      ]}
      items={products.map((p) => ({
        id: p.id, name: p.name, code: p.code, groupId: p.groupId,
        hint: hint?.(p) ?? null,
        cells: [p.kind || "—", p.unit || "—", p.code],
      }))}
      groups={groups}
      emptyText="Bu papka bo'sh"
      noMatchText="Mos mahsulot topilmadi"
      onPick={onPick}
      onClose={onClose}
      /* O'chirish: hujjatlarda ishlatilmagan mahsulot butunlay o'chadi, ishlatilgani arxivga olinadi */
      rowAction={canCreate ? (row) => (
        <DeleteButton
          action={row.kind === "group" ? deleteProductGroup : deleteCatalogProduct}
          id={row.id}
          name={row.name}
          title={row.kind === "group" ? "Papkani o'chirish" : "Mahsulotni o'chirish"}
        />
      ) : undefined}
      tools={() => canCreate ? (
        <>
          <Button type="button" size="sm" variant="secondary" onClick={() => toggle("product")}>
            <Plus size={15} /> Yangi
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => toggle("group")} title="Yangi papka">
            <FolderPlus size={15} /> Papka
          </Button>
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
        </>
      ) : null}
      panel={(ctx) => {
        if (!canCreate || !panel) return null;
        if (panel === "group") return <NewProductGroupForm ctx={ctx} onDone={afterCreate} onCancel={() => setPanel(null)} />;
        if (panel === "excel") return <ProductExcelImport groupId={ctx.groupId} groupName={ctx.groupName} onDone={afterCreate} onCancel={() => setPanel(null)} />;
        if (panel === "matrix") return <ProductMatrixAdd groupId={ctx.groupId} groupName={ctx.groupName} onDone={afterCreate} onCancel={() => setPanel(null)} />;
        if (panel === "dupes") return <ProductDuplicates groups={dupes} onDone={afterCreate} onCancel={() => setPanel(null)} />;
        return <NewProductForm ctx={ctx} onDone={afterCreate} onCancel={() => setPanel(null)} />;
      }}
    />
  );
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
        <Field label="Kod" hint="bo'sh qoldirsangiz — avtomatik" className="w-28"><Input name="code" autoComplete="off" /></Field>
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
        <Field label="Kod" hint="avtomatik" className="sm:col-span-1"><Input name="code" autoComplete="off" placeholder="0" /></Field>
        <Field label="Mahsulot nomi *" className="sm:col-span-3"><Input name="name" required autoComplete="off" placeholder="Masalan: PK 71-12-8 A 400" /></Field>
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
