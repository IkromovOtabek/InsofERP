"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import type { MarketingContentStatus, MarketingContentType } from "@/generated/prisma";
import { CONTENT_STATUS, CONTENT_TYPE } from "@/lib/marketing";
import { Button, Field, FormActions, FormError, Input, Select, Textarea } from "@/components/ui";
import { saveContent } from "./actions";

export type ContentValues = {
  title: string; type: MarketingContentType; rubric: string; status: MarketingContentStatus; publishDate: string;
  hook: string; script: string; caption: string; url: string; views: number; likes: number; saves: number; leads: number;
};

export const EMPTY_CONTENT: ContentValues = {
  title: "", type: "REELS", rubric: "", status: "IDEA", publishDate: "", hook: "", script: "", caption: "", url: "", views: 0, likes: 0, saves: 0, leads: 0,
};

export function ContentForm({ id, v, canEdit }: { id: string | null; v: ContentValues; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveContent.bind(null, id), undefined);
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <Field label="Sarlavha *"><Input name="title" defaultValue={v.title} required maxLength={160} /></Field>
          <Field label="Turi">
            <Select name="type" defaultValue={v.type}>
              {(Object.keys(CONTENT_TYPE) as MarketingContentType[]).map((k) => <option key={k} value={k}>{CONTENT_TYPE[k]}</option>)}
            </Select>
          </Field>
          <Field label="Holat">
            <Select name="status" defaultValue={v.status}>
              {(Object.keys(CONTENT_STATUS) as MarketingContentStatus[]).map((k) => <option key={k} value={k}>{CONTENT_STATUS[k].label}</option>)}
            </Select>
          </Field>
          <Field label="Nashr sanasi"><Input name="publishDate" type="date" defaultValue={v.publishDate} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field label="Rubrika"><Input name="rubric" defaultValue={v.rubric} placeholder="01 Завод изнутри" /></Field>
          <Field label="Hook (birinchi 2 soniya)"><Input name="hook" defaultValue={v.hook} /></Field>
        </div>
        <Field label="Ssenariy / matn"><Textarea name="script" rows={14} defaultValue={v.script} className="font-mono text-[13px] leading-relaxed" /></Field>
        <Field label="Izoh (caption) va heshteglar"><Textarea name="caption" rows={3} defaultValue={v.caption} /></Field>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
          <Field label="Havola (nashrdan keyin)"><Input name="url" defaultValue={v.url} placeholder="https://instagram.com/reel/…" /></Field>
          <Field label="Ko'rishlar"><Input name="views" inputMode="numeric" defaultValue={v.views} /></Field>
          <Field label="Layklar"><Input name="likes" inputMode="numeric" defaultValue={v.likes} /></Field>
          <Field label="Saqlashlar"><Input name="saves" inputMode="numeric" defaultValue={v.saves} /></Field>
          <Field label="Lidlar"><Input name="leads" inputMode="numeric" defaultValue={v.leads} /></Field>
        </div>
      </fieldset>
      <FormError error={state?.error} />
      {canEdit && <FormActions><Button disabled={pending}><Save size={15} /> {id ? "Saqlash" : "Qo'shish"}</Button></FormActions>}
    </form>
  );
}
