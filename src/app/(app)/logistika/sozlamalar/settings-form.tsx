"use client";

import { useActionState } from "react";
import { saveLogisticsSettings } from "../actions";
import { Button, Field, FormActions, FormError, FormSuccess, Input } from "@/components/ui";

type V = { lateWarnMin: number; lateCritMin: number; gpsSilentMin: number; loadedWarnMin: number; assignLeadMin: number; shiftStartHour: number; shiftEndHour: number; avgSpeedKmh: number; stopAlertMin: number; offRouteM: number };

const FIELDS: [keyof V, string, string][] = [
  ["lateWarnMin", "Kechikish — e'tibor, daq", "Reys rejadagi vaqtdan shuncha kechiksa sariq"],
  ["lateCritMin", "Kechikish — kritik, daq", "Shuncha kechiksa qizil"],
  ["gpsSilentMin", "GPS jim, daq", "Yo'ldagi mashinadan signal kelmasa — xabar (3–240)"],
  ["stopAlertMin", "Uzoq turish, daq", "Yo'lda bir joyda shuncha tursa — xabar (5–240)"],
  ["offRouteM", "Yo'ldan chiqish, m", "Rejadagi yo'ldan shuncha uzoqlashsa — xabar (100–5000)"],
  ["loadedWarnMin", "Yuklangan, chiqmagan, daq", "Beton qotish xavfi (×3 — kritik)"],
  ["assignLeadMin", "Reyssiz zayavka, daq", "Yetkazishga shuncha qolganda transport yo'q — kritik"],
  ["avgSpeedKmh", "O'rtacha tezlik, km/soat", "GPS ETA bermasa — masofa ÷ shu tezlik"],
  ["shiftStartHour", "Smena boshlanishi, soat", "Transport bandligi va kalendar"],
  ["shiftEndHour", "Smena tugashi, soat", ""],
];

export function SettingsForm({ v }: { v: V }) {
  const [state, action, pending] = useActionState(saveLogisticsSettings, undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="sm:col-span-2 xl:col-span-4"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Saqlandi" />}</div>
      {FIELDS.map(([k, label, hint]) => <Field key={k} label={label} hint={hint || undefined}><Input name={k} type="number" defaultValue={v[k]} required /></Field>)}
      <div className="sm:col-span-2 xl:col-span-4"><FormActions><Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button></FormActions></div>
    </form>
  );
}
