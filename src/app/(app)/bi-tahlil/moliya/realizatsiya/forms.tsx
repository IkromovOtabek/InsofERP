"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { saveSalesRecord } from "./actions";

/** Guruh rekord oyi: hajm, oy va (ixtiyoriy) o'sha oyning ish kunlari. Sariq kataklar — qo'lda kiritiladi. */
export function SalesRecordForm({ group, unit, qty, ym, workDays, autoWd }: { group: string; unit: string; qty: number | null; ym: string; workDays: number | null; autoWd: number | null }) {
  const [state, action, pending] = useActionState(saveSalesRecord, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="group" value={group} />
      <span className="w-28 min-w-0 truncate font-medium text-slate-700" title={group}>{group}</span>
      <Input name="qty" inputMode="decimal" defaultValue={qty != null ? String(qty) : ""} placeholder={`hajm, ${unit}`} aria-label={`${group}: rekord hajmi`} className="h-8 w-28 bg-amber-50 text-right tabular" />
      <Input type="month" name="ym" defaultValue={ym} aria-label={`${group}: rekord oy`} className="h-8 w-40 bg-amber-50" />
      <Input name="workDays" inputMode="numeric" defaultValue={workDays != null ? String(workDays) : ""} placeholder={autoWd != null ? String(autoWd) : "ish kuni"} title="Rekord oy ish kuni; bo'sh — Dushanba–Shanba bo'yicha" aria-label={`${group}: rekord oy ish kuni`} className="h-8 w-20 bg-amber-50 text-right tabular" />
      <Button size="sm" variant="secondary" disabled={pending} title="Saqlash"><Save size={14} /></Button>
      {state?.error && <span className="text-[13px] text-red-600">{state.error}</span>}
      {state?.ok && <span className="text-[13px] text-emerald-600">Saqlandi</span>}
    </form>
  );
}
