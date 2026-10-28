"use client";

import { useActionState } from "react";
import { CalendarPlus, Plus, Save } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { WEEKDAY_NAMES, WEEK_ORDER } from "@/lib/work-calendar-days";
import { addUzHolidaysAction, saveCalendarDayAction, saveWorkWeekAction } from "./actions";

/** Haftalik dam olish kunlari va ish vaqti (zavod standarti). */
export function WorkWeekForm({ restDays, workStart, workEnd, lunchStart, lunchEnd, disabled }: {
  restDays: number[]; workStart: string; workEnd: string; lunchStart: string | null; lunchEnd: string | null; disabled: boolean;
}) {
  const [state, action, pending] = useActionState(saveWorkWeekAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={disabled} className="space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">Dam olish kunlari</div>
          <div className="flex flex-wrap gap-2">
            {WEEK_ORDER.map((d) => (
              <label key={d} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-checked:border-rose-300 has-checked:bg-rose-50 has-checked:text-rose-700">
                <input type="checkbox" name="rest" value={d} defaultChecked={restDays.includes(d)} className="h-4 w-4 accent-rose-600" />
                {WEEKDAY_NAMES[d]}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-slate-400">Belgilanmagan kunlar — ish kuni. 6/1 uchun faqat yakshanbani belgilang.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Ish boshlanishi"><Input type="time" name="workStart" defaultValue={workStart} required /></Field>
          <Field label="Ish tugashi"><Input type="time" name="workEnd" defaultValue={workEnd} required /></Field>
          <Field label="Tushlik boshlanishi" hint="ixtiyoriy"><Input type="time" name="lunchStart" defaultValue={lunchStart ?? ""} /></Field>
          <Field label="Tushlik tugashi" hint="ixtiyoriy"><Input type="time" name="lunchEnd" defaultValue={lunchEnd ?? ""} /></Field>
        </div>
      </fieldset>
      {!disabled && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={pending}><Save size={14} /> Saqlash</Button>
          <FormError error={state?.error} />
          <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
        </div>
      )}
    </form>
  );
}

/** Bayram yoki ko'chirilgan ish kuni qo'shish (shu sana bo'lsa — yangilanadi). */
export function CalendarDayForm({ year }: { year: number }) {
  const [state, action, pending] = useActionState(saveCalendarDayAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Sana"><Input type="date" name="date" required defaultValue="" min={`${year}-01-01`} max={`${year}-12-31`} className="w-44" /></Field>
        <Field label="Turi">
          <Select name="kind" defaultValue="HOLIDAY" className="w-56">
            <option value="HOLIDAY">Bayram / dam olish kuni</option>
            <option value="WORKDAY">Ko&apos;chirilgan ish kuni</option>
          </Select>
        </Field>
        <Field label="Nomi" className="min-w-48 flex-1"><Input name="name" placeholder="Ramazon hayiti" /></Field>
        <Button size="sm" disabled={pending} className="mb-0.5"><Plus size={14} /> Qo&apos;shish</Button>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
    </form>
  );
}

/** Yilning sanasi o'zgarmaydigan bayramlarini bir bosishda qo'shish. */
export function UzHolidaysButton({ year }: { year: number }) {
  const [state, action, pending] = useActionState(addUzHolidaysAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="year" value={year} />
      <Button size="sm" variant="secondary" disabled={pending}><CalendarPlus size={14} /> {year}-yil davlat bayramlarini qo&apos;shish</Button>
      {state?.error && <span className="text-[13px] text-red-600">{state.error}</span>}
      {state?.ok && <span className="text-[13px] text-emerald-700">{state.note ?? "Qo'shildi"}</span>}
    </form>
  );
}
