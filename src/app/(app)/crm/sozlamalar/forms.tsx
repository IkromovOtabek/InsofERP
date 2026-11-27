"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { Check, Plus } from "lucide-react";
import { Button, Checkbox, Field, FormError, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { GROUP_LABEL } from "@/lib/crm/labels";
import { saveActivity, saveOption, saveResult } from "./actions";

type Act = (p: ActionState, fd: FormData) => Promise<ActionState>;

/** Saqlangandan keyin forma tozalanmasin (React 19 action reset) — onSubmit orqali; yangi qator formasi faqat muvaffaqiyatdan keyin tozalanadi */
function useForm(fn: Act, isNew = false) {
  const [state, action, pending] = useActionState<ActionState, FormData>(fn, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (isNew && state?.ok) ref.current?.reset(); }, [state, isNew]);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  return { state, pending, onSubmit, ref };
}

function Status({ state }: { state: ActionState }) {
  if (state?.error) return <FormError error={state.error} />;
  if (state?.ok) return <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check size={13} /> {state.note}</span>;
  return null;
}

export type OptionRow = { id: string; label: string; sort: number; isActive: boolean; used: number };

export function OptionForm({ kind, row }: { kind: string; row?: OptionRow }) {
  const { state, pending, onSubmit, ref } = useForm(saveOption.bind(null, row?.id ?? null), !row);
  return (
    <form ref={ref} onSubmit={onSubmit} className="grid grid-cols-[1fr_4.5rem] items-end gap-2 py-2 sm:grid-cols-[1fr_5rem_auto_auto]">
      <input type="hidden" name="kind" value={kind} />
      <Input name="label" defaultValue={row?.label} placeholder={row ? undefined : "Yangi qiymat"} aria-label="Nomi" required />
      <Input name="sort" type="number" defaultValue={row?.sort ?? 50} aria-label="Tartib" title="Tartib (kichigi tepada)" />
      {row ? <Checkbox name="isActive" defaultChecked={row.isActive} label={row.used ? `Faol · ${row.used}` : "Faol"} /> : <input type="hidden" name="isActive" value="1" />}
      <Button type="submit" variant={row ? "secondary" : "primary"} size="sm" disabled={pending} className="min-h-10">{row ? "Saqlash" : <><Plus size={14} /> Qo'shish</>}</Button>
      <div className="col-span-full empty:hidden"><Status state={state} /></div>
    </form>
  );
}

export type ResultRow = { id: string; label: string; stage: number; group: string; nextRule: string; defaultDays: number | null; sort: number; isActive: boolean; used: number };
const RULES: Record<string, string> = { REQUIRED: "Majburiy", OPTIONAL: "Ixtiyoriy", NONE: "Kerak emas" };

export function ResultForm({ row }: { row?: ResultRow }) {
  const { state, pending, onSubmit, ref } = useForm(saveResult.bind(null, row?.id ?? null), !row);
  return (
    <form ref={ref} onSubmit={onSubmit} className="grid grid-cols-2 items-end gap-2 border-b border-slate-100 py-3 last:border-0 sm:grid-cols-[1.6fr_4rem_1fr_1fr_4.5rem_4rem_auto_auto]">
      <Field label="Natija" className="col-span-2 sm:col-span-1"><Input name="label" defaultValue={row?.label} required /></Field>
      <Field label="Bosqich"><Input name="stage" type="number" defaultValue={row?.stage ?? 2} /></Field>
      <Field label="Guruh"><Select name="group" defaultValue={row?.group ?? "CONTINUE"}>{Object.entries(GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="Keyingi sana"><Select name="nextRule" defaultValue={row?.nextRule ?? "REQUIRED"}>{Object.entries(RULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="+ kun"><Input name="defaultDays" type="number" defaultValue={row?.defaultDays ?? ""} /></Field>
      <Field label="Tartib"><Input name="sort" type="number" defaultValue={row?.sort ?? 50} /></Field>
      {row ? <Checkbox name="isActive" defaultChecked={row.isActive} label={row.used ? `Faol · ${row.used}` : "Faol"} /> : <input type="hidden" name="isActive" value="1" />}
      <Button type="submit" variant={row ? "secondary" : "primary"} size="sm" disabled={pending} className="min-h-10">{row ? "Saqlash" : <><Plus size={14} /> Qo'shish</>}</Button>
      <div className="col-span-full empty:hidden"><Status state={state} /></div>
    </form>
  );
}

export function ActivityForm({ active, cold }: { active: number; cold: number }) {
  const { state, pending, onSubmit } = useForm(saveActivity);
  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-3 sm:grid-cols-2">
      <Field label="«Faol» — oxirgi zayafkadan, kun" hint={`0–${active} kun`}><Input name="crmActiveDays" type="number" defaultValue={active} required /></Field>
      <Field label="«Sovib qoldi» — gacha, kun" hint={`${active + 1}–${cold}; undan keyin «Eski: qayta aloqa kerak»`}><Input name="crmColdDays" type="number" defaultValue={cold} required /></Field>
      <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" disabled={pending}>Saqlash</Button><Status state={state} /></div>
    </form>
  );
}
