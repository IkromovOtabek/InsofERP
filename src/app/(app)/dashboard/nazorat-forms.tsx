"use client";

import { useActionState } from "react";
import { Save, Send } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { saveNazoratSettingsAction, sendNazoratNowAction } from "./nazorat-actions";

export function NazoratSettingsForm({ enabled, hour, owners, fuelMaterialId, materials }: { enabled: boolean; hour: number; owners: boolean; fuelMaterialId: string | null; materials: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveNazoratSettingsAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Telegram hisobot"><Select name="controlReportEnabled" defaultValue={enabled ? "1" : "0"}><option value="1">Yoqilgan</option><option value="0">O&apos;chiq</option></Select></Field>
        <Field label="Soat (Toshkent)" hint="har kuni shu soatda"><Input name="controlReportHour" type="number" min={0} max={23} defaultValue={hour} required /></Field>
        <Field label="Mas'ullarga ham" hint="har biriga faqat o'z bandlari"><Select name="controlNotifyOwners" defaultValue={owners ? "1" : "0"}><option value="1">Ha</option><option value="0">Yo&apos;q, faqat direktorga</option></Select></Field>
        <Field label="Dizel (salyarka) xomashyosi" hint="7-tekshiruv uchun"><Select name="fuelMaterialId" defaultValue={fuelMaterialId ?? ""}><option value="">— tanlanmagan —</option>{materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
      <Button size="sm" disabled={pending}><Save size={14} /> Saqlash</Button>
    </form>
  );
}

export function SendNowButton() {
  const [state, action, pending] = useActionState(sendNazoratNowAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={pending}><Send size={14} /> {pending ? "Yuborilmoqda…" : "Hozir yuborish"}</Button>
      {state?.note && <span className="text-[13px] text-slate-600">{state.note}</span>}
      {state?.error && <span className="text-[13px] text-red-600">{state.error}</span>}
    </form>
  );
}
