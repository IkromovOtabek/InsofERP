"use client";

import { useActionState } from "react";
import { PASSWORD_HINT } from "@/lib/password-policy";
import { KeyRound, Lock, LockOpen, UserPen } from "lucide-react";
import { changeLogin, resetEmployeePassword, toggleEmployeeLogin } from "./actions";
import { Button, Field, FormError, Input, PasswordInput } from "@/components/ui";

/** Login nomini almashtirish. */
export function ChangeLoginForm({ employeeId, currentLogin }: { employeeId: string; currentLogin: string }) {
  const [state, action, pending] = useActionState(changeLogin.bind(null, employeeId), undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Login" className="min-w-40 flex-1"><Input name="login" defaultValue={currentLogin} autoComplete="off" required minLength={3} /></Field>
        <Button variant="secondary" disabled={pending}><UserPen size={15} /> O&apos;zgartirish</Button>
      </div>
      <FormError error={state?.error} />
      {state?.ok && <p className="text-xs text-emerald-700">Login saqlandi</p>}
    </form>
  );
}

/** Yangi parol berish — eski parol so'ralmaydi. */
export function ResetPasswordForm({ employeeId }: { employeeId: string }) {
  const [state, action, pending] = useActionState(resetEmployeePassword.bind(null, employeeId), undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Yangi parol" hint={PASSWORD_HINT} className="min-w-40 flex-1">
          <PasswordInput name="password" autoComplete="new-password" required minLength={6} placeholder="••••••••" />
        </Field>
        <Button variant="secondary" disabled={pending}><KeyRound size={15} /> Parolni almashtirish</Button>
      </div>
      <FormError error={state?.error} />
      {state?.ok && <p className="text-xs text-emerald-700">Parol almashtirildi</p>}
      {state?.note && <p className="text-xs text-slate-600">{state.note}</p>}
    </form>
  );
}

/**
 * Tizimga kirishni bloklash / ochish. Xodim ro'yxatda faol qoladi,
 * faqat ERP'ga kira olmaydi.
 */
export function ToggleLoginButton({ employeeId, blocked, compact }: { employeeId: string; blocked: boolean; compact?: boolean }) {
  return (
    <form action={toggleEmployeeLogin.bind(null, employeeId)} className={compact ? "inline" : undefined}>
      <Button
        variant={blocked ? "success" : "secondary"}
        size="sm"
        className={compact ? "px-2 py-1 text-xs" : undefined}
        title={blocked ? "Tizimga kirishni ochish" : "Tizimga kirishni bloklash"}
      >
        {blocked ? <LockOpen size={14} /> : <Lock size={14} />}
        {blocked ? "Aktiv qilish" : "Blokga tiqish"}
      </Button>
    </form>
  );
}
