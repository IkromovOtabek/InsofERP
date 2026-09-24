"use client";

import { useState } from "react";
import { ProductField } from "@/components/product-field";
import { ProductPicker, type CatalogGroup, type CatalogProduct } from "@/components/product-picker";

/**
 * Mahsulot tanlash maydoni — zayavkadagi bilan bir xil 1C uslubidagi spravochnik,
 * lekin bitta qatorda ishlatiladigan tayyor ko'rinishda: nom terilganda ro'yxat qisqaradi,
 * «…» tugmasi papkali oynani ochadi, `canCreate` bo'lsa o'sha oynadan yangi mahsulot,
 * papka, Excel va matritsa bilan qo'shish ham mumkin.
 *
 * `name` berilsa formaga yashirin maydon bo'lib tanlangan mahsulot id'si ketadi —
 * shuning uchun oddiy `<Select name="productId">` o'rniga to'g'ridan-to'g'ri qo'yiladi.
 * `value` berilsa boshqariladigan, bo'lmasa o'z holatini yuritadi.
 */
export function ProductSelect({ name, products, groups, canCreate = false, value, onChange, hint, disabled }: {
  name?: string;
  products: CatalogProduct[];
  groups: CatalogGroup[];
  canCreate?: boolean;
  value?: string;
  onChange?: (productId: string) => void;
  hint?: (p: CatalogProduct) => string | null;
  disabled?: boolean;
}) {
  const [inner, setInner] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const id = value !== undefined ? value : inner;
  const pick = (productId: string) => {
    if (value === undefined) setInner(productId);
    onChange?.(productId);
  };
  const selected = products.find((p) => p.id === id) ?? null;

  return (
    <>
      {name && <input type="hidden" name={name} value={id} />}
      {disabled ? (
        // Masalan zayavkaga bog'langan zames: mahsulot zayavkadan keladi, almashtirilmaydi
        <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
          {selected ? `${selected.name}${selected.code ? ` (${selected.code})` : ""}` : "—"}
        </div>
      ) : (
        <ProductField products={products} value={id} onPick={pick} onOpenPicker={() => setOpen(true)} hint={hint} />
      )}
      <ProductPicker
        open={open}
        products={products}
        groups={groups}
        canCreate={canCreate}
        onClose={() => setOpen(false)}
        onPick={pick}
        hint={hint}
      />
    </>
  );
}
