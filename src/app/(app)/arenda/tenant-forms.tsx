"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, FormError, FormSuccess, Input } from "@/components/ui";
import { saveRentRemindDay } from "./actions";

/** Matnni nusxalash (eslatma matni, ulash havolasi) — sekretar ijarachiga o'zi yuboradi. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button type="button" variant="secondary" size="sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard yopiq — qo'lda nusxalanadi */ }
    }}>
      {done ? <><Check size={14} /> Nusxalandi</> : <><Copy size={14} /> {label}</>}
    </Button>
  );
}

/** Avtomatik eslatma kuni: har oyning N-sanasi (0 — o'chiq). */
export function RemindDayForm({ day }: { day: number }) {
  const [state, action, pending] = useActionState(saveRentRemindDay, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="text-sm text-slate-600">
        <span className="mb-1 block text-xs font-medium text-slate-500">Avtomatik eslatma — har oyning</span>
        <span className="inline-flex items-center gap-2">
          <Input name="day" type="number" min={0} max={28} defaultValue={day} className="h-9 w-20" />
          <span>-sanasi</span>
        </span>
      </label>
      <Button size="sm" variant="secondary" disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
      <span className="basis-full text-xs text-slate-500">0 — o&apos;chiq. Eslatma faqat Telegram botga ulangan, qarzi bor ijarachiga, oyda bir marta (08:00–21:00) ketadi.</span>
      <div className="basis-full"><FormError error={state?.error} />{state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}</div>
    </form>
  );
}
