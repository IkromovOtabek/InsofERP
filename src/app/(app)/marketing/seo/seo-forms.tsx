"use client";

import { useActionState, useEffect, useRef } from "react";
import { Check, Plus } from "lucide-react";
import { Button, Field, FormError, Input, Select, inputCls } from "@/components/ui";
import { addKeyword, savePositions } from "./actions";

const small = `${inputCls} !h-8 w-16 px-1.5 text-center tabular`;

export function PositionsForm({ k, canEdit }: { k: { id: string; frequency: number | null; posYandex: number | null; posGoogle: number | null }; canEdit: boolean }) {
  const [state, action, pending] = useActionState(savePositions.bind(null, k.id), undefined);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input name="frequency" aria-label="Chastota" defaultValue={k.frequency ?? ""} disabled={!canEdit} className={`${small} w-20`} inputMode="numeric" placeholder="—" />
      <input name="posYandex" aria-label="Yandex pozitsiya" defaultValue={k.posYandex ?? ""} disabled={!canEdit} className={small} inputMode="numeric" placeholder="—" />
      <input name="posGoogle" aria-label="Google pozitsiya" defaultValue={k.posGoogle ?? ""} disabled={!canEdit} className={small} inputMode="numeric" placeholder="—" />
      {canEdit && (
        <button type="submit" disabled={pending} aria-label="Saqlash" title="Saqlash" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40">
          <Check size={15} />
        </button>
      )}
      {state?.error ? <span role="alert" className="text-xs text-red-600">{state.error}</span> : state?.ok ? <span className="text-xs text-emerald-600">Saqlandi</span> : null}
    </form>
  );
}

export function AddKeyword({ clusters }: { clusters: string[] }) {
  const [state, action, pending] = useActionState(addKeyword, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1.3fr_90px_1.3fr_auto] sm:items-end">
        <Field label="So'rov"><Input name="phrase" required placeholder="фбс блоки цена ташкент" /></Field>
        <Field label="Klaster">
          <Input name="cluster" list="seo-clusters" required placeholder="K2. ФБС блоки" />
          <datalist id="seo-clusters">{clusters.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Til"><Select name="lang"><option value="ru">RU</option><option value="uz">UZ</option></Select></Field>
        <Field label="Sahifa"><Input name="url" placeholder="/" className="font-mono" /></Field>
        <Button size="sm" disabled={pending}><Plus size={14} /> Qo&apos;shish</Button>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}
