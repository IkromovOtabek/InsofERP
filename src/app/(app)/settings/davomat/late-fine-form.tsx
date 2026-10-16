"use client";

import { useActionState, useState } from "react";
import { Check, Save } from "lucide-react";
import { saveLateFineAction } from "./actions";
import { MoneyInput } from "@/components/money-input";
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import type { LateFine } from "@/lib/hr/late-fine";

/** Kechikish jarimasi formasi — bitta global qoida (`lib/hr/late-fine.ts`). Server action — `./actions.ts`. */
export function LateFineForm({ value }: { value: LateFine | null }) {
  const [state, action, pending] = useActionState(saveLateFineAction, undefined);
  const [perMinute, setPerMinute] = useState(value?.perMinute ?? false);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Hisoblash usuli" hint={perMinute ? "imtiyozdan keyingi har daqiqaga" : "kechikkan har kun uchun bir xil summa"}>
        <Select name="mode" value={perMinute ? "minute" : "day"} onChange={(e) => setPerMinute(e.target.value === "minute")}>
          <option value="day">Har kechikkan kun uchun</option>
          <option value="minute">Har kechikkan daqiqa uchun</option>
        </Select>
      </Field>
      <Field label={perMinute ? "Bir daqiqa jarimasi" : "Bir kun jarimasi"}>
        <MoneyInput name="amount" defaultValue={value && value.amount > 0 ? String(value.amount) : ""} required />
      </Field>
      <Field label="Imtiyoz, daqiqa" hint="shuncha daqiqagacha kechikish jarimasiz">
        <Input name="graceMinutes" type="number" min={0} max={240} step={1} inputMode="numeric" defaultValue={value?.graceMinutes ?? 0} required />
      </Field>
      <Field label="Oylik chegara" hint="bir xodimdan oyiga ko'pi bilan; bo'sh — cheklanmagan">
        <MoneyInput name="maxPerMonth" defaultValue={value?.maxPerMonth ? String(value.maxPerMonth) : ""} />
      </Field>
      <Field label="Izoh" className="sm:col-span-2 xl:col-span-3" hint="masalan, buyruq raqami va sanasi">
        <Input name="note" defaultValue={value?.note ?? ""} maxLength={200} />
      </Field>
      <div className="flex items-center pb-5 sm:pt-6">
        <Checkbox name="isActive" label="Qoida faol" defaultChecked={value ? value.isActive : true} />
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4">
        <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
        {state?.note && <FormSuccess text={state.note} />}
        <div className="basis-full"><FormError error={state?.error} /></div>
      </div>
    </form>
  );
}
