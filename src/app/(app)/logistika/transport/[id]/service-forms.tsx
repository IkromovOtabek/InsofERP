"use client";

import { useActionState, useEffect, useRef } from "react";
import { Coins, Wrench } from "lucide-react";
import { addExpense, addVehicleService } from "../../actions";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

/** Texnik xizmat yozuvi (mexanik): tur, sana, probeg, narx, izoh, keyingi xizmat sanasi / probegi. */
export function ServiceForm({ vehicleId, kinds, odometerKm }: { vehicleId: string; kinds: readonly string[]; odometerKm: number | null }) {
  const [state, action, pending] = useActionState(addVehicleService.bind(null, vehicleId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="sm:col-span-3"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Xizmat yozildi" />}</div>
      <Field label="Xizmat turi *">
        <Select name="kind" defaultValue={kinds[0]}>{kinds.map((k) => <option key={k} value={k}>{k}</option>)}</Select>
      </Field>
      <Field label="Sana"><Input name="date" type="date" defaultValue={today()} /></Field>
      <Field label="Probeg, km" hint={odometerKm != null ? `kartada: ${odometerKm} km` : undefined}><Input name="odometerKm" inputMode="numeric" /></Field>
      <Field label="Narx, so'm" hint="Jurnal uchun; pul xarajati alohida yoziladi"><Input name="cost" inputMode="numeric" /></Field>
      <Field label="Keyingi xizmat sanasi"><Input name="nextDueAt" type="date" /></Field>
      <Field label="Keyingi xizmat probegi, km"><Input name="nextDueKm" inputMode="numeric" /></Field>
      <Field label="Izoh" className="sm:col-span-3"><Input name="note" placeholder="Nima qilindi: moy 15W-40, filtr, shina o'ng orqa…" /></Field>
      <div className="sm:col-span-3"><Button size="sm" disabled={pending}><Wrench size={14} /> {pending ? "Saqlanmoqda…" : "Xizmatni yozish"}</Button></div>
    </form>
  );
}

const MECH_KINDS: [string, string][] = [["REPAIR", "Ta'mirlash"], ["PARTS", "Ehtiyot qism / moy"], ["WASH", "Yuvish"]];

/** Mexanik xarajati — shu transportga: ta'mir, ehtiyot qism / moy, yuvish. */
export function VehicleExpenseForm({ vehicleId }: { vehicleId: string }) {
  const [state, action, pending] = useActionState(addExpense, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2 px-5 pb-4 pt-3">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <Select name="kind" defaultValue="REPAIR" className="h-9 w-44 text-sm">{MECH_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      <Input name="amount" inputMode="numeric" placeholder="summa, so'm" className="h-9 w-32 text-sm" required />
      <Input name="date" type="date" defaultValue={today()} className="h-9 w-40 text-sm" />
      <Input name="note" placeholder="izoh" className="h-9 min-w-[8rem] flex-1 text-sm" />
      <Button size="sm" variant="secondary" disabled={pending}><Coins size={14} /> Qo&apos;shish</Button>
      <div className="w-full"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Xarajat yozildi" />}</div>
    </form>
  );
}
