"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Settings } from "lucide-react";
import { Button, LinkButton } from "@/components/ui";
import { RenameProductForm } from "@/components/catalog-tools";
import type { CatalogProduct } from "@/components/product-picker";

/**
 * Retsept sahifasidagi «Mahsulot» kartasi sarlavhasi: nomi va «1 dona hajmi, m³» shu yerda tuzatiladi
 * (`renameCatalogProduct` — tanlagichdagi qalam bilan bir xil qoida). Avval «Tahrirlash» Sozlamalarga olib borardi —
 * u faqat direktorda, ishlab chiqarish xodimiga 403 chiqardi. Sozlamalar havolasi (narx, birlik, tur) faqat ruxsati borga.
 */
export function ProductCardHeader({ product, canRename, settingsHref }: {
  product: Pick<CatalogProduct, "id" | "name" | "unit" | "volumeM3" | "m3">;
  canRename: boolean;
  settingsHref: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Mahsulot</h2>
        <div className="flex flex-wrap gap-1">
          {canRename && !open && <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}><Pencil size={13} /> Nomini tahrirlash</Button>}
          {settingsHref && <LinkButton href={settingsHref} variant="ghost" size="sm"><Settings size={13} /> Sozlamalarda</LinkButton>}
        </div>
      </div>
      {open && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <RenameProductForm product={product} onDone={() => { setOpen(false); router.refresh(); }} onCancel={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
