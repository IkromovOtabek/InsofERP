"use client";

import { Plus } from "lucide-react";

import { useActionState, useEffect, useRef, useState } from "react";
import { createEmployee, grantLogin, updateEmployee } from "./actions";
import { Button, Field, FormError, FormSuccess, Input, PasswordInput, Select, Textarea } from "@/components/ui";
import { EDUCATION, MARITAL } from "@/lib/kadr";

export type Pos = { label: string; role: string | null };

/** Bo'limlar (login beradi) + otdel kadr yuritadigan ishchi lavozimlar (`work` bo'sh bo'lsa faqat bo'limlar). */
export function PositionSelect({ departments, work, value, onChange }: { departments: Pos[]; work: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select name="position" value={value} onChange={(e) => onChange(e.target.value)} required>
      <optgroup label="Bo'limlar (tizimga kiradi)">{departments.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}</optgroup>
      {work.length > 0 && <optgroup label="Ishchi lavozimlar">{work.map((w) => <option key={w} value={w}>{w}</option>)}</optgroup>}
    </Select>
  );
}

/** Tezkor forma: bo'lim xodimi + login. Ishchi lavozimdagi xodim Otdel kadr oynasida to'liq karta bilan ochiladi. */
export function EmployeeForm({ departments, canGrant }: { departments: Pos[]; canGrant: boolean }) {
  const [state, action, pending] = useActionState(createEmployee, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [position, setPosition] = useState(departments[0]?.label ?? "");
  const needsLogin = !!departments.find((p) => p.label === position)?.role;
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1.4fr_200px_170px_160px_auto]">
        <Field label="F.I.O. *"><Input name="fullName" required /></Field>
        <Field label="Bo'lim lavozimi *"><PositionSelect departments={departments} work={[]} value={position} onChange={setPosition} /></Field>
        <Field label="Telefon"><Input name="phone" placeholder="+998 90 123 45 67" /></Field>
        <Field label="Ishga kirgan sana"><Input name="hiredAt" type="date" /></Field>
        <Button disabled={pending || (needsLogin && !canGrant)}><Plus size={16} /> Qo&apos;shish</Button>
      </div>
      {needsLogin && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:grid-cols-[1fr_1fr_2fr]">
          <Field label="Login *"><Input name="login" autoComplete="off" required /></Field>
          <Field label="Parol *"><PasswordInput name="password" autoComplete="new-password" required /></Field>
          <p className="self-end text-xs text-blue-800">
            Bu lavozim egasi tizimga kirib, faqat o&apos;z bo&apos;limi sahifalarini ko&apos;radi.{!canGrant && " Login berish uchun Otdel kadr yoki direktor kerak."}
          </p>
        </div>
      )}
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Xodim qo'shildi" : undefined} />
    </form>
  );
}

export type EmployeeCard = {
  id: string; fullName: string; position: string; phone: string | null;
  hiredAt: string | null; birthDate: string | null; note: string | null;
  passportSeries: string | null; pinfl: string | null; passportIssuedBy: string | null; passportIssuedAt: string | null;
  address: string | null; education: string | null; maritalStatus: string | null;
};

/** Xodim kartasi — otdel kadr tahrirlaydi. */
export function EmployeeCardForm({ employee, departments, work, hasLogin }: {
  employee: EmployeeCard;
  departments: Pos[];
  work: string[];
  hasLogin: boolean;
}) {
  const [state, action, pending] = useActionState(updateEmployee.bind(null, employee.id), undefined);
  const [position, setPosition] = useState(employee.position);
  // Ro'yxatdan chiqarilgan eski lavozim ham tanlov sifatida qolsin, aks holda saqlashda almashib ketadi
  const workList = work.includes(employee.position) || departments.some((d) => d.label === employee.position) ? work : [employee.position, ...work];

  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="F.I.O. *"><Input name="fullName" defaultValue={employee.fullName} required /></Field>
        <Field label="Lavozim *" hint={hasLogin ? "Login berilgan xodimning bo'limi o'zgarmaydi" : undefined}>
          <PositionSelect departments={departments} work={workList} value={position} onChange={setPosition} />
        </Field>
        <Field label="Telefon" hint="Haydovchi uchun ilovaga kirish kaliti"><Input name="phone" defaultValue={employee.phone ?? ""} /></Field>
        <Field label="Ishga kirgan sana"><Input name="hiredAt" type="date" defaultValue={employee.hiredAt ?? ""} /></Field>
        <Field label="Tug'ilgan sana"><Input name="birthDate" type="date" defaultValue={employee.birthDate ?? ""} /></Field>
        <Field label="Ma'lumoti">
          <Select name="education" defaultValue={employee.education ?? ""}><option value="">—</option>{EDUCATION.map((e) => <option key={e} value={e}>{e}</option>)}</Select>
        </Field>
        <Field label="Oilaviy holati">
          <Select name="maritalStatus" defaultValue={employee.maritalStatus ?? ""}><option value="">—</option>{MARITAL.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
        </Field>
        <Field label="Yashash manzili" className="sm:col-span-2"><Input name="address" defaultValue={employee.address ?? ""} /></Field>
        <Field label="Passport seriya va raqam"><Input name="passportSeries" defaultValue={employee.passportSeries ?? ""} placeholder="AA 1234567" autoComplete="off" /></Field>
        <Field label="JSHSHIR (PINFL)"><Input name="pinfl" defaultValue={employee.pinfl ?? ""} inputMode="numeric" autoComplete="off" /></Field>
        <Field label="Passportni kim bergan"><Input name="passportIssuedBy" defaultValue={employee.passportIssuedBy ?? ""} /></Field>
        <Field label="Berilgan sana"><Input name="passportIssuedAt" type="date" defaultValue={employee.passportIssuedAt ?? ""} /></Field>
        <Field label="Izoh" className="sm:col-span-3"><Textarea name="note" defaultValue={employee.note ?? ""} rows={2} placeholder="Smena, manzil, hujjat holati..." /></Field>
      </div>
      <div className="flex items-center gap-3">
        <Button disabled={pending}>Saqlash</Button>
        {state?.ok && <span className="text-sm text-emerald-700">Saqlandi</span>}
      </div>
      <FormError error={state?.error} />
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
