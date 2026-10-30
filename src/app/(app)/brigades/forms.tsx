"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { Button, FormError, Input } from "@/components/ui";
import { saveDefectAmount } from "./actions";

/** Brak summasi — jadval katagida tahrirlanadi (brigada oyligidan shu summa ushlanadi). */
export function DefectAmountForm({ id, amount }: { id: string; amount: number }) {
  const [state, act, pending] = useActionState(saveDefectAmount.bind(null, id), undefined);
  return (
    <form action={act} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Input name="amount" type="number" min={0} step="1" defaultValue={amount} className="h-8 w-32 text-right tabular" aria-label="Brak summasi" />
        <Button size="sm" variant="secondary" disabled={pending} aria-label="Saqlash"><Check size={14} /></Button>
      </div>
      {state?.ok && !pending && <span className="text-[11px] text-emerald-700">saqlandi</span>}
      <FormError error={state?.error} />
    </form>
  );
}
