"use client";

import { useActionState, useState } from "react";
import { Check, ExternalLink, KeyRound, Plus, Save, ShieldOff, UserPlus } from "lucide-react";
import { Button, Field, FormError, Input, PasswordInput, Select, Textarea } from "@/components/ui";
import { PASSWORD_HINT } from "@/lib/password-policy";
import type { HelpTopicId } from "@/lib/control/help-content";
import { HelpButton } from "./_help/help";

/** Forma maydoni yorlig'i + «?» */
const L = ({ text, topic }: { text: string; topic: HelpTopicId }) => <span className="inline-flex items-center gap-1">{text}<HelpButton topic={topic} /></span>;
import {
  changeOwnPasswordAction, createAdminAction, createTenantAction, setDirectorAction,
  ssoAction, suspendTenantAction, updateTenantAction,
} from "./actions";

const PLANS: [string, string][] = [["standard", "Standart"], ["pro", "Pro"], ["trial", "Sinov (trial)"]];

export function NewTenantForm({ baseDomain }: { baseDomain: string | null }) {
  const [state, action, pending] = useActionState(createTenantAction, undefined);
  const [slug, setSlug] = useState("");
  return (
    <form action={action} className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Korxona</legend>
        <Field label="Korxona nomi *" help={<HelpButton topic="form:name" />}><Input name="name" required placeholder="Sharq Beton MChJ" /></Field>
        <Field label="Qisqa nom (subdomen) *" help={<HelpButton topic="form:slug" />} hint="lotin kichik harf, raqam, chiziqcha — keyin o'zgarmaydi">
          <Input name="slug" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="sharq" />
        </Field>
        <Field label="Domen" help={<HelpButton topic="form:domain" />} hint="DNS shu serverga yo'naltirilgan bo'lsin">
          <Input name="domain" key={slug} defaultValue={baseDomain && slug ? `${slug}.${baseDomain}` : ""} placeholder="sharq.insof.uz" />
        </Field>
        <Field label="Tarif" help={<HelpButton topic="form:plan" />}><Select name="plan" defaultValue="standard">{PLANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Mas'ul shaxs"><Input name="contactName" /></Field>
        <Field label="Telefon"><Input name="contactPhone" placeholder="+998 90 123 45 67" /></Field>
        <Field label="ECO API manzili" help={<HelpButton topic="form:eco" />} hint="ixtiyoriy — monitoring /v1/health ni tekshiradi"><Input name="ecoApiUrl" placeholder="https://eco.insof.uz" /></Field>
        <Field label="Izoh"><Input name="note" /></Field>
      </fieldset>
      <fieldset className="grid gap-3 rounded-lg border border-violet-200 bg-violet-50/50 p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold text-violet-800"><L text="Direktor hisobi — korxonaning birinchi foydalanuvchisi" topic="form:director" /></legend>
        <Field label="F.I.O. *"><Input name="directorName" required /></Field>
        <Field label="Login *"><Input name="directorLogin" required autoComplete="off" /></Field>
        <Field label="Parol *" hint={PASSWORD_HINT}><PasswordInput name="directorPassword" required autoComplete="new-password" /></Field>
        <p className="text-xs text-violet-800 sm:col-span-3">Direktor kirgach o&apos;zi xodimlarga login/parol beradi (Sozlamalar → Foydalanuvchilar, Otdel kadr).</p>
      </fieldset>
      <FormError error={state?.error} />
      <span className="inline-flex items-center gap-1"><Button disabled={pending}><Plus size={16} /> {pending ? "Yaratilmoqda… (baza va migratsiya ~30 s)" : "Korxonani yaratish"}</Button><HelpButton topic="form:created" /></span>
    </form>
  );
}

type TenantEditable = { slug: string; name: string; domain: string | null; plan: string; contactName: string | null; contactPhone: string | null; note: string | null; ecoApiUrl: string | null };

export function EditTenantForm({ t }: { t: TenantEditable }) {
  const [state, action, pending] = useActionState(updateTenantAction.bind(null, t.slug), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field label="Nomi"><Input name="name" defaultValue={t.name} /></Field>
      <Field label="Domen" help={<HelpButton topic="form:domain" />}><Input name="domain" defaultValue={t.domain ?? ""} /></Field>
      <Field label="Tarif"><Select name="plan" defaultValue={t.plan}>{PLANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field label="ECO API" help={<HelpButton topic="form:eco" />}><Input name="ecoApiUrl" defaultValue={t.ecoApiUrl ?? ""} /></Field>
      <Field label="Mas'ul shaxs"><Input name="contactName" defaultValue={t.contactName ?? ""} /></Field>
      <Field label="Telefon"><Input name="contactPhone" defaultValue={t.contactPhone ?? ""} /></Field>
      <Field label="Izoh" className="sm:col-span-2"><Textarea name="note" defaultValue={t.note ?? ""} rows={2} /></Field>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button variant="secondary" disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button><HelpButton topic="tenant:edit" />
        <FormError error={state?.error} />
      </div>
    </form>
  );
}

export function DirectorForm({ slug, login }: { slug: string; login: string | null }) {
  const [state, action, pending] = useActionState(setDirectorAction.bind(null, slug), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <Field label="F.I.O."><Input name="fullName" required /></Field>
      <Field label="Login"><Input name="login" defaultValue={login ?? ""} required autoComplete="off" /></Field>
      <Field label="Yangi parol" hint={PASSWORD_HINT}><PasswordInput name="password" required autoComplete="new-password" /></Field>
      <span className="inline-flex items-center gap-0.5"><Button disabled={pending}><KeyRound size={16} /> Berish</Button><HelpButton topic="tenant:director" /></span>
      <div className="sm:col-span-4">
        {state?.ok && <p className="text-sm text-emerald-700">{state.note}</p>}
        <FormError error={state?.error} />
      </div>
    </form>
  );
}

export function SuspendForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(suspendTenantAction.bind(null, slug), undefined);
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Korxona to'xtatilsinmi? Barcha xodimlar veb va mobil ilovadan darhol chiqariladi.")) e.preventDefault(); }} className="flex flex-wrap items-end gap-2">
      <Field label="Sabab (jurnal uchun)" className="min-w-64 flex-1"><Input name="reason" required placeholder="To'lov muddati o'tgan" /></Field>
      <span className="inline-flex items-center gap-0.5"><Button variant="danger" disabled={pending}><ShieldOff size={16} /> To&apos;xtatish</Button><HelpButton topic="tenant:suspend" /></span>
      <div className="basis-full"><FormError error={state?.error} /></div>
    </form>
  );
}

