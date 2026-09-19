"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { isoDate } from "@/lib/format";
import { createCashTx } from "./actions";
import { Button, Field, FormError, FormSuccess, Input, Select, FormActions } from "@/components/ui";
import { cn } from "@/lib/utils";

type Opt = { id: string; name: string };

export function TxForm({ accounts, suppliers, incomeCats, expenseCats }: { accounts: Opt[]; suppliers: Opt[]; incomeCats: string[]; expenseCats: string[] }) {
  const [state, action, pending] = useActionState(createCashTx, undefined);
  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  const cats = type === "INCOME" ? incomeCats : expenseCats;

  return (
    <form ref={ref} action={action} className="space-y-4">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text="Saqlandi" />}
      <input type="hidden" name="type" value={type} />
      <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
        <button type="button" onClick={() => setType("INCOME")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition", type === "INCOME" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100")}><ArrowDownLeft size={14} /> Kirim</button>
        <button type="button" onClick={() => setType("EXPENSE")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition", type === "EXPENSE" ? "bg-red-600 text-white" : "text-slate-600 hover:bg-slate-100")}><ArrowUpRight size={14} /> Chiqim</button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
        <Field label="Kassa / hisob *"><Select name="cashAccountId" defaultValue={accounts[0]?.id ?? ""} required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Summa (so'm) *"><Input name="amount" type="number" step="1" min="1" required /></Field>
        <Field label="Kategoriya *"><Select name="category" defaultValue={cats[0]} key={type}>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
        {type === "EXPENSE" ? (
          <Field label="Yetkazuvchi" hint="Xomashyo uchun"><Select name="supplierId" defaultValue=""><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        ) : <div />}
        <Field label={type === "INCOME" ? "Kimdan" : "Kimga"}><Input name="counterparty" placeholder="Nomi / F.I.O." /></Field>
        <Field label="Izoh" className="sm:col-span-3"><Input name="note" placeholder="Nima uchun" /></Field>
      </div>
      <FormActions><Button disabled={pending} className={type === "INCOME" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}>{pending ? "Saqlanmoqda…" : type === "INCOME" ? "Kirimni saqlash" : "Chiqimni saqlash"}</Button></FormActions>
    </form>
  );
}
