"use client";

import { Plus } from "lucide-react";

import { useActionState, useEffect, useRef } from "react";
import { createSupplier } from "./actions";
import { Button, Field, FormError, Input } from "@/components/ui";

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
