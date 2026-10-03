"use client";

import { useActionState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import { Button, Field, FormError, Input, PasswordInput } from "@/components/ui";
import { adminLoginAction } from "./actions";

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(adminLoginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="flex items-center gap-2 text-violet-700"><ShieldCheck size={22} /><span className="text-lg font-semibold text-slate-900">Insof platforma — IT panel</span></div>
      <p className="text-sm text-slate-500">Faqat platforma administratorlari uchun. Korxona xodimlari o&apos;z manzilidan kiradi.</p>
      <Field label="Login"><Input name="login" autoComplete="username" required autoFocus /></Field>
      <Field label="Parol"><PasswordInput name="password" autoComplete="current-password" required /></Field>
      <FormError error={state?.error} />
      <Button className="w-full" disabled={pending}><LogIn size={16} /> Kirish</Button>
    </form>
  );
}
