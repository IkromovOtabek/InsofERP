"use client";

import { useActionState } from "react";
import { saveVehicle } from "../actions";
import { Button, Checkbox, Field, FormActions, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";

export type VehicleFormValue = {
  id: string; plate: string; type: string; brand: string | null; model: string | null; year: number | null;
  capacityM3: number | null; fuelType: string | null; fuelNormL100: number | null; odometerKm: number | null; hasGps: boolean;
  inspectionUntil: string; insuranceCompany: string | null; insurancePolicy: string | null; insuranceUntil: string;
  isActive: boolean; note: string | null; driverId: string;
};

/** Transport kartasi (TZ 6-bo'lim): ID, raqam, turi, marka/model, sig'im, haydovchi, texnik ko'rik, sug'urta, GPS, yoqilg'i. */
export function VehicleForm({ v, drivers }: { v?: VehicleFormValue; drivers: { id: string; name: string; busyWith?: string | null }[] }) {
  const [state, action, pending] = useActionState(saveVehicle.bind(null, v?.id ?? null), undefined);
  return (
    <form action={action} className="space-y-5">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text="Saqlandi" />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Davlat raqami *"><Input name="plate" defaultValue={v?.plate} placeholder="01 A 123 BC" required /></Field>
        <Field label="Turi *">
          <Select name="type" defaultValue={v?.type ?? "MIXER"}>
            <option value="MIXER">Mikser (beton)</option>
            <option value="PUMP">Beton nasos</option>
            <option value="TRUCK">Yuk mashina (dona mahsulot)</option>
          </Select>
        </Field>
        <Field label="Yuk sig'imi, m³" hint="Mikser uchun majburiy"><Input name="capacityM3" type="number" step="0.5" min="0" defaultValue={v?.capacityM3 ?? ""} /></Field>
        <Field label="Marka"><Input name="brand" defaultValue={v?.brand ?? ""} placeholder="Howo, Shacman, Kamaz" /></Field>
        <Field label="Modeli"><Input name="model" defaultValue={v?.model ?? ""} /></Field>
        <Field label="Yili"><Input name="year" type="number" min="1980" max="2100" defaultValue={v?.year ?? ""} /></Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Biriktirilgan haydovchi" hint="Reys ochilganda o'zi tanlanadi">
          <Select name="driverId" defaultValue={v?.driverId ?? ""}>
            <option value="">— biriktirilmagan —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.busyWith ? ` (hozir: ${d.busyWith})` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Yoqilg'i turi">
          <Select name="fuelType" defaultValue={v?.fuelType ?? "DIESEL"}>
            <option value="DIESEL">Dizel</option><option value="PETROL">Benzin</option><option value="METHANE">Metan</option><option value="PROPANE">Propan</option>
          </Select>
        </Field>
        <Field label="Sarf normasi, l/100 km" hint="Haqiqiy sarf shu bilan solishtiriladi"><Input name="fuelNormL100" type="number" step="0.1" min="0" defaultValue={v?.fuelNormL100 ?? ""} /></Field>
        <Field label="Probeg, km"><Input name="odometerKm" type="number" min="0" defaultValue={v?.odometerKm ?? ""} /></Field>
        <Field label="Texnik ko'rik muddati"><Input name="inspectionUntil" type="date" defaultValue={v?.inspectionUntil ?? ""} /></Field>
        <div className="flex items-end pb-2"><Checkbox name="hasGps" label="Doimiy GPS-treker o'rnatilgan" defaultChecked={v?.hasGps} /></div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Sug'urta kompaniyasi"><Input name="insuranceCompany" defaultValue={v?.insuranceCompany ?? ""} /></Field>
        <Field label="Polis raqami"><Input name="insurancePolicy" defaultValue={v?.insurancePolicy ?? ""} /></Field>
        <Field label="Sug'urta muddati"><Input name="insuranceUntil" type="date" defaultValue={v?.insuranceUntil ?? ""} /></Field>
      </div>

      <Field label="Izoh"><Textarea name="note" defaultValue={v?.note ?? ""} rows={2} /></Field>
      {v && <Checkbox name="isActive" label="Faol (reysga beriladi). Sotilgan/hisobdan chiqarilgan bo'lsa belgini olib tashlang" defaultChecked={v.isActive} />}
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : v ? "Saqlash" : "Transport qo'shish"}</Button>
      </FormActions>
    </form>
  );
}
