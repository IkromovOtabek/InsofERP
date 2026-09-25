"use client";

import { fmtNum, isoDate } from "@/lib/format";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPayment } from "./actions";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";

type Inv = { id: string; invoiceNo: string; customerId: string; remaining: number };
type Opt = { id: string; name: string };

export function PaymentForm({ customers, invoices, accounts }: { customers: Opt[]; invoices: Inv[]; accounts: Opt[] }) {
  const [state, action, pending] = useActionState(createPayment, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  useEffect(() => { if (state?.ok) { ref.current?.reset(); setCustomerId(""); setAmount(""); setInvoiceId(""); } }, [state]);
  const custInvoices = invoices.filter((i) => i.customerId === customerId);
  const fmt = (n: number) => fmtNum(n);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <FormError error={state?.error} />
      {state?.ok && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">To'lov qayd etildi</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mijoz *">
          <Select name="customerId" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setInvoiceId(""); }} required>
            <option value="" disabled>Tanlang…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Schyot" hint="Ko'rsatilmasa — avans sifatida yoziladi">
          <Select name="invoiceId" value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); const i = custInvoices.find((x) => x.id === e.target.value); if (i) setAmount(String(i.remaining)); }}>
            <option value="">— avans / schyotsiz —</option>
            {custInvoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNo} · qoldiq {fmt(i.remaining)}</option>)}
          </Select>
        </Field>
        <Field label="Kassa / hisob *"><Select name="cashAccountId" defaultValue={accounts[0]?.id}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Summa *"><MoneyInput name="amount" value={amount} onChange={setAmount} required /></Field>
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
        <Field label="Izoh"><Textarea name="note" className="min-h-11" placeholder="Platyojka №, kim topshirdi…" /></Field>
      </div>
      <Button disabled={pending}>{pending ? "Yozilmoqda…" : "To'lovni qayd etish"}</Button>
    </form>
  );
}
