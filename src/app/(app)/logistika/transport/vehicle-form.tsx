"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveVehicle } from "../actions";
import { Button, Checkbox, Field, FormActions, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";

export type VehicleFormValue = {
  id: string; plate: string; type: string; brand: string | null; model: string | null; year: number | null;
  capacityM3: number | null; capacityUnit: string; fuelType: string | null; fuelNormL100: number | null; idleNormPerHour: number | null;
  gasNormPer100: number | null; gasIdlePerHour: number | null; odometerKm: number | null; hasGps: boolean;
  inspectionUntil: string; insuranceCompany: string | null; insurancePolicy: string | null; insuranceUntil: string;
  isActive: boolean; note: string | null; driverId: string; shiftDriverIds: string[];
};

/**
 * Transport kartasi (TZ 6-bo'lim): ID, raqam, turi, marka/model, sig'im, haydovchilar, texnik ko'rik, sug'urta, GPS, yoqilg'i.
 * Haydovchi: asosiy + smenadoshlar (smenali ishda bitta transportda bir nechta haydovchi).
 * Yoqilg'i: dizel, metan yoki «Dizel + metan» — ikkalasida yuradiganiga ikki xil norma.
 */
export function VehicleForm({ v, drivers }: { v?: VehicleFormValue; drivers: { id: string; name: string; busyWith?: string | null }[] }) {
  const [state, action, pending] = useActionState(saveVehicle.bind(null, v?.id ?? null), undefined);
  const [type, setType] = useState(v?.type ?? "MIXER");
  const [fuel, setFuel] = useState(v?.fuelType ?? "DIESEL");
  const [mainDriver, setMainDriver] = useState(v?.driverId ?? "");
  const [shift, setShift] = useState<string[]>(v?.shiftDriverIds ?? []);
  const driverLabel = (d: { name: string; busyWith?: string | null }) => `${d.name}${d.busyWith ? ` (hozir: ${d.busyWith})` : ""}`;
  // Bitta haydovchi ikki joyda tanlanmasin: asosiyda turgani va boshqa qatorda tanlangani ro'yxatdan chiqadi
  const shiftOpts = (cur: string) => drivers.filter((d) => d.id === cur || (d.id !== mainDriver && !shift.includes(d.id)));
  const [unit, setUnit] = useState(v?.capacityUnit && v.capacityUnit !== "M3" ? v.capacityUnit : "TON");
  const truck = type === "TRUCK";
  const methane = fuel === "METHANE";
  const dual = fuel === "DIESEL_METHANE";
  // Benzin/propan endi tanlanmaydi — eski kartada turgan bo'lsa, o'zgartirilmaguncha ro'yxatda ko'rinadi
  const legacyFuel = v?.fuelType === "PETROL" ? "Benzin (eski)" : v?.fuelType === "PROPANE" ? "Propan (eski)" : null;
  return (
    <form action={action} className="space-y-5">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text="Saqlandi" />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <Field label="Davlat raqami *"><Input name="plate" defaultValue={v?.plate} placeholder="01 A 123 BC" required /></Field>
        <Field label="Turi *">
          <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="MIXER">Mikser (beton)</option>
            <option value="PUMP">Beton nasos</option>
            <option value="TRUCK">Yuk mashina (dona mahsulot)</option>
          </Select>
        </Field>
        {truck ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label={`Yuk sig'imi, ${unit === "PIECE" ? "dona" : "tonna"}`}><Input name="capacityM3" type="number" step="any" min="0" defaultValue={v?.capacityM3 ?? ""} /></Field>
            <Field label="Birligi">
              <Select name="capacityUnit" value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="TON">Tonna</option>
                <option value="PIECE">Dona (birlik)</option>
              </Select>
            </Field>
          </div>
        ) : <Field label="Yuk sig'imi, m³" hint="Mikser uchun majburiy"><Input name="capacityM3" type="number" step="0.5" min="0" defaultValue={v?.capacityM3 ?? ""} /></Field>}
        <Field label="Marka"><Input name="brand" defaultValue={v?.brand ?? ""} placeholder="Howo, Shacman, Kamaz" /></Field>
        <Field label="Modeli"><Input name="model" defaultValue={v?.model ?? ""} /></Field>
        <Field label="Yili"><Input name="year" type="number" min="1970" max={new Date().getFullYear() + 1} defaultValue={v?.year ?? ""} /></Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <Field label="Asosiy haydovchi" hint="Reys ochilganda o'zi tanlanadi">
          <Select name="driverId" value={mainDriver} onChange={(e) => { const id = e.target.value; setMainDriver(id); setShift((l) => l.filter((x) => x !== id)); }}>
            <option value="">— biriktirilmagan —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{driverLabel(d)}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-1.5 text-sm font-medium text-slate-700">Smenadosh haydovchilar</div>
          {/* Bo'sh qiymat har doim yuboriladi — hammasi olib tashlansa ham server «ro'yxat bo'sh» deb biladi */}
          <input type="hidden" name="shiftDriverIds[]" value="" />
          <div className="space-y-2">
            {shift.map((id, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select name="shiftDriverIds[]" value={id} onChange={(e) => setShift((l) => l.map((x, j) => (j === i ? e.target.value : x)))} className="min-w-0 flex-1">
                  <option value="">— haydovchini tanlang —</option>
                  {shiftOpts(id).map((d) => <option key={d.id} value={d.id}>{driverLabel(d)}</option>)}
                </Select>
                <button type="button" onClick={() => setShift((l) => l.filter((_, j) => j !== i))} aria-label={`${i + 1}-smenadoshni olib tashlash`} title="Olib tashlash"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setShift((l) => [...l, ""])}><Plus size={14} /> Smenadosh haydovchi qo&apos;shish</Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Smenali ishda — reys ochilganda bu haydovchilar ro&apos;yxat boshida turadi</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <Field label="Yoqilg'i turi">
          <Select name="fuelType" value={fuel} onChange={(e) => setFuel(e.target.value)}>
            <option value="DIESEL">Dizel</option><option value="METHANE">Metan</option><option value="DIESEL_METHANE">Dizel + metan</option>
            {legacyFuel && <option value={v!.fuelType!}>{legacyFuel}</option>}
          </Select>
        </Field>
        <Field label={methane ? "Yurish normasi, m³ / 100 km" : dual ? "Dizel normasi, l / 100 km" : "Sarf normasi, l/100 km"} hint={methane ? "Bo'sh qolsa — 50 m³" : "Haqiqiy sarf shu bilan solishtiriladi"}>
          <Input name="fuelNormL100" type="number" step="0.1" min="0" defaultValue={v?.fuelNormL100 ?? ""} key={`n${methane}`} placeholder={methane ? "50" : undefined} />
        </Field>
        <Field label={methane ? "Turib ishlash, m³ / soat" : dual ? "Dizel, turib ishlash, l / soat" : "Turib ishlash, l / soat"} hint={methane ? "Mikser aylantirish (motor ishlab turgan soat). Bo'sh qolsa — 5 m³" : "Mikser aylantirish — ixtiyoriy"}>
          <Input name="idleNormPerHour" type="number" step="0.1" min="0" defaultValue={v?.idleNormPerHour ?? ""} key={`i${methane}`} placeholder={methane ? "5" : undefined} />
        </Field>
        {dual && (
          <>
            <Field label="Metan normasi, m³ / 100 km" hint="Ikkala yoqilg'i birga sarflanadi — har biri o'z normasi bilan">
              <Input name="gasNormPer100" type="number" step="0.1" min="0" defaultValue={v?.gasNormPer100 ?? ""} />
            </Field>
            <Field label="Metan, turib ishlash, m³ / soat" hint="Mikser aylantirish — ixtiyoriy">
              <Input name="gasIdlePerHour" type="number" step="0.1" min="0" defaultValue={v?.gasIdlePerHour ?? ""} />
            </Field>
          </>
        )}
        <Field label="Probeg, km" hint={v?.odometerKm != null ? "Kamaytirib bo'lmaydi — faqat xatoni tuzatish (sababi bilan)" : undefined}><Input name="odometerKm" type="number" min="0" defaultValue={v?.odometerKm ?? ""} /></Field>
        <Field label="Texnik ko'rik muddati"><Input name="inspectionUntil" type="date" defaultValue={v?.inspectionUntil ?? ""} /></Field>
        <div className="flex items-end pb-2"><Checkbox name="hasGps" label="Doimiy GPS-treker o'rnatilgan" defaultChecked={v?.hasGps} /></div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <Field label="Sug'urta kompaniyasi"><Input name="insuranceCompany" defaultValue={v?.insuranceCompany ?? ""} /></Field>
        <Field label="Polis raqami"><Input name="insurancePolicy" defaultValue={v?.insurancePolicy ?? ""} /></Field>
        <Field label="Sug'urta muddati"><Input name="insuranceUntil" type="date" defaultValue={v?.insuranceUntil ?? ""} /></Field>
      </div>

      {v?.odometerKm != null && <Field label="Probegni kamaytirish sababi" hint="Faqat probeg avvalgisidan kam kiritilsa kerak (auditga yoziladi)"><Input name="odometerReason" placeholder="Masalan: 125400 o'rniga 1254000 yozilgan edi" /></Field>}
      <Field label="Izoh"><Textarea name="note" defaultValue={v?.note ?? ""} rows={2} /></Field>
      {v && <Checkbox name="isActive" label="Faol (reysga beriladi). Sotilgan/hisobdan chiqarilgan bo'lsa belgini olib tashlang" defaultChecked={v.isActive} />}
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : v ? "Saqlash" : "Transport qo'shish"}</Button>
      </FormActions>
    </form>
  );
}
