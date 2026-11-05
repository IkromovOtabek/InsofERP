"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { deleteCatalogProduct, deleteProductGroup } from "@/lib/catalog-actions";
import { FolderPicker } from "@/components/folder-picker";
import { DeleteButton } from "@/components/delete-button";
import { ProductPanelBody, ProductTools, RenameProductForm, duplicateNames, type ProductPanel } from "@/components/catalog-tools";
import type { ProductCreate } from "@/lib/catalog";

export { duplicateNames };

export type CatalogProduct = {
  id: string; code: string; name: string; kind: string | null; unit: string; price: string; groupId: string | null;
  /** Reys hisobi (zayavka formasi): 1 dona og'irligi, kg va bir reysga max dona — kartada kiritilgan bo'lsa. */
  weightKg?: number | null; perTrip?: number | null;
};
export type CatalogGroup = { id: string; code: string; name: string; parentId: string | null };

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
  /** "add" — faqat «Yangi mahsulot» va «Papka» (o'chirish, Excel, matritsa, dublikat yo'q) */
  canCreate: ProductCreate;
  hint?: (p: CatalogProduct) => string | null;
}) {
  const router = useRouter();
  const full = canCreate === true;
  const [panel, setPanel] = useState<ProductPanel>(null);
  // Nomini tuzatayotgan mahsulot (qatordagi qalam) — panel o'rnida forma chiqadi
  const [renaming, setRenaming] = useState<CatalogProduct | null>(null);
  useEffect(() => { if (!open) { setPanel(null); setRenaming(null); } }, [open]);

  const dupes = duplicateNames(products);
  const toggle = (p: ProductPanel) => { setRenaming(null); setPanel((cur) => (cur === p ? null : p)); };
  const afterCreate = () => { setPanel(null); setRenaming(null); router.refresh(); };

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
      rowAction={full ? (row) => {
        const p = row.kind === "item" ? products.find((x) => x.id === row.id) : undefined;
        return (
          <span className="inline-flex items-center gap-0.5">
            {p && (
              <button type="button" onClick={() => { setPanel(null); setRenaming(p); }} title="Nomini tahrirlash" aria-label={`${p.name} — nomini tahrirlash`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Pencil size={14} /></button>
            )}
            <DeleteButton
              action={row.kind === "group" ? deleteProductGroup : deleteCatalogProduct}
              id={row.id}
              name={row.name}
              title={row.kind === "group" ? "Papkani o'chirish" : "Mahsulotni o'chirish"}
            />
          </span>
        );
      } : undefined}
      tools={() => (canCreate ? <ProductTools toggle={toggle} dupes={dupes} addOnly={!full} /> : null)}
      panel={(ctx) => (renaming
        ? <RenameProductForm key={renaming.id} product={renaming} onDone={afterCreate} onCancel={() => setRenaming(null)} />
        : canCreate ? <ProductPanelBody panel={panel} ctx={ctx} dupes={dupes} onDone={afterCreate} onCancel={() => setPanel(null)} /> : null)}
    />
  );
}
