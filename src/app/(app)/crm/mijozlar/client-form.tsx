"use client";

import { startTransition, useActionState, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button, Callout, Checkbox, Field, FormActions, FormError, Input, LinkButton, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import type { CrmOptionRow, DupMatch } from "@/lib/crm/clients";
import { CRM_STATUSES, STATUS_LABEL, T } from "@/lib/crm/labels";
import { checkDuplicates, saveClient } from "./actions";

/** Xatosi maydon ostida ko'rinadiganlar; qolgani (dublikat, umumiy) — forma pastida */
const INLINE = ["name", "phone", "sourceId", "inn", "foremanPhone", "link", "ownerId", "clientTypeId"];

export type ClientFormValues = {
  name: string; inn: string; phone: string; contactPerson: string; region: string; district: string; objectType: string;
  foremanName: string; foremanPhone: string; clientTypeId: string; sourceId: string; ownerId: string; crmStatus: string;
  link: string; crmNote: string;
};

/**
 * Mijoz formasi (CRM_SPEC 3.1, 5.2). Telefonda bir ustun, asosiy maydonlar tepada, qolgani «Qo'shimcha ma'lumotlar» ichida.
 * STIR / telefon yozib bo'lingach mavjud mijoz qidiriladi — topilsa «Shu mijozni ochish».
 */
export function ClientForm({ id, values, sources, clientTypes, users, manager, cancelHref }: {
  id: string | null; values: ClientFormValues; sources: CrmOptionRow[]; clientTypes: CrmOptionRow[];
  users: { id: string; fullName: string }[]; manager: boolean; cancelHref: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveClient.bind(null, id), undefined);
  const [dups, setDups] = useState<DupMatch[]>([]);
  const [, startCheck] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const err = (f: string) => (state?.field === f ? state.error : undefined);
  const inMore = ["inn", "clientTypeId", "foremanPhone", "link"].includes(state?.field ?? "");
  const hasMore = !!(values.district || values.objectType || values.foremanName || values.foremanPhone || values.clientTypeId || values.link || values.crmNote || values.inn);

  const check = () => {
    const f = form.current;
    if (!f) return;
    const inn = (f.elements.namedItem("inn") as HTMLInputElement | null)?.value ?? "";
    const phone = (f.elements.namedItem("phone") as HTMLInputElement | null)?.value ?? "";
    startCheck(async () => setDups(await checkDuplicates(inn, phone, id)));
  };
  const phoneDup = dups.some((x) => x.by === "phone");

  return (
    // onSubmit + preventDefault: `action={…}` xato qaytganda ham formani tozalab yuboradi (React 19) — operator yozgani yo'qolmasin
    <form ref={form} onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="grid max-w-2xl gap-4" noValidate>
      <Field label={`${T.field.name} *`} error={err("name")}>
        <Input name="name" defaultValue={values.name} required autoComplete="off" aria-invalid={!!err("name")} placeholder="ZASTROY MCHJ" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={T.field.phone} error={err("phone")}>
          <Input name="phone" type="tel" inputMode="tel" defaultValue={values.phone} onBlur={check} aria-invalid={!!err("phone")} placeholder="+998 90 123 45 67" />
        </Field>
        <Field label={T.field.contactPerson}>
          <Input name="contactPerson" defaultValue={values.contactPerson} />
        </Field>
      </div>

      {dups.length > 0 && (
        <Callout tone="warning" title={T.form.dupTitle}>
          <ul className="mt-1 grid gap-1.5">
            {dups.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{x.name}</span>
                <span className="text-xs">({x.by === "inn" ? T.field.inn : T.field.phone}{x.inCrm ? "" : ` · ${T.clients.notCrm}`})</span>
                <Link href={`/crm/mijozlar/${x.id}`} className="inline-flex items-center gap-1 font-medium underline">{T.form.dupOpen} <ExternalLink size={13} /></Link>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`${T.field.source} *`} error={err("sourceId")}>
          <Select name="sourceId" defaultValue={values.sourceId} required aria-invalid={!!err("sourceId")}>
            <option value="">{T.form.choose}</option>
            {sources.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label={T.field.region}>
          <Input name="region" defaultValue={values.region} />
        </Field>
      </div>

      {manager && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={T.field.owner} error={err("ownerId")}>
            <Select name="ownerId" defaultValue={values.ownerId}>
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
          </Field>
          <Field label={T.field.status}>
            <Select name="crmStatus" defaultValue={values.crmStatus}>
              <option value="">{T.form.statusAuto}</option>
              {CRM_STATUSES.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
            </Select>
          </Field>
        </div>
      )}

      <details open={hasMore || inMore} className="group rounded-lg border border-slate-200 p-3 open:pb-4">
        <summary className="cursor-pointer select-none text-sm font-medium text-slate-700 pointer-coarse:py-2">{T.form.more}</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label={T.field.inn} error={err("inn")}>
            <Input name="inn" inputMode="numeric" defaultValue={values.inn} onBlur={check} aria-invalid={!!err("inn")} placeholder="9 raqam" />
          </Field>
          <Field label={T.field.clientType} error={err("clientTypeId")}>
            <Select name="clientTypeId" defaultValue={values.clientTypeId}>
              <option value="">{T.form.choose}</option>
              {clientTypes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={T.field.district}>
            <Input name="district" defaultValue={values.district} />
          </Field>
          <Field label={T.field.objectType}>
            <Input name="objectType" defaultValue={values.objectType} />
          </Field>
          <Field label={T.field.foremanName}>
            <Input name="foremanName" defaultValue={values.foremanName} />
          </Field>
          <Field label={T.field.foremanPhone} error={err("foremanPhone")}>
            <Input name="foremanPhone" type="tel" inputMode="tel" defaultValue={values.foremanPhone} aria-invalid={!!err("foremanPhone")} />
          </Field>
          <Field label={T.field.link} error={err("link")} className="sm:col-span-2">
            <Input name="link" type="url" inputMode="url" defaultValue={values.link} aria-invalid={!!err("link")} placeholder="https://tender.mc.uz/…" />
          </Field>
          <Field label={T.field.note} className="sm:col-span-2">
            <Textarea name="crmNote" defaultValue={values.crmNote} rows={3} />
          </Field>
        </div>
      </details>

      {(phoneDup || state?.field === "dup") && <Checkbox name="force" value="1" label={T.form.dupForce} />}
      <FormError error={INLINE.includes(state?.field ?? "") ? undefined : state?.error} />
      <FormActions>
        <Button type="submit" disabled={pending} className="min-h-11 flex-1 sm:flex-none">{pending ? "…" : T.form.save}</Button>
        <LinkButton href={cancelHref} variant="secondary" className="min-h-11">{T.form.cancel}</LinkButton>
      </FormActions>
    </form>
  );
}
