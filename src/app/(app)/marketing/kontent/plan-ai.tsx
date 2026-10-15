"use client";

import { useActionState, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input } from "@/components/ui";
import { aiPlanMonth } from "./actions";

/** «AI oylik reja»: tanlangan oy uchun qoralama postlar (ssenariy, izoh RU/UZ, heshteg, vaqt) */
export function PlanAi({ defaultMonth }: { defaultMonth: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(aiPlanMonth, undefined);
  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}><Sparkles size={15} className="text-violet-600" /> AI oylik reja</Button>;
  return (
    <form action={action} className="w-full space-y-3 rounded-xl border border-violet-200 bg-linear-to-br from-violet-50 to-fuchsia-50 p-4 sm:w-[420px]">
      <p className="text-sm font-semibold text-violet-900">AI bir oylik kontent reja tuzadi</p>
      <div className="grid grid-cols-[1fr_90px] gap-2">
        <Field label="Oy"><Input type="month" name="month" defaultValue={defaultMonth} required /></Field>
        <Field label="Post soni"><Input name="count" inputMode="numeric" defaultValue={8} /></Field>
      </div>
      <Field label="Shu oy urg'u (ixtiyoriy)"><Input name="focus" placeholder="Masalan: FBS bloklar, mavsumiy chegirma" /></Field>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>{pending ? <><Loader2 size={14} className="animate-spin" /> Tuzilmoqda… (1–2 daqiqa)</> : <><Sparkles size={14} /> Tuzish</>}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Yopish</Button>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}
