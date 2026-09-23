"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, X } from "lucide-react";
import { ExcelImport } from "@/components/excel-import";
import { importCatalogProducts } from "@/app/(app)/orders/catalog-actions";
import { Button } from "@/components/ui";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { PRODUCT_KINDS } from "@/lib/catalog";

/**
 * Mahsulot spravochnigiga Excel fayldan ko'p mahsulotni birdan qo'shish.
 * Ochiq turgan papkaga tushadi; kodi yoki nomi bo'yicha mavjud mahsulot topilsa — yangilanadi.
 */
export function ProductExcelImport({ groupId, groupName, onDone, onCancel }: {
  groupId?: string | null;
  groupName?: string | null;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  return (
    <ExcelImport
      action={importCatalogProducts}
      submitLabel="Mahsulotlarni qo'shish"
      templateName="mahsulot-namuna"
      example={{ name: "PK 71-12-8 A 400", code: "", kind: PRODUCT_KINDS[1], unit: "dona", price: 1850000, note: "Plita, uzunligi 7,1 m" }}
      merge={{ unitKeys: ["unit"], sum: [] }}
      allowExtra
      onSuccess={() => { router.refresh(); onDone?.(); }}
      fields={[
        { key: "name", label: "Mahsulot nomi", required: true, synonyms: [...FIELD_SYNONYMS.product, ...FIELD_SYNONYMS.material] },
        { key: "code", label: "Kod", hint: "bo'sh bo'lsa — avtomatik (1C dagidek)", synonyms: ["kod", "code", "код", "artikul", "артикул"] },
        { key: "kind", label: "Tovar turi", hint: PRODUCT_KINDS.join(", "), synonyms: ["tur", "turi", "вид", "тип"] },
        { key: "unit", label: "O'lchov birligi", hint: "m³, dona, m², m, t — tanilmasa «dona»", synonyms: FIELD_SYNONYMS.unit },
        { key: "price", label: "Sotuv narxi", hint: "bo'sh bo'lsa 0", synonyms: FIELD_SYNONYMS.price },
        { key: "note", label: "Izoh", synonyms: ["izoh", "note", "примеч", "коммент", "tavsif"] },
      ]}
    >
      <input type="hidden" name="groupId" value={groupId ?? ""} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-slate-600">Joylashuvi: <b className="text-slate-900">{groupName ?? "Ro'yxat ildizi"}</b> · fayldagi har qator bitta mahsulot. Nomi yoki kodi mos kelsa — yangilanadi, yangisi qo&apos;shilmaydi.</p>
        {onCancel && <Button size="sm" variant="ghost" type="button" onClick={onCancel}><X size={15} /> Yopish</Button>}
      </div>
    </ExcelImport>
  );
}

/** Sozlamalar → Beton markalari: «Excel orqali qo'shish» tugmasi va ochiladigan panel. */
export function ProductExcelPanel() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <FileSpreadsheet size={15} /> Excel orqali qo&apos;shish
      </Button>
    );
  }
  return (
    <div className="w-full rounded-(--radius-card) border border-slate-200 bg-slate-50/60 p-4">
      <ProductExcelImport onCancel={() => setOpen(false)} onDone={() => setOpen(false)} />
    </div>
  );
}
