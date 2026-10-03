"use client";

import { Plus, Save } from "lucide-react";

import { useActionState, useEffect, useRef } from "react";
import { createSupplier, updateSupplier } from "./actions";
import { Button, Field, FormError, FormSuccess, Input } from "@/components/ui";

export function SupplierForm() {
  const [state, action, pending] = useActionState(createSupplier, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_160px_180px_auto]">
      <Field label="Nomi *"><Input name="name" required /></Field>
      <Field label="INN"><Input name="inn" /></Field>
      <Field label="Telefon"><Input name="phone" /></Field>
      <Button disabled={pending}><Plus size={16} /> Qo'shish</Button>
      <div className="sm:col-span-4"><FormError error={state?.error} /></div>
    </form>
  );
}

/** Yetkazuvchi kartasida rekvizitlarni tahrirlash. */
export function SupplierEditForm({ id, value }: { id: string; value: { name: string; inn: string; phone: string; address: string; contactPerson: string } }) {
  const [state, action, pending] = useActionState(updateSupplier.bind(null, id), undefined);
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_160px_180px_auto]">
      <Field label="Nomi *"><Input name="name" defaultValue={value.name} required /></Field>
      <Field label="INN"><Input name="inn" defaultValue={value.inn} /></Field>
      <Field label="Telefon"><Input name="phone" defaultValue={value.phone} /></Field>
      <Button variant="secondary" disabled={pending}><Save size={16} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
      <Field label="Manzil" className="sm:col-span-2"><Input name="address" defaultValue={value.address} /></Field>
      <Field label="Mas'ul shaxs" className="sm:col-span-2"><Input name="contactPerson" defaultValue={value.contactPerson} /></Field>
      <div className="sm:col-span-4"><FormError error={state?.error} />{state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}</div>
    </form>
  );
}
