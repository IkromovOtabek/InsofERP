"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCatalogProduct, deleteProductGroup } from "@/lib/catalog-actions";
import { FolderPicker } from "@/components/folder-picker";
import { DeleteButton } from "@/components/delete-button";
import { ProductPanelBody, ProductTools, duplicateNames, type ProductPanel } from "@/components/catalog-tools";

export { duplicateNames };

export type CatalogProduct = { id: string; code: string; name: string; kind: string | null; unit: string; price: string; groupId: string | null };
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
  canCreate: boolean;
  hint?: (p: CatalogProduct) => string | null;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<ProductPanel>(null);
  useEffect(() => { if (!open) setPanel(null); }, [open]);

  const dupes = duplicateNames(products);
  const toggle = (p: ProductPanel) => setPanel((cur) => (cur === p ? null : p));
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
      tools={() => (canCreate ? <ProductTools toggle={toggle} dupes={dupes} /> : null)}
      panel={(ctx) => (canCreate ? <ProductPanelBody panel={panel} ctx={ctx} dupes={dupes} onDone={afterCreate} onCancel={() => setPanel(null)} /> : null)}
    />
  );
}
