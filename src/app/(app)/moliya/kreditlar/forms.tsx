"use client";

import { useActionState, useEffect, useRef } from "react";
import { Ban, CheckCircle2, Link2, Plus } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { cancelLoanAction, closeLoanAction, createLoanAction, linkLoanTxAction } from "./actions";

export function LoanCreateForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createLoanAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Turi *">
          <Select name="kind" defaultValue="BANK" required>
            <option value="BANK">Bank krediti</option>
            <option value="BORROWED">Olingan qarz (shaxs / firma)</option>
            <option value="LENT">Biz bergan qarz</option>
          </Select>
        </Field>
        <Field label="Nomi *" className="lg:col-span-2"><Input name="name" required maxLength={160} placeholder="Aloqabank — 2025 investitsion kredit" /></Field>
        <Field label="Bank / kontragent *"><Input name="counterparty" required maxLength={160} placeholder="Aloqabank" /></Field>
        <Field label="Qoldiq (asosiy qarz) *" hint="quyidagi sanadagi holat"><MoneyInput name="openingBalance" required /></Field>
        <Field label="Qoldiq sanasi *"><Input name="openingDate" type="date" defaultValue={today} required /></Field>
      </div>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Yillik foiz, %"><Input name="rate" inputMode="decimal" placeholder="24" /></Field>
        <Field label="Izoh"><Input name="note" maxLength={300} placeholder="Shartnoma №, to'lov kuni…" /></Field>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Kredit qo'shildi" : undefined} />
      <Button disabled={pending}><Plus size={16} /> {pending ? "Saqlanmoqda…" : "Qo'shish"}</Button>
    </form>
  );
}

export function LoanRowActions({ id, canClose }: { id: string; canClose: boolean }) {
  const [cls, close, clp] = useActionState(closeLoanAction, undefined);
  const [cs, cancel, cp] = useActionState(cancelLoanAction, undefined);
  return (
    <details className="text-left">
      <summary className="cursor-pointer select-none text-[13px] font-medium text-slate-500 hover:text-slate-900">Amallar</summary>
      <div className="mt-2 grid w-64 gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-(--shadow-pop)">
        {canClose && (
          <form action={close} className="grid gap-2">
            <input type="hidden" name="id" value={id} />
            <FormError error={cls?.error} />
            <Button size="sm" variant="secondary" disabled={clp}><CheckCircle2 size={14} /> Yopildi (to&apos;liq to&apos;landi)</Button>
          </form>
        )}
        <form action={cancel} className="grid gap-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="id" value={id} />
          <Input name="reason" placeholder="Bekor qilish sababi *" required maxLength={200} />
          <FormError error={cs?.error} />
          <Button size="sm" variant="danger" disabled={cp}><Ban size={14} /> Bekor qilish</Button>
        </form>
      </div>
    </details>
  );
}

/** Kreditga bog'lanmagan kassa yozuvini bog'lash. */
export function LinkTxForm({ txId, loans }: { txId: string; loans: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(linkLoanTxAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="txId" value={txId} />
      <Select name="loanId" required defaultValue="" className="h-8 w-56 text-[13px]">
        <option value="" disabled>— kredit —</option>
        {loans.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={pending}><Link2 size={14} /> Bog&apos;lash</Button>
      {state?.error && <span className="w-full text-right text-[13px] text-red-600">{state.error}</span>}
    </form>
  );
}
