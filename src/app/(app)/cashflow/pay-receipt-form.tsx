"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { payReceipt } from "./actions";

type Opt = { id: string; name: string; type: "CASH" | "BANK" };

/** "To'lanmagan kirimlar" qatoridagi to'lash formasi — xato (masalan, kassada pul yetmaydi) shu yerda ko'rinadi. */
export function PayReceiptForm({ receiptId, accounts }: { receiptId: string; accounts: Opt[] }) {
  const [state, action, pending] = useActionState(payReceipt.bind(null, receiptId), undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        <select name="cashAccountId" required defaultValue="" className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm">
          <option value="" disabled>Hisob…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === "CASH" ? "naqd" : "bank"})</option>)}
        </select>
        <Button className="h-8 text-sm" disabled={pending}>{pending ? "…" : "To'lash"}</Button>
      </div>
      {state?.error && <span className="max-w-72 text-right text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
