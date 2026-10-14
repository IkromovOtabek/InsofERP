"use client";

import { useActionState, useEffect, useState } from "react";
import { Banknote, Landmark } from "lucide-react";
import { fmtNum, isoDate } from "@/lib/format";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { receiveRequest } from "./actions";

type Account = { id: string; name: string };

/**
 * So'rov bo'yicha pulni qabul qilish formasi (jadval qatori ostida).
 * Summa sukut bo'yicha — qolgan bosh to'lov; qisman qabul ham mumkin (so'rov «Qisman tushdi» bo'lib qoladi).
 * Ikki marta bosilmasin: yozilayotganda tugma o'chadi, server esa 60 s ichidagi bir xil to'lovni dublikat deb rad etadi.
 */
export function ReceiveForm({ requestId, method, left, accounts }: { requestId: string; method: "CASH" | "BANK"; left: number; accounts: Account[] }) {
  const [state, action, pending] = useActionState(receiveRequest, undefined);
  const [amount, setAmount] = useState(String(left));
  // Qabuldan keyin sahifa yangilanadi — summa yangi qoldiqqa tenglashadi
  useEffect(() => { setAmount(String(left)); }, [left]);
  const cash = method === "CASH";

  if (!accounts.length) {
    return <FormError error={cash ? "Faol kassa (naqd) hisobi yo'q — Sozlamalarda kassa hisobini qo'shing" : "Faol bank hisobi yo'q — Sozlamalarda bank hisobini qo'shing"} />;
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={cash ? "Kassa *" : "Bank hisobi *"} hint={accounts.length === 1 ? "Yagona hisob — avtomatik tanlandi" : undefined}>
          <Select name="cashAccountId" defaultValue={accounts[0].id} required>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Summa *" hint={`Qolgan: ${fmtNum(left)} so'm · qisman qabul ham mumkin`}>
          <MoneyInput name="amount" value={amount} onChange={setAmount} required />
        </Field>
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} max={isoDate()} required /></Field>
        {cash ? (
          <Field label="Izoh"><Input name="note" placeholder="Kim olib keldi…" /></Field>
        ) : (
          <Field label="To'lov topshiriqnomasi №"><Input name="docRef" placeholder="Masalan 125" /></Field>
        )}
        {!cash && <Field label="Izoh" className="sm:col-span-2 lg:col-span-4"><Input name="note" placeholder="Bank, to'lovchi…" /></Field>}
      </div>
      <Button variant={cash ? "success" : "primary"} disabled={pending || !(Number(amount) > 0)}>
        {cash ? <Banknote size={16} /> : <Landmark size={16} />}
        {pending ? "Yozilmoqda…" : cash ? "Pulni qabul qildim" : "Bankka tushdi — tasdiqlash"}
      </Button>
    </form>
  );
}
