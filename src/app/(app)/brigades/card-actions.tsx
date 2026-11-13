"use client";

import { useState, useTransition } from "react";
import { Pencil, X } from "lucide-react";
import { Button, FormError } from "@/components/ui";
import { RowForm, type RowField } from "@/components/row-form";
import type { ActionState } from "@/lib/action";
import { isAccessDenied } from "@/lib/access-denied";

/**
 * Brigada kartasining pastki qismi: «Tahrirlash» (nomi, brigadir, telefon, izoh — `saveBrigade(id)`) va
 * faollashtirish / nofaol qilish (`toggleBrigade`). Server rad etsa (masalan ochiq topshiriq bor) — sababi shu yerda chiqadi.
 */
export function BrigadeCardActions({ save, toggle, fields, active }: {
  save: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  toggle: () => Promise<ActionState>;
  fields: RowField[];
  active: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  // Saqlangach forma yopiladi — karta yangi ma'lumot bilan qayta chiziladi
  const saveAndClose = async (prev: ActionState, fd: FormData): Promise<ActionState> => {
    const r = await save(prev, fd);
    if (r?.ok) setEditing(false);
    return r;
  };

  const onToggle = () => {
    setError(undefined);
    start(async () => {
      try {
        const r = await toggle();
        if (r?.error) setError(r.error);
      } catch (e) {
        setError(isAccessDenied(e) ? "Bu amal uchun ruxsatingiz yo'q — direktordan ruxsat so'rang" : "Amal bajarilmadi — sahifani yangilab qayta urining");
      }
    });
  };

  return (
    <div className="mt-auto pt-3">
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing((x) => !x)}>
          {editing ? <><X size={14} /> Yopish</> : <><Pencil size={14} /> Tahrirlash</>}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onToggle}>
          {pending ? "…" : active ? "Nofaol qilish" : "Faollashtirish"}
        </Button>
      </div>
      {error && <div className="mt-2"><FormError error={error} /></div>}
      {editing && <div className="mt-3"><RowForm action={saveAndClose} mode="edit" cols={2} fields={fields} /></div>}
    </div>
  );
}
