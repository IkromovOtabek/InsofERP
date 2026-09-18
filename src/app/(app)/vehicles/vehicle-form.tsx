"use client";

import { Plus } from "lucide-react";

import { useActionState, useEffect, useRef } from "react";
import { createVehicle } from "./actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";

export function VehicleForm() {
  const [state, action, pending] = useActionState(createVehicle, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_160px_140px_auto]">
      <Field label="Davlat raqami *"><Input name="plate" placeholder="01 A 123 BC" required /></Field>
      <Field label="Turi"><Select name="type" defaultValue="MIXER"><option value="MIXER">Mikser</option><option value="PUMP">Nasos</option><option value="TRUCK">Yuk mashina</option></Select></Field>
      <Field label="Sig'imi, m³"><Input name="capacityM3" type="number" step="0.5" min="0" placeholder="7" /></Field>
      <Button disabled={pending}><Plus size={16} /> Qo'shish</Button>
      <div className="sm:col-span-4"><FormError error={state?.error} /></div>
    </form>
  );
}
