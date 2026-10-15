"use client";

import { useActionState, useEffect, useRef } from "react";
import { Save } from "lucide-react";
import type { AdCampaignStatus, AdChannel } from "@/generated/prisma";
import { CAMPAIGN_STATUS, CHANNEL } from "@/lib/marketing-labels";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { saveCampaign } from "./actions";

export type CampaignValues = {
  name: string; channel: AdChannel; status: AdCampaignStatus; utmCampaign: string; budget: string; spend: string;
  impressions: number; clicks: number; startDate: string; endDate: string; note: string;
};

export const EMPTY_CAMPAIGN: CampaignValues = {
  name: "", channel: "YANDEX", status: "DRAFT", utmCampaign: "", budget: "0", spend: "0", impressions: 0, clicks: 0, startDate: "", endDate: "", note: "",
};

export function CampaignForm({ id, v, canEdit }: { id: string | null; v: CampaignValues; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveCampaign.bind(null, id), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && !id) ref.current?.reset(); }, [state, id]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Nomi *" className="lg:col-span-2"><Input name="name" defaultValue={v.name} required placeholder="Yandex qidiruv — FBS" /></Field>
        <Field label="Kanal">
          <Select name="channel" defaultValue={v.channel}>{(Object.keys(CHANNEL) as AdChannel[]).map((k) => <option key={k} value={k}>{CHANNEL[k]}</option>)}</Select>
        </Field>
        <Field label="Holat">
          <Select name="status" defaultValue={v.status}>{(Object.keys(CAMPAIGN_STATUS) as AdCampaignStatus[]).map((k) => <option key={k} value={k}>{CAMPAIGN_STATUS[k].label}</option>)}</Select>
        </Field>
        <Field label="utm_campaign" hint="Arizalar shu kalit bilan bog'lanadi"><Input name="utmCampaign" defaultValue={v.utmCampaign} placeholder="ya_search_fbs" className="font-mono" /></Field>
        <Field label="Oylik byudjet, so'm"><Input name="budget" inputMode="decimal" defaultValue={v.budget} /></Field>
        <Field label="Sarflandi, so'm"><Input name="spend" inputMode="decimal" defaultValue={v.spend} /></Field>
        <Field label="Ko'rsatishlar"><Input name="impressions" inputMode="numeric" defaultValue={v.impressions} /></Field>
        <Field label="Kliklar"><Input name="clicks" inputMode="numeric" defaultValue={v.clicks} /></Field>
        <Field label="Boshlanish"><Input name="startDate" type="date" defaultValue={v.startDate} /></Field>
        <Field label="Tugash"><Input name="endDate" type="date" defaultValue={v.endDate} /></Field>
        <Field label="Izoh"><Input name="note" defaultValue={v.note} /></Field>
      </fieldset>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
      {canEdit && <Button size="sm" disabled={pending}><Save size={14} /> {id ? "Saqlash" : "Kampaniya qo'shish"}</Button>}
    </form>
  );
}
