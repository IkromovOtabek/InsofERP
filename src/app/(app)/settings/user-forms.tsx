"use client";

import { useActionState, useEffect, useRef } from "react";
import { Check, KeyRound, Save, UserPlus } from "lucide-react";
import { createUser, resetPassword, saveSupplyDirectorLimit, saveDailyOrderLimits, saveUserPerms, toggleUser, updateUser } from "./actions";
import { MoneyInput } from "@/components/money-input";
import { Button, Field, FormError, Input, PasswordInput, Select } from "@/components/ui";

export function UserForm({ roles }: { roles: [string, string][] }) {
  const [state, action, pending] = useActionState(createUser, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_160px_180px_auto]">
      <Field label="F.I.O. *"><Input name="fullName" required /></Field>
      <Field label="Login *"><Input name="login" autoComplete="off" required /></Field>
      <Field label="Parol *"><PasswordInput name="password" autoComplete="new-password" required /></Field>
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
      <PasswordInput name="password" placeholder="Yangi parol" className="w-36 px-2 py-1 text-xs" autoComplete="new-password" />
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending}>{state?.ok ? <Check size={14} /> : <KeyRound size={14} />}</Button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** Mavjud foydalanuvchi: ism va rol (audit bilan). DIRECTOR rolini faqat direktor beradi — sahifa faqat unga ochiq. */
export function UserEditForm({ userId, fullName, role, roles, self }: { userId: string; fullName: string; role: string; roles: [string, string][]; self: boolean }) {
  const [state, action, pending] = useActionState(updateUser.bind(null, userId), undefined);
  return (
    <form action={action} className="flex min-w-[260px] flex-wrap items-center gap-1">
      <Input name="fullName" defaultValue={fullName} className="w-40 px-2 py-1 text-xs" aria-label="F.I.O." required />
      <Select name="role" defaultValue={role} className="w-36 px-2 py-1 text-xs" aria-label="Rol" disabled={self}>
        {/* Ilgari berilgan, hozir formada yo'q rol (haydovchi, brigadir) ham ko'rinib tursin */}
        {!roles.some(([k]) => k === role) && <option value={role}>{role}</option>}
        {roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      {self && <input type="hidden" name="role" value={role} />}
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending} title="Saqlash">{state?.ok ? <Check size={14} /> : <Save size={14} />}</Button>
      {state?.error && <span className="basis-full text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** Bloklash / yoqish — bloklashda tasdiq so'raladi (ochiq sessiyalar darhol tugaydi). */
export function ToggleUserButton({ userId, name, active }: { userId: string; name: string; active: boolean }) {
  return (
    <form
      action={toggleUser.bind(null, userId)}
      onSubmit={(e) => { if (active && !confirm(`${name} bloklansinmi? U tizimdan darhol chiqariladi (veb va mobil ilova).`)) e.preventDefault(); }}
    >
      <Button variant="secondary" className="px-2 py-1 text-xs">{active ? "Bloklash" : "Yoqish"}</Button>
    </form>
  );
}

/** "Katta xarid" chegarasi — Byudjet sahifasidagi chegaralar bilan bitta maydon (`supplyDirectorLimit`). */
export function SupplyLimitForm({ value }: { value: number }) {
  const [state, action, pending] = useActionState(saveSupplyDirectorLimit, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Katta xarid chegarasi, so'm"><MoneyInput name="supplyDirectorLimit" defaultValue={String(value)} suffix={null} className="w-48 py-2 text-sm" /></Field>
      <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
      <FormError error={state?.error} />
    </form>
  );
}

/** Kunlik zayavka limiti — bir yetkazish kuniga qabul qilinadigan hajm (m³) va soni. 0/bo'sh — cheklov yo'q. */
export function DailyOrderLimitForm({ m3, count }: { m3: number; count: number }) {
  const [state, action, pending] = useActionState(saveDailyOrderLimits, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field label="Kunlik hajm chegarasi, m³"><Input name="dailyOrderMaxM3" type="number" min={0} step="1" defaultValue={m3 || ""} placeholder="cheklov yo'q" className="w-44" /></Field>
      <Field label="Kunlik zayavka soni"><Input name="dailyOrderMaxCount" type="number" min={0} step="1" defaultValue={count || ""} placeholder="cheklov yo'q" className="w-44" /></Field>
      <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
      <FormError error={state?.error} />
    </form>
  );
}

/**
 * Modul bo'yicha ruxsat — direktor foydalanuvchiga har bir asosiy bo'lim uchun
 * "Rol bo'yicha / Ko'rish / Yozish / Yopiq" belgilaydi. "Rol bo'yicha" — perms'da saqlanmaydi.
 */
export function UserPermsForm({
  userId, modules, current,
}: { userId: string; modules: { key: string; label: string }[]; current: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveUserPerms.bind(null, userId), undefined);
  const opts: [string, string][] = [["", "Rol bo'yicha"], ["view", "Ko'rish"], ["write", "Yozish"], ["none", "Yopiq"]];
  return (
    <form action={action} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {modules.map((m) => (
          <label key={m.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            <span>{m.label}</span>
            <Select name={`perm.${m.key}`} defaultValue={current[m.key] ?? ""} className="w-32 px-2 py-1 text-xs">
              {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button className="px-3 py-1.5 text-sm" disabled={pending}>{state?.ok ? <Check size={14} /> : <Save size={14} />} Saqlash</Button>
        {state?.ok && <span className="text-xs text-emerald-600">Saqlandi</span>}
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
