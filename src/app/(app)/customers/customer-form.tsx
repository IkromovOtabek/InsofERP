"use client";

import { useActionState } from "react";
import { saveCustomer } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Textarea, FormActions, Checkbox } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";

type C = { id: string; name: string; inn: string | null; phone: string | null; address: string | null; creditLimit: string; isActive: boolean } | null;

export function CustomerForm({ customer, canEditLimit }: { customer: C; canEditLimit: boolean }) {
  const [state, action, pending] = useActionState(saveCustomer.bind(null, customer?.id ?? null), undefined);
  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Nomi *"><Input name="name" defaultValue={customer?.name} required /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="INN"><Input name="inn" defaultValue={customer?.inn ?? ""} /></Field>
        <Field label="Telefon"><Input name="phone" defaultValue={customer?.phone ?? ""} /></Field>
      </div>
      <Field label="Manzil"><Textarea name="address" defaultValue={customer?.address ?? ""} /></Field>
      <Field label="Kredit limit" hint={canEditLimit ? "Standart 100 000 000. 0 = faqat oldindan to'lov" : "Standart 100 mln. Faqat Finance / Direktor o'zgartira oladi"}>
        <MoneyInput name="creditLimit" defaultValue={customer?.creditLimit ?? "100000000"} readOnly={!canEditLimit} />
      </Field>
      <Checkbox name="isActive" defaultChecked={customer?.isActive ?? true} label="Faol" />
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <LinkButton href="/customers" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
