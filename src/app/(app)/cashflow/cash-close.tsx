"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { Button, FormError, FormSuccess, Input } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { fmtNum } from "@/lib/format";
import { closeCashAction } from "./close-actions";

export type CloseRow = { id: string; name: string; system: number; counted: number | null; diff: number | null; at: string | null };

/** Kassani yopish — har naqd kassa: tizimdagi qoldiq, bugungi sanoq va farq; kassir sanagan summani kiritadi. */
export function CashCloseRow({ row, canClose }: { row: CloseRow; canClose: boolean }) {
  const [state, action, pending] = useActionState(closeCashAction, undefined);
  return (
    <div className="grid grid-cols-1 items-end gap-3 border-t border-slate-100 py-3 first:border-t-0 md:grid-cols-[1fr_auto]">
      <div className="min-w-0 text-sm">
        <div className="font-semibold text-slate-900">{row.name}</div>
        <div className="text-slate-500">Tizimda: <b className="tabular text-slate-800">{fmtNum(row.system)}</b> so&apos;m
          {row.counted !== null && <> · bugun sanalgan <b className="tabular text-slate-800">{fmtNum(row.counted)}</b>{row.at ? ` (${row.at})` : ""} · farq <b className={`tabular ${Math.abs(row.diff ?? 0) >= 1 ? "text-red-600" : "text-emerald-700"}`}>{fmtNum(row.diff ?? 0)}</b></>}
          {row.counted === null && <> · <span className="font-medium text-amber-700">bugun yopilmagan</span></>}
        </div>
      </div>
      {canClose && (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="cashAccountId" value={row.id} />
          <MoneyInput name="counted" required placeholder="Sanalgan naqd" className="w-44" ariaLabel={`${row.name}: sanalgan naqd`} />
          <Input name="note" placeholder="Farq sababi" maxLength={200} className="w-48" />
          <Button size="sm" disabled={pending}><Lock size={14} /> {row.counted === null ? "Yopish" : "Qayta sanash"}</Button>
          <div className="w-full"><FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} /></div>
        </form>
      )}
    </div>
  );
}
