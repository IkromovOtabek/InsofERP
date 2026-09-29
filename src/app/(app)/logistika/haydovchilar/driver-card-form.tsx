"use client";

import { useActionState } from "react";
import { saveDriverCard } from "../actions";
import { Button, Field, FormActions, FormError, FormSuccess, Input, Select } from "@/components/ui";

export function DriverCardForm({ id, v, vehicles }: {
  id: string;
  v: { workSchedule: string | null; licenseNo: string | null; licenseCategory: string | null; licenseExpiry: string; vehicleId: string | null };
  vehicles: { id: string; plate: string }[];
}) {
  const [state, action, pending] = useActionState(saveDriverCard.bind(null, id), undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Saqlandi" />}</div>
      <Field label="Guvohnoma raqami"><Input name="licenseNo" defaultValue={v.licenseNo ?? ""} /></Field>
      <Field label="Toifalar"><Input name="licenseCategory" defaultValue={v.licenseCategory ?? ""} placeholder="B, C, CE" /></Field>
      <Field label="Guvohnoma muddati"><Input name="licenseExpiry" type="date" defaultValue={v.licenseExpiry} /></Field>
      <Field label="Biriktirilgan transport">
        <Select name="vehicleId" defaultValue={v.vehicleId ?? ""}>
          <option value="">— yo'q —</option>
          {vehicles.map((x) => <option key={x.id} value={x.id}>{x.plate}</option>)}
        </Select>
      </Field>
      <Field label="Ish grafigi" hint="Dispetcher reys taqsimlashda ko'radi" className="sm:col-span-2"><Input name="workSchedule" defaultValue={v.workSchedule ?? ""} placeholder="08:00–20:00, 2 kun ish / 2 kun dam" /></Field>
      <div className="sm:col-span-2"><FormActions><Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button></FormActions></div>
    </form>
  );
}
