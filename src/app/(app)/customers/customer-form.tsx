"use client";

import { useActionState } from "react";
import { saveCustomer } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Textarea, FormActions, Checkbox } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";

type C = { id: string; name: string; inn: string | null; phone: string | null; address: string | null; contactPerson?: string | null; aliases?: string[]; creditLimit: string; isActive: boolean } | null;

/** `defaultLimit` — yangi mijoz formasidagi boshlang'ich limit (Sozlamalar → Limitlar, sahifa server'da o'qiydi). */
export function CustomerForm({ customer, canEditLimit, defaultLimit = 0 }: { customer: C; canEditLimit: boolean; defaultLimit?: number }) {
  const [state, action, pending] = useActionState(saveCustomer.bind(null, customer?.id ?? null), undefined);
  const limitHint = [
    canEditLimit ? "0 = faqat oldindan to'lov (naqd / avans). Qarz berish uchun limit kiriting" : "Faqat Buxgalteriya, Finance yoki Direktor o'zgartira oladi",
    customer ? "" : "Standart limit — Sozlamalar → Limitlar",
  ].filter(Boolean).join(". ");
  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Nomi *"><Input name="name" defaultValue={customer?.name} required /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="INN"><Input name="inn" defaultValue={customer?.inn ?? ""} /></Field>
        <Field label="Telefon"><Input name="phone" defaultValue={customer?.phone ?? ""} /></Field>
      </div>
      <Field label="Manzil"><Textarea name="address" defaultValue={customer?.address ?? ""} /></Field>
      <Field label="Mas'ul shaxs" hint="F.I.O., lavozimi — kim bilan gaplashiladi"><Input name="contactPerson" defaultValue={customer?.contactPerson ?? ""} /></Field>
      <Field label="Boshqa nomlari" hint="Har qatorda bitta nom — kassa, sotuv yoki Excel'da shunday yozilgan bo'lsa ham importlar shu mijozni topadi">
        <Textarea name="aliases" rows={3} defaultValue={customer?.aliases?.join("\n") ?? ""} placeholder={"Dumbirabod 998865055\nДумбиробод"} />
      </Field>
      <Field label="Kredit limit" hint={limitHint}>
        {/* decimals=2: kasrli limit (Excel'dan 1 250 000,50) tahrirda kesilmasin — aks holda sotuvchiga «faqat Buxgalteriya…» xatosi chiqardi */}
        <MoneyInput name="creditLimit" defaultValue={customer?.creditLimit ?? String(defaultLimit)} readOnly={!canEditLimit} decimals={2} />
        {/* Forma ochilgandagi limit: tegilmagan bo'lsa server uni yozmaydi (boshqa joyda o'zgargan limit saqlanadi) */}
        {customer && <input type="hidden" name="creditLimitWas" value={customer.creditLimit} />}
      </Field>
      <Checkbox name="isActive" defaultChecked={customer?.isActive ?? true} label="Faol" />
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <LinkButton href="/customers" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
