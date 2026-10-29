"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { CheckSquare, FolderInput, Square, Trash2 } from "lucide-react";
import { deleteMaterials, setMaterialsCategory } from "@/lib/material-actions";
import { Button, FormError, FormSuccess, Select } from "@/components/ui";

/**
 * Sklad → Xomashyo qoldig'i: belgilangan xomashyolarni o'chirish paneli. Jadval qatorlaridagi belgilar
 * (`<input form={formId} name="ids">`) server sahifada chiziladi — panel ularni sanaydi, "Hammasini belgilash"
 * bilan yoqadi/o'chiradi va bitta forma bilan yuboradi. O'chirish qoidasi — `lib/material-actions.ts` `removeMaterial`.
 */
export function MaterialBulkBar({ formId, total, categories }: { formId: string; total: number; categories: [string, string][] }) {
  const [delState, action, delPending] = useActionState(deleteMaterials, undefined);
  // Belgilanganlarni kategoriyaga o'tkazish — shu formaning ikkinchi tugmasi (`formAction`)
  const [catState, catAction, catPending] = useActionState(setMaterialsCategory, undefined);
  const [last, setLast] = useState<"del" | "cat">("del");
  const state = last === "cat" ? catState : delState;
  const pending = delPending || catPending;
  const [count, setCount] = useState(0);
  const [all, setAll] = useState(0);

  const boxes = useCallback(() => [...document.querySelectorAll<HTMLInputElement>(`input[form="${formId}"][name="ids"]`)], [formId]);
  const recount = useCallback(() => { const b = boxes(); setAll(b.length); setCount(b.filter((x) => x.checked).length); }, [boxes]);

  useEffect(() => {
    recount();
    document.addEventListener("change", recount);
    return () => document.removeEventListener("change", recount);
  }, [recount]);
  // O'chirilgan qatorlar sahifadan yo'qoladi — qolgan belgilar qayta sanaladi (jadval yangilangach)
  useEffect(() => { const t = setTimeout(recount, 0); return () => clearTimeout(t); }, [state, total, recount]);

  const allChecked = all > 0 && count === all;
  const markAll = (on: boolean) => { for (const b of boxes()) b.checked = on; recount(); };

  // Hamma xomashyo o'chib ro'yxat bo'shasa ham komponent joyida qoladi — natija xabari yo'qolmasin
  if (total === 0 && !state) return null;

  return (
    <form id={formId} action={action} className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2"
      onSubmit={(e) => {
        const kind = (e.nativeEvent as SubmitEvent).submitter?.dataset.kind === "cat" ? "cat" : "del";
        setLast(kind);
        if (kind === "cat") return;
        const withStock = boxes().filter((b) => b.checked && b.dataset.stock === "1").length;
        const text = [
          `${count} ta xomashyo o'chirilsinmi?`,
          "",
          "• Hech qayerda ishlatilmagani — butunlay o'chiriladi.",
          withStock
            ? `• ${withStock} tasining skladda qoldig'i bor: «Xomashyo qo'shish» orqali o'zingiz kiritgan va boshqa hujjatda ishlatilmagan bo'lsa — QOLDIG'I BILAN BIRGA butunlay o'chiriladi (qaytarib bo'lmaydi). Aks holda o'chirilmaydi — avval Inventarizatsiya yoki Hisobdan chiqarish kerak.`
            : "",
          "• Retsept, kirim, sarf yoki ta'minotda ishlatilgani — o'chirilmaydi, ro'yxatdan olib tashlanadi (hujjatlar joyida).",
        ].filter((x) => x !== "").join("\n");
        if (!confirm(text)) e.preventDefault();
      }}>
      <span className="text-sm text-slate-600">Belgilangan: <b className="tabular text-slate-900">{count}</b> / {total}</span>
      <Button type="button" variant="secondary" size="sm" onClick={() => markAll(!allChecked)} disabled={all === 0}>
        {allChecked ? <><Square size={15} /> Belgilarni olib tashlash</> : <><CheckSquare size={15} /> Hammasini belgilash</>}
      </Button>
      <span className="inline-flex items-center gap-1.5">
        <Select name="category" defaultValue="" aria-label="Kategoriya" className="h-8 w-auto py-0 text-sm">
          <option value="">Kategoriya…</option>
          {categories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Button variant="secondary" size="sm" formAction={catAction} data-kind="cat" disabled={pending || count === 0}>
          <FolderInput size={15} /> {catPending ? "O'tkazilmoqda…" : "Kategoriyaga o'tkazish"}
        </Button>
      </span>
      <Button variant="danger" size="sm" data-kind="del" disabled={pending || count === 0}>
        <Trash2 size={15} /> {delPending ? "O'chirilmoqda…" : `O'chirish${count ? ` (${count})` : ""}`}
      </Button>
      {state?.note && <FormSuccess text={state.note} />}
      <FormError error={state?.error} />
    </form>
  );
}