/** Korxonaga IT sifatida kirish — token server action'da imzolanadi, yangi oynada POST bilan yuboriladi. */
export function SsoButton({ slug, disabled }: { slug: string; disabled?: boolean }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function go() {
    setPending(true); setError(undefined);
    const r = await ssoAction(slug).finally(() => setPending(false));
    if (!r.url || !r.token) { setError(r.error ?? "Kirib bo'lmadi"); return; }
    const f = document.createElement("form");
    f.method = "POST"; f.action = r.url; f.target = "_blank";
    const i = document.createElement("input");
    i.type = "hidden"; i.name = "token"; i.value = r.token;
    f.appendChild(i); document.body.appendChild(f); f.submit(); f.remove();
  }
  return (
    <span className="inline-flex flex-col items-start">
      <span className="inline-flex items-center gap-0.5"><Button type="button" variant="secondary" size="sm" onClick={go} disabled={disabled || pending}><ExternalLink size={14} /> {pending ? "…" : "Kirish (IT)"}</Button><HelpButton topic="tenant:sso" /></span>
      {error && <span className="mt-1 text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function NewAdminForm() {
  const [state, action, pending] = useActionState(createAdminAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <Field label="F.I.O."><Input name="fullName" required /></Field>
      <Field label="Login"><Input name="login" required autoComplete="off" /></Field>
      <Field label="Parol" hint={PASSWORD_HINT}><PasswordInput name="password" required autoComplete="new-password" /></Field>
      <span className="inline-flex items-center gap-0.5"><Button disabled={pending}><UserPlus size={16} /> Qo&apos;shish</Button><HelpButton topic="adm:new" /></span>
      <div className="sm:col-span-4">{state?.ok && <p className="text-sm text-emerald-700">Qo&apos;shildi</p>}<FormError error={state?.error} /></div>
    </form>
  );
}

export function OwnPasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPasswordAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Joriy parol"><PasswordInput name="current" required autoComplete="current-password" /></Field>
      <Field label="Yangi parol" hint={PASSWORD_HINT}><PasswordInput name="password" required autoComplete="new-password" /></Field>
      <span className="inline-flex items-center gap-0.5"><Button variant="secondary" disabled={pending}><KeyRound size={16} /> Almashtirish</Button><HelpButton topic="adm:password" /></span>
      <div className="sm:col-span-3">{state?.ok && <p className="text-sm text-emerald-700">Parol almashdi</p>}<FormError error={state?.error} /></div>
    </form>
  );
}
