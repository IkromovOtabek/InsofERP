"use client";

import { useActionState, useEffect, useRef } from "react";
import { Check, KeyRound, UserPlus } from "lucide-react";
import { createUser, resetPassword } from "./actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";

export function UserForm({ roles }: { roles: [string, string][] }) {
  const [state, action, pending] = useActionState(createUser, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_160px_180px_auto]">
      <Field label="F.I.O. *"><Input name="fullName" required /></Field>
      <Field label="Login *"><Input name="login" autoComplete="off" required /></Field>
      <Field label="Parol *"><Input name="password" type="password" autoComplete="new-password" required /></Field>
      <Field label="Rol *"><Select name="role" defaultValue="SALES">{roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Button disabled={pending}><UserPlus size={16} /> Qo'shish</Button>
      <div className="sm:col-span-5"><FormError error={state?.error} /></div>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resetPassword.bind(null, userId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex items-center gap-1">
      <Input name="password" type="password" placeholder="Yangi parol" className="w-36 px-2 py-1 text-xs" autoComplete="new-password" />
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending}>{state?.ok ? <Check size={14} /> : <KeyRound size={14} />}</Button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
