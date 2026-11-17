"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Field, FormActions, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { createOpeningDebtAction, createWithholdingAction } from "./ushlanma-actions";

/* Ijro/aliment daftari va qarzning boshlang'ich qoldig'i (Excel «Миб карздорлик», «Карз» dan o'tish). */

type Emp = { id: string; fullName: string; position: string };
type Month = { key: string; label: string };

function EmpSelect({ employees }: { employees: Emp[] }) {
  return (
    <Select name="employeeId" required defaultValue="">
      <option value="" disabled>— xodim —</option>
      {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.position}</option>)}
    </Select>
  );
}

export function WithholdingForm({ employees, months, defMonth }: { employees: Emp[]; months: Month[]; defMonth: string }) {
  const [state, action, pending] = useActionState(createWithholdingAction, undefined);
  const [key, setKey] = useState(0);
  useEffect(() => { if (state?.ok) setKey((k) => k + 1); }, [state]);
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <div key={key} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Xodim *"><EmpSelect employees={employees} /></Field>
        <Field label="Turi *"><Select name="kind" defaultValue="MIB"><option value="MIB">Ijro varaqasi (MIB)</option><option value="ALIMENT">Aliment</option></Select></Field>
        <Field label="Ish / varaqa raqami"><Input name="caseNo" placeholder="11152617795201" /></Field>
        <Field label="Undiruvchi (kimga)"><Input name="creditor" placeholder="MIB, bank, fuqaro…" /></Field>
        <Field label="Umumiy qarz" hint="Aliment kabi muddatsiz bo'lsa — bo'sh"><Input name="amount" inputMode="decimal" placeholder="4 326 000" /></Field>
        <Field label="Oyiga summa" hint="Yoki foiz — bittasi kifoya"><Input name="monthly" inputMode="decimal" placeholder="1 000 000" /></Field>
        <Field label="Foiz (qo'lga tegadigandan)"><Input name="percent" inputMode="decimal" placeholder="50" /></Field>
        <Field label="Qaysi oydan *"><Select name="startMonth" defaultValue={defMonth}>{months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select></Field>
        <Field label="Ilgari ushlangan" hint="ERP'dan oldin (Excel'da) ushlangan summa"><Input name="heldBefore" inputMode="decimal" placeholder="0" /></Field>
        <Field label="Izoh" className="lg:col-span-3"><Input name="note" /></Field>
      </div>
      <FormActions><Button variant="secondary" disabled={pending}><Plus size={15} /> {pending ? "Saqlanmoqda…" : "Qo'shish"}</Button></FormActions>
    </form>
  );
}

export function OpeningDebtForm({ employees, months, defMonth }: { employees: Emp[]; months: Month[]; defMonth: string }) {
  const [state, action, pending] = useActionState(createOpeningDebtAction, undefined);
  const [key, setKey] = useState(0);
  useEffect(() => { if (state?.ok) setKey((k) => k + 1); }, [state]);
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <div key={key} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Xodim *" className="lg:col-span-2"><EmpSelect employees={employees} /></Field>
        <Field label="Qarz qoldig'i *"><Input name="amount" inputMode="decimal" required placeholder="1 250 000" /></Field>
        <Field label="Oyiga ushlash *" hint="Ushlanmalar jadvalida har oy o'zgartirsa bo'ladi"><Input name="monthly" inputMode="decimal" required placeholder="500 000" /></Field>
        <Field label="Qaysi oydan *"><Select name="startMonth" defaultValue={defMonth}>{months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select></Field>
        <Field label="Izoh" className="lg:col-span-5"><Input name="note" placeholder="Excel «Карз» — sentabrdan o'tgan qoldiq" /></Field>
      </div>
      <FormActions><Button variant="secondary" disabled={pending}><Plus size={15} /> {pending ? "Saqlanmoqda…" : "Qoldiqni yozish"}</Button></FormActions>
    </form>
  );
}
