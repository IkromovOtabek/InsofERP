"use client";

import { createContext, startTransition, useActionState, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { updateCashTx } from "../cashflow/actions";
import { Button, Field, FormError, IconButton, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import type { CategoryOption } from "@/lib/fin-report/categories";

/** Tahrir oynasi ro'yxatlari — jadvalda bir marta beriladi (har qatorga takrorlanmasin). */
export type CashEditOptions = { accounts: { id: string; name: string; type: "CASH" | "BANK" }[]; income: CategoryOption[]; expense: CategoryOption[] };
const Options = createContext<CashEditOptions | null>(null);
export function CashEditProvider({ options, children }: { options: CashEditOptions; children: React.ReactNode }) {
  return <Options.Provider value={options}>{children}</Options.Provider>;
}

export type CashEditEntry = {
  id: string; type: "INCOME" | "EXPENSE"; date: string; cashAccountId: string; amount: number;
  category: string; subCategory: string; counterparty: string; note: string; sig: string;
};

/**
 * Kassa jurnali qatoridagi qalam: qo'lda yozilgan kirim/chiqimni tuzatish (turi o'zgarmaydi). Qoidalar — `lib/cash-entry.ts`
 * → `updateCashEntry` (qoldiq, kategoriya, boshqa joyda o'zgargan bo'lsa rad). `blocked` — nega tahrirlanmasligi (tooltip).
 */
export function CashEditButton({ entry, blocked }: { entry?: CashEditEntry; blocked?: string | null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!entry || blocked) return blocked ? <span title={blocked} className="inline-flex h-7 w-7 items-center justify-center text-slate-300"><Pencil size={14} /></span> : null;
  return (
    <>
      <IconButton icon={Pencil} label="Yozuvni tahrirlash" onClick={() => setOpen(true)} className="h-7 w-7" />
      {open && <CashEditDialog entry={entry} onClose={close} />}
    </>
  );
}

function CashEditDialog({ entry, onClose }: { entry: CashEditEntry; onClose: () => void }) {
  const o = useContext(Options) ?? { accounts: [], income: [], expense: [] };
  const [state, action, pending] = useActionState(updateCashTx.bind(null, entry.id), undefined);
  const [category, setCategory] = useState(entry.category);
  const [sub, setSub] = useState(entry.subCategory);
  const [amount, setAmount] = useState(String(entry.amount));
  useEffect(() => { if (state?.ok) onClose(); }, [state, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = entry.type === "INCOME" ? o.income : o.expense;
  // Eski yozuvdagi erkin nom (daraxtda yo'q) ham tanlovda tursin
  const cats = list.some((c) => c.name === entry.category) ? list : [{ name: entry.category, needs: null, loanPart: null, subs: [] }, ...list];
  const cur = cats.find((c) => c.name === category);
  const subs = cur ? [...cur.subs, ...(category === entry.category && entry.subCategory && !cur.subs.includes(entry.subCategory) ? [entry.subCategory] : [])] : [];
  // Kredit / loyiha so'raydigan manba tahrirda tanlanmaydi (bog'lanish kerak)
  const shown = cats.filter((c) => c.name === entry.category || (c.needs !== "LOAN" && c.needs !== "PROJECT"));

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={onClose}>
      <form role="dialog" aria-label="Yozuvni tahrirlash" onMouseDown={(e) => e.stopPropagation()}
        // `<form action>` xato bilan qaytganda maydonlarni tozalaydi — onSubmit + startTransition
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}
        className="w-full max-w-2xl space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">{entry.type === "INCOME" ? "Kirimni" : "Chiqimni"} tahrirlash</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>
        <input type="hidden" name="sig" value={entry.sig} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <Field label="Sana *"><Input name="date" type="date" defaultValue={entry.date} required /></Field>
          <Field label="Kassa / hisob *">
            <Select name="cashAccountId" defaultValue={entry.cashAccountId} required>
              {o.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === "CASH" ? "naqd" : "bank"})</option>)}
            </Select>
          </Field>
          <Field label="Summa *"><MoneyInput name="amount" value={amount} onChange={setAmount} required /></Field>
          <Field label="Manba *">
            <Select name="category" value={category} onChange={(e) => { setCategory(e.target.value); setSub(""); }} required>
              {shown.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Sub manba">
            <Select name="subCategory" value={sub} onChange={(e) => setSub(e.target.value)}>
              <option value="">— umumiy —</option>
              {subs.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label={entry.type === "INCOME" ? "Kimdan" : "Kimga"}><Input name="counterparty" defaultValue={entry.counterparty} maxLength={200} autoComplete="off" /></Field>
          <Field label="Izoh" className="sm:col-span-3"><Input name="note" defaultValue={entry.note} maxLength={500} /></Field>
        </div>
        <p className="text-xs text-slate-500">Turi (kirim/chiqim) o&apos;zgarmaydi. Avvalgi qiymatlar jurnalda (AuditLog) saqlanadi.</p>
        <FormError error={state?.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Yopish</Button>
          <Button disabled={pending}><Pencil size={15} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        </div>
      </form>
    </div>
  ), document.body);
}
