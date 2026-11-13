"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { IconButton } from "@/components/ui";
import { EditMaterialForm, type MaterialGroup } from "@/components/material-picker";

/** Qatordan ochiladigan xomashyo kartasi; `unitLocked` — sklad harakati bor (birlik o'zgarmaydi). */
export type EditableMaterial = { id: string; name: string; code: string; unit: string; minStock: number; groupId: string | null; unitLocked: boolean };

const OpenEditor = createContext<((m: EditableMaterial) => void) | null>(null);

/**
 * Sklad → «Qoldiqlar» jadvalidagi qalamlar uchun bitta tahrirlash oynasi (`updateCatalogMaterial`): nomi, birligi,
 * minimal qoldig'i va papkasi. Sozlamalardagi forma faqat direktorda — sklad xodimi xatoni shu yerda tuzatadi.
 * Papkalar ro'yxati sahifaga bir marta yuboriladi (har qatorga emas) — qatordagi tugma shu kontekstdan oynani ochadi.
 */
export function MaterialEditProvider({ groups, children }: { groups: MaterialGroup[]; children: React.ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditableMaterial | null>(null);
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditing(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  return (
    <OpenEditor.Provider value={setEditing}>
      {children}
      {editing && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={() => setEditing(null)}>
          <div role="dialog" aria-label={`${editing.name} — tahrirlash`} onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-(--radius-card) border border-slate-200 bg-white shadow-(--shadow-pop)">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-base font-semibold tracking-tight">Xomashyoni tahrirlash</h2>
              <IconButton icon={X} type="button" label="Yopish" onClick={() => setEditing(null)} />
            </div>
            <div className="p-4">
              <EditMaterialForm key={editing.id} material={editing} groups={groups} unitLocked={editing.unitLocked}
                onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </OpenEditor.Provider>
  );
}

/** Qator nomi yonidagi qalam — `MaterialEditProvider` ichida bo'lmasa chizilmaydi. */
export function MaterialEditButton({ material }: { material: EditableMaterial }) {
  const open = useContext(OpenEditor);
  if (!open) return null;
  return <IconButton icon={Pencil} type="button" label={`${material.name} — tahrirlash`} onClick={() => open(material)} className="ml-1 h-6 w-6 align-middle text-slate-400" />;
}
