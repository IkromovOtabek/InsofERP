"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { Button, Callout, Field, FormActions, FormError, IconButton, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { fmtNum } from "@/lib/format";
import type { RentTxEditData } from "@/lib/rent";
import { editRentTx } from "./actions";

/**
 * Arenda kirim-chiqimini tuzatish (qalam → oyna): sana, usul, summa, qaysi oy/kun uchun, chiqim turi, izoh.
 * Ruxsat — bekor qilish bilan bir xil (`arenda.storno`); qoida va kassa qoldig'i tekshiruvi — `lib/rent.ts` `updateRentTx`.
 */
export function RentTxEditButton({ tx, months, expenseCats }: { tx: RentTxEditData; months: { key: string; label: string }[]; expenseCats: readonly string[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <IconButton icon={Pencil} type="button" label="Tahrirlash" onClick={() => setOpen(true)} className="h-7 w-7 text-slate-400" />
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={() => setOpen(false)}>
          <div role="dialog" aria-label="Kirim-chiqimni tahrirlash" onMouseDown={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-(--radius-card) border border-slate-200 bg-white text-left shadow-(--shadow-pop)">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-base font-semibold tracking-tight">{tx.type === "INCOME" ? "Kirimni tahrirlash" : "Chiqimni tahrirlash"} — {tx.label}</h2>
              <IconButton icon={X} type="button" label="Yopish" onClick={() => setOpen(false)} />
            </div>
            <div className="p-4"><TxEditForm tx={tx} months={months} expenseCats={expenseCats} onDone={() => setOpen(false)} /></div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function TxEditForm({ tx, months, expenseCats, onDone }: { tx: RentTxEditData; months: { key: string; label: string }[]; expenseCats: readonly string[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(editRentTx.bind(null, tx.id), undefined);
  const [, start] = useTransition();
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  const income = tx.type === "INCOME";
  // Yozuv oyi ro'yxatda bo'lmasa (eski yozuv) — qo'shiladi
  const monthOpts = tx.month && !months.some((m) => m.key === tx.month) ? [...months, { key: tx.month, label: tx.monthLabel ?? tx.month }] : months;
  const err = (f: string) => (state?.field === f ? state.error : undefined);
  // `<form action>` emas: React 19 action'dan keyin formani tozalaydi — xato bo'lsa terilgan qiymatlar yo'qolardi
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => action(fd));
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <FormError error={state?.error && !state.field ? state.error : undefined} />
      {tx.batch && (
        <Callout tone="info" title="Bir necha oyga bo'lingan to'lov">
          Sana, usul va izoh shu kvitansiyaning hamma qismiga yoziladi. Summa ({fmtNum(tx.amount)} — shu oy qismi) va oylar o&apos;zgarmaydi: noto&apos;g&apos;ri bo&apos;lsa to&apos;lovni bekor qilib, qaytadan kiriting.
        </Callout>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {income && !tx.batch && (tx.daily ? (
          <Field label="Qaysi kun uchun *" hint="kunlik ijara — oy shu kundan olinadi" error={err("day")}>
            <Input name="day" type="date" defaultValue={tx.day ?? tx.date} required />
          </Field>
        ) : (
          <Field label={tx.elec ? "Qaysi oy sveti uchun *" : "Qaysi oy uchun *"} error={err("month")}>
            <Select name="month" defaultValue={tx.month ?? ""} required>
              <option value="" disabled>Oyni tanlang…</option>
              {monthOpts.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </Select>
          </Field>
        ))}
        {!income && (
          <Field label="Chiqim turi *" error={err("category")}>
            <Select name="category" defaultValue={expenseCats.includes(tx.category) ? tx.category : ""}>
              <option value="" disabled>Tanlang…</option>
              {expenseCats.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        )}
        <Field label="To'lov usuli *" error={err("method")}>
          <Select name="method" defaultValue={tx.method}><option value="CASH">Naqd</option><option value="BANK">Perechisleniye</option></Select>
        </Field>
        {!tx.batch && <Field label="Summa *" error={err("amount")}><MoneyInput name="amount" defaultValue={String(tx.amount)} required /></Field>}
        <Field label="Sana *" error={err("date")}><Input name="date" type="date" defaultValue={tx.date} required /></Field>
        <Field label="Izoh" className="sm:col-span-2" error={err("note")}><Input name="note" defaultValue={tx.note ?? ""} maxLength={300} /></Field>
      </div>
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Bekor</Button>
      </FormActions>
    </form>
  );
}
