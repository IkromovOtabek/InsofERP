"use client";

import { useActionState } from "react";
import { Button, Field, FormActions, FormError, FormSuccess, Input, Textarea } from "@/components/ui";
import { saveOfferSettings } from "../actions";

export type OfferSettingsValues = { oked: string | null; vatRegNo: string | null; offerIntro: string | null; offerTerms: string | null; offerValidDays: number };

/** Hujjat rekvizitlari va matnlari. Bo'sh qoldirilsa `lib/offers.ts` dagi standart matn ishlatiladi. */
export function OfferSettingsForm({ v, defaults }: { v: OfferSettingsValues; defaults: { intro: string; terms: string } }) {
  const [state, action, pending] = useActionState(saveOfferSettings, undefined);
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="OKED kodi" hint="Hujjat rekvizitlarida INN yonida"><Input name="oked" defaultValue={v.oked ?? ""} placeholder="23610" /></Field>
        <Field label="QQS to'lovchisi ro'yxat raqami" hint="РКП НДС"><Input name="vatRegNo" defaultValue={v.vatRegNo ?? ""} placeholder="327150004640" /></Field>
        <Field label="Standart amal qilish muddati, kun" hint="Yangi taklif formasi shu sanani taklif qiladi"><Input name="offerValidDays" type="number" min={1} max={365} defaultValue={v.offerValidDays} required /></Field>
      </div>
      <Field label="Kirish matni (jadvaldan oldin)" hint="Bo'sh qolsa standart matn chiqadi. Hujjat tuzilganda matn nusxa bo'lib saqlanadi — keyingi o'zgarish eski takliflarga ta'sir qilmaydi">
        <Textarea name="offerIntro" rows={5} defaultValue={v.offerIntro ?? ""} placeholder={defaults.intro} />
      </Field>
      <Field label="Shartlar (jadvaldan keyin)" hint="Har qatori alohida band: quvvat, avtokran, mash/soat narxi, narx o'zgarishi haqida eslatma… Oxirgi ikki qator qalin chiqadi">
        <Textarea name="offerTerms" rows={8} defaultValue={v.offerTerms ?? ""} placeholder={defaults.terms} />
      </Field>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
      <FormActions><Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button></FormActions>
    </form>
  );
}
