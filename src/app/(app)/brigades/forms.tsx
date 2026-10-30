"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, UserMinus } from "lucide-react";
import { Button, FormError, Input, Select } from "@/components/ui";
import { assignStaff } from "../dashboard/production-actions";
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

/** Brigadaga xodim qo'shish: tanlansa darhol biriktiriladi (boshqa brigadada bo'lsa — shu brigadaga o'tadi). */
export function AddMemberSelect({ brigadeId, employees }: { brigadeId: string; employees: { id: string; label: string }[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Select value="" disabled={pending || !employees.length} aria-label="Xodim qo'shish" className={pending ? "opacity-60" : ""}
        onChange={(e) => { const id = e.target.value; if (!id) return; setError(null); start(async () => { const r = await assignStaff(id, brigadeId); if (r?.error) setError(r.error); }); }}>
        <option value="">{pending ? "Qo'shilmoqda…" : "+ Xodim qo'shish"}</option>
        {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
      </Select>
      <FormError error={error ?? undefined} />
    </div>
  );
}

/** Xodimni brigadadan chiqarish (brigadasiz qoladi; lavozimi sexga tegishli bo'lsa — «Taqsimlanmagan»da ko'rinadi). */
export function RemoveMemberButton({ employeeId, name, brigade }: { employeeId: string; name: string; brigade: string }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant="secondary" disabled={pending} aria-label={`${name} — brigadadan chiqarish`} title="Brigadadan chiqarish"
      className="shrink-0 text-red-600 hover:text-red-700"
      onClick={() => {
        if (!window.confirm(`${name} «${brigade}» brigadasidan chiqarilsinmi?`)) return;
        start(async () => { const r = await assignStaff(employeeId, ""); if (r?.error) alert(r.error); });
      }}>
      <UserMinus size={14} /> {pending ? "…" : "Chiqarish"}
    </Button>
  );
}
