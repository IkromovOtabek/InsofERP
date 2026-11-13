"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { Button, Field, FormActions, FormError, IconButton, Input } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { money } from "@/lib/format";
import { editInvoice } from "./actions";

/** Tahrirlash oynasiga: sana — "yyyy-mm-dd"; `max` — zayavka summasi (zayavkasiz schyotda null). */
export type InvoiceEditData = { id: string; invoiceNo: string; amount: number; date: string; paid: number; max: number | null };

/**
 * Schyot qatoridagi qalam → oyna: summa va sana. Faqat ochiq / qisman to'langan schyotga chiziladi (sahifa tekshiradi),
 * qoida serverda — `lib/invoices.ts` `updateInvoice` (to'langandan kam emas, zayavka summasidan ko'p emas).
 */
export function InvoiceEditButton({ inv }: { inv: InvoiceEditData }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <IconButton icon={Pencil} type="button" label={`${inv.invoiceNo} — tahrirlash`} onClick={() => setOpen(true)} className="h-7 w-7 text-slate-400" />
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={() => setOpen(false)}>
          <div role="dialog" aria-label={`${inv.invoiceNo} — tahrirlash`} onMouseDown={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-md overflow-auto rounded-(--radius-card) border border-slate-200 bg-white text-left shadow-(--shadow-pop)">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-base font-semibold tracking-tight">Schyotni tahrirlash — {inv.invoiceNo}</h2>
              <IconButton icon={X} type="button" label="Yopish" onClick={() => setOpen(false)} />
            </div>
            <div className="p-4"><EditForm inv={inv} onDone={() => setOpen(false)} /></div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function EditForm({ inv, onDone }: { inv: InvoiceEditData; onDone: () => void }) {
  const [state, action, pending] = useActionState(editInvoice.bind(null, inv.id), undefined);
  const [, start] = useTransition();
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  const hint = [inv.paid > 0.005 ? `to'langan ${money(inv.paid)} — undan kam bo'lmaydi` : "", inv.max !== null ? `zayavka summasi ${money(inv.max)} — undan oshmaydi` : ""].filter(Boolean).join("; ");
  // `<form action>` emas: xato bo'lsa terilgan qiymat tozalanib ketmasin
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => action(fd));
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <FormError error={state?.error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Summa *" hint={hint || undefined}><MoneyInput name="amount" defaultValue={String(inv.amount)} required /></Field>
        <Field label="Sana *"><Input name="date" type="date" defaultValue={inv.date} required /></Field>
      </div>
      <p className="text-xs text-slate-500">Holat to&apos;lovlarga qarab qayta hisoblanadi: to&apos;langan summa yangi summaga teng bo&apos;lsa — «To&apos;langan».</p>
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Bekor</Button>
      </FormActions>
    </form>
  );
}
