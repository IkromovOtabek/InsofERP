"use client";

import { useActionState } from "react";
import { saveSite } from "../actions";
import { AddressPicker } from "@/components/address-picker";
import { Button, Checkbox, Field, FormActions, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";

export type SiteFormValue = {
  id: string; customerId: string; name: string; address: string; lat: number | null; lng: number | null;
  contactName: string | null; contactPhone: string | null; deliveryHours: string | null; instructions: string | null; isActive: boolean;
};

/** Obyekt kartasi (TZ 8): nom, mijoz, manzil+nuqta, kontakt, qabul vaqti, maxsus ko'rsatma. */
export function SiteForm({ s, customers, searchEnabled }: { s?: SiteFormValue; customers: { id: string; name: string }[]; searchEnabled: boolean }) {
  const editing = !!s?.id;
  const [state, action, pending] = useActionState(saveSite.bind(null, editing ? s!.id : null), undefined);
  return (
    <form action={action} className="grid grid-cols-2 gap-4">
      <div className="col-span-2"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Saqlandi" />}</div>
      <Field label="Mijoz *">
        <Select name="customerId" defaultValue={s?.customerId ?? ""} required>
          <option value="">— tanlang —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Obyekt nomi *"><Input name="name" defaultValue={s?.name} placeholder="Yunusobod 12-kvartal, 3-blok" required /></Field>
      <AddressPicker name="address" label="Manzil *" defaultAddress={s?.address} defaultLat={s?.lat} defaultLng={s?.lng} searchEnabled={searchEnabled} required />
      <Field label="Kontakt shaxs"><Input name="contactName" defaultValue={s?.contactName ?? ""} placeholder="Prorab F.I.O." /></Field>
      <Field label="Telefon"><Input name="contactPhone" defaultValue={s?.contactPhone ?? ""} placeholder="+998 90 123 45 67" /></Field>
      <Field label="Qabul qilish vaqti" hint="Haydovchi shu vaqtga moslab yuboriladi"><Input name="deliveryHours" defaultValue={s?.deliveryHours ?? ""} placeholder="08:00–18:00, tushlik 13:00–14:00" /></Field>
      <div />
      <Field label="Maxsus ko'rsatmalar" hint="Haydovchi ilovasida reys izohida ko'rinadi" className="col-span-2">
        <Textarea name="instructions" defaultValue={s?.instructions ?? ""} rows={3} placeholder="Kirish — orqa darvozadan; nasos joyi — sharqiy tomonda; 20 t dan og'ir mashina ko'prikdan o'tmaydi" />
      </Field>
      {editing && <div className="col-span-2"><Checkbox name="isActive" label="Faol obyekt (qurilish davom etmoqda)" defaultChecked={s!.isActive} /></div>}
      <div className="col-span-2"><FormActions><Button disabled={pending}>{pending ? "Saqlanmoqda…" : editing ? "Saqlash" : "Obyekt qo'shish"}</Button></FormActions></div>
    </form>
  );
}
