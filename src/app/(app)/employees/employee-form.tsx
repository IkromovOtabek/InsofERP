"use client";

import { Plus } from "lucide-react";

import { useActionState, useEffect, useRef, useState } from "react";
import { createEmployee, grantLogin } from "./actions";
import { Button, Field, FormError, Input, PasswordInput, Select } from "@/components/ui";

type Pos = { label: string; role: string | null };

export function EmployeeForm({ positions, canGrant }: { positions: Pos[]; canGrant: boolean }) {
  const [state, action, pending] = useActionState(createEmployee, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [position, setPosition] = useState(positions[0]?.label ?? "");
  const needsLogin = !!positions.find((p) => p.label === position)?.role;
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_200px_180px_auto]">
        <Field label="F.I.O. *"><Input name="fullName" required /></Field>
        <Field label="Lavozim *">
          <Select name="position" value={position} onChange={(e) => setPosition(e.target.value)}>
            <optgroup label="Bo'limlar (tizimga kiradi)">{positions.filter((p) => p.role).map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}</optgroup>
            <optgroup label="Ishchi lavozimlar">{positions.filter((p) => !p.role).map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}</optgroup>
          </Select>
        </Field>
        <Field label="Telefon"><Input name="phone" /></Field>
        <Button disabled={pending || (needsLogin && !canGrant)}><Plus size={16} /> Qo'shish</Button>
      </div>
      {needsLogin && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:grid-cols-[1fr_1fr_2fr]">
          <Field label="Login *"><Input name="login" autoComplete="off" required /></Field>
          <Field label="Parol *"><PasswordInput name="password" autoComplete="new-password" required /></Field>
          <p className="self-end text-xs text-blue-800">
            Bu lavozim egasi tizimga kirib, faqat o'z bo'limi sahifalarini ko'radi.{!canGrant && " Login berish uchun Otdel kadr yoki direktor kerak."}
          </p>
        </div>
      )}
      <FormError error={state?.error} />
      {state?.ok && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Xodim qo'shildi</div>}
    </form>
  );
}

export function GrantLoginForm({ employeeId }: { employeeId: string }) {
  const [state, action, pending] = useActionState(grantLogin.bind(null, employeeId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <Input name="login" placeholder="login" className="w-28 px-2 py-1 text-xs" autoComplete="off" required />
      <PasswordInput name="password" placeholder="parol" className="w-28 px-2 py-1 text-xs" autoComplete="new-password" required />
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending}>Login berish</Button>
      {state?.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
