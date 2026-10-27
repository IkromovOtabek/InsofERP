"use client";

import { useActionState } from "react";
import { Check, Save } from "lucide-react";
import { Button, FormError, FormSuccess, Input } from "@/components/ui";
import { saveCostMonthAction, saveGroupWageAction, toggleCostCategoryAction } from "./cost-actions";

const fmt = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d).replace(".", ",");

/** Oy koeffitsiyentlari va ishlab chiqarish stavkasi: sariq katakka yozilsa — qo'lda, bo'sh — avtomatik qiymat. */
export function CostMonthForm({ month, groups, coefs, manualCoefs, autoCoefs, overheadPct, autoPct, manualPct }: {
  month: string; groups: string[]; coefs: Record<string, number>; manualCoefs: string[]; autoCoefs: Record<string, number>;
  overheadPct: number; autoPct: number; manualPct: boolean;
}) {
  const [state, action, pending] = useActionState(saveCostMonthAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="month" value={month} />
      {groups.map((g) => (
        <label key={g} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-slate-600">{g} koeffitsiyenti</span>
          <Input name={`coef:${g}`} inputMode="decimal" defaultValue={manualCoefs.includes(g) ? fmt(coefs[g] ?? 1) : ""} placeholder={autoCoefs[g] !== undefined ? fmt(autoCoefs[g]!) : "1"} className="h-8 w-24 bg-amber-50 text-right tabular" />
        </label>
      ))}
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-slate-600">Ishlab chiqarish xarajatlari (xom-ashyoga %)</span>
        <Input name="overheadPct" inputMode="decimal" defaultValue={manualPct ? fmt(overheadPct, 1) : ""} placeholder={fmt(autoPct, 1)} className="h-8 w-24 bg-amber-50 text-right tabular" />
      </label>
      <p className="text-[12px] text-slate-400">Bo&apos;sh katak — avtomatik qiymat (kulrang).</p>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending}><Save size={14} /> Saqlash</Button>
        <FormError error={state?.error} />
        <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
      </div>
    </form>
  );
}

/** Papka bo'yicha brigada ish haqi, 1 dona. */
export function GroupWageForm({ groupId, name, value }: { groupId: string; name: string; value: number | null }) {
  const [state, action, pending] = useActionState(saveGroupWageAction, undefined);
  return (
    <form action={action} className="flex items-center justify-between gap-2 text-sm">
      <input type="hidden" name="groupId" value={groupId} />
      <span className="min-w-0 text-slate-600">{name}: ish haqi 1 donaga</span>
      <span className="flex items-center gap-1.5">
        <Input name="pieceRate" inputMode="numeric" defaultValue={value != null ? String(value) : ""} placeholder="0" className="h-8 w-28 bg-amber-50 text-right tabular" />
        <Button size="sm" variant="secondary" disabled={pending} title="Saqlash"><Save size={14} /></Button>
      </span>
      {state?.error && <span className="text-[13px] text-red-600">{state.error}</span>}
    </form>
  );
}

/** Kassa kategoriyasi: tannarxga kiradimi (ishlab chiqarish xarajati). */
export function CostCategoryToggle({ id, name, on, sub }: { id: string; name: string; on: boolean; sub?: boolean }) {
  const [state, action, pending] = useActionState(toggleCostCategoryAction, undefined);
  return (
    <form action={action} className={sub ? "pl-5" : undefined}>
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-slate-50">
        <span className={on ? "flex h-4 w-4 items-center justify-center rounded border border-emerald-600 bg-emerald-600 text-white" : "h-4 w-4 rounded border border-slate-300 bg-white"}>{on && <Check size={12} strokeWidth={3} />}</span>
        <span className={sub ? "text-slate-500" : "text-slate-700"}>{name}</span>
      </button>
      {state?.error && <span className="text-[13px] text-red-600">{state.error}</span>}
    </form>
  );
}
