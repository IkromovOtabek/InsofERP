"use client";

import { useActionState } from "react";
import { saveCustomer } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Textarea, FormActions, Checkbox } from "@/components/ui";

type C = { id: string; name: string; inn: string | null; phone: string | null; address: string | null; creditLimit: string; isActive: boolean } | null;

export function CustomerForm({ customer, canEditLimit }: { customer: C; canEditLimit: boolean }) {
  const [state, action, pending] = useActionState(saveCustomer.bind(null, customer?.id ?? null), undefined);
  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Nomi *"><Input name="name" defaultValue={customer?.name} required /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="INN"><Input name="inn" defaultValue={customer?.inn ?? ""} /></Field>
        <Field label="Telefon"><Input name="phone" defaultValue={customer?.phone ?? ""} /></Field>
      </div>
      <Field label="Manzil"><Textarea name="address" defaultValue={customer?.address ?? ""} /></Field>
      <Field label="Kredit limit (so'm)" hint={canEditLimit ? "0 = faqat oldindan to'lov" : "Faqat Finance / Direktor o'zgartira oladi"}>
        <Input name="creditLimit" type="number" step="1" min="0" defaultValue={customer?.creditLimit ?? "0"} readOnly={!canEditLimit} />
      </Field>
      <Checkbox name="isActive" defaultChecked={customer?.isActive ?? true} label="Faol" />
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <LinkButton href="/customers" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
