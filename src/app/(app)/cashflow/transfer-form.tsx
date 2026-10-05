"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { isoDate } from "@/lib/format";
import { createTransferAction } from "./transfer-actions";
import { Button, Field, FormError, FormSuccess, Input, Select, FormActions } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";

type Acc = { id: string; name: string; type: "CASH" | "BANK"; balance: number };

/**
 * "O'tkazma" formasi: kassa → bank (inkassatsiya), bank → kassa (naqdlashtirish), kassa → kassa.
 * `clientToken` — bir martalik kalit: ikki marta bosilgan "Saqlash" ikkinchi o'tkazma ochmaydi; saqlangach yangilanadi.
 */
export function TransferForm({ accounts, clientToken }: { accounts: Acc[]; clientToken: string }) {
  const [state, action, pending] = useActionState(createTransferAction, undefined);
  const [token, setToken] = useState(clientToken);
  const [formKey, setFormKey] = useState(0);
  const firstCash = accounts.find((a) => a.type === "CASH") ?? accounts[0];
  const firstBank = accounts.find((a) => a.type === "BANK" && a.id !== firstCash?.id) ?? accounts.find((a) => a.id !== firstCash?.id);
  const [fromId, setFromId] = useState(firstCash?.id ?? "");
  const [toId, setToId] = useState(firstBank?.id ?? "");
  useEffect(() => { if (state?.ok) { setFormKey((k) => k + 1); setToken(crypto.randomUUID()); } }, [state]);
  const from = accounts.find((a) => a.id === fromId), to = accounts.find((a) => a.id === toId);
  // Komissiya standart: bank tomonidan (ikkalasi bank / ikkalasi naqd bo'lsa — manbadan)
  const feeDefault = useMemo(() => (from?.type === "BANK" ? from.id : to?.type === "BANK" ? to.id : from?.id ?? ""), [from, to]);
  const fmt = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ")} so'm`;

  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <input type="hidden" name="clientToken" value={token} />
      <div key={formKey} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
        <Field label="Qayerdan *" hint={from ? `qoldiq ${fmt(from.balance)}` : undefined}>
          <Select name="fromAccountId" value={fromId} onChange={(e) => { const v = e.target.value; setFromId(v); if (v === toId) setToId(accounts.find((a) => a.id !== v)?.id ?? ""); }} required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === "CASH" ? "naqd" : "bank"})</option>)}</Select>
        </Field>
        <Field label="Qayerga *" hint={to ? `qoldiq ${fmt(to.balance)}` : undefined}>
          <Select name="toAccountId" value={toId} onChange={(e) => setToId(e.target.value)} required>{accounts.filter((a) => a.id !== fromId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === "CASH" ? "naqd" : "bank"})</option>)}</Select>
        </Field>
        <Field label="Summa *"><MoneyInput name="amount" required /></Field>
        <Field label="Bank komissiyasi" hint="Bo'lsa — «Bank xizmati» chiqimi bo'lib yoziladi"><MoneyInput name="fee" /></Field>
        <Field label="Komissiya qaysi hisobdan">
          <Select name="feeAccountId" key={`${fromId}-${toId}`} defaultValue={feeDefault}>{[from, to].filter((a): a is Acc => !!a).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </Field>
        <Field label="Izoh" className="sm:col-span-3"><Input name="note" placeholder="Masalan: kunlik inkassatsiya, chek raqami" /></Field>
      </div>
      <FormActions><Button disabled={pending || !fromId || !toId || fromId === toId}><ArrowRightLeft size={14} className="mr-1.5 inline" />{pending ? "Saqlanmoqda…" : "O'tkazmani saqlash"}</Button></FormActions>
    </form>
  );
}
