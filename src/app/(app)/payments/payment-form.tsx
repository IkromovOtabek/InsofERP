"use client";

import { fmtNum, isoDate } from "@/lib/format";

import { useActionState, useEffect, useState } from "react";
import { createPayment, linkPayment } from "./actions";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";

export type InvOpt = { id: string; invoiceNo: string; customerId: string; remaining: number; date: string };
/** Avans qabul qilinadigan zayavka: schyoti hali yo'q. `expected` — sotuvchi yozgan kutilayotgan avans. */
export type OrderOpt = { id: string; orderNo: string; customerId: string; total: number; paid: number; expected: number };
type Opt = { id: string; name: string };

export function PaymentForm({ customers, invoices, orders, accounts }: { customers: Opt[]; invoices: InvOpt[]; orders: OrderOpt[]; accounts: Opt[] }) {
  const [state, action, pending] = useActionState(createPayment, undefined);
  // Saqlangandan keyin maydonlar qayta mount qilinadi — summa, sana, izoh to'liq tozalanadi
  const [formKey, setFormKey] = useState(0);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [orderId, setOrderId] = useState("");
  useEffect(() => { if (state?.ok) { setFormKey((k) => k + 1); setCustomerId(""); setAmount(""); setInvoiceId(""); setOrderId(""); } }, [state]);
  // Eng eski schyot birinchi (FIFO) — kassir odatda shundan yopadi
  const custInvoices = invoices.filter((i) => i.customerId === customerId);
  const custOrders = orders.filter((o) => o.customerId === customerId);
  const fmt = (n: number) => fmtNum(n);

  const pickInvoice = (id: string) => {
    setInvoiceId(id); if (id) setOrderId("");
    const i = custInvoices.find((x) => x.id === id);
    if (i) setAmount(String(i.remaining));
  };
  const pickOrder = (id: string) => {
    setOrderId(id); if (id) setInvoiceId("");
    const o = custOrders.find((x) => x.id === id);
    // Sotuvchi kutilayotgan avansni yozgan bo'lsa — shu (olinganidan tashqari), aks holda zayavka qoldig'i
    if (o) setAmount(String(Math.max(0, Math.round(((o.expected > o.paid ? o.expected : o.total) - o.paid) * 100) / 100)));
  };

  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      {state?.ok && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">To&apos;lov qayd etildi</div>}
      <div key={formKey} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mijoz *">
          <Select name="customerId" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setInvoiceId(""); setOrderId(""); }} required>
            <option value="" disabled>Tanlang…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Schyot" hint={custInvoices.length ? "Eng eski ochiq schyot birinchi" : "Ochiq schyot yo'q"}>
          <Select name="invoiceId" value={invoiceId} onChange={(e) => pickInvoice(e.target.value)}>
            <option value="">— schyotsiz —</option>
            {custInvoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNo} · {i.date} · qoldiq {fmt(i.remaining)}</option>)}
          </Select>
        </Field>
        <Field label="Zayavka (avans)" hint={invoiceId ? "Schyot tanlangan — avans kerak emas" : custOrders.length ? "Schyot yozilganda avans unga o'zi bog'lanadi" : "Schyoti yo'q ochiq zayavka yo'q"}>
          <Select name="orderId" value={invoiceId ? "" : orderId} onChange={(e) => pickOrder(e.target.value)} disabled={!!invoiceId || custOrders.length === 0}>
            <option value="">— zayavkasiz (taqsimlanmagan) —</option>
            {custOrders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNo} · {fmt(o.total)}{o.expected > 0 ? ` · avans kutilmoqda ${fmt(o.expected)}` : ""}{o.paid > 0 ? ` · olingan ${fmt(o.paid)}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kassa / hisob *"><Select name="cashAccountId" defaultValue={accounts[0]?.id}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Summa *"><MoneyInput name="amount" value={amount} onChange={setAmount} required /></Field>
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} max={isoDate()} required /></Field>
        <Field label="Izoh" className="sm:col-span-2"><Textarea name="note" className="min-h-11" placeholder="Platyojka №, kim topshirdi…" /></Field>
      </div>
      <Button disabled={pending}>{pending ? "Yozilmoqda…" : "To'lovni qayd etish"}</Button>
    </form>
  );
}

/**
 * Taqsimlanmagan to'lovni ochiq schyotga bog'lash. Tanlovda mijozning ochiq schyotlari eng eskisidan
 * (FIFO) — birinchisi tavsiya sifatida oldindan tanlangan. To'lov qoldiqdan katta bo'lsa ortgani taqsimlanmagan qoladi.
 */
export function LinkPaymentForm({ paymentId, invoices }: { paymentId: string; invoices: InvOpt[] }) {
  const [state, action, pending] = useActionState(linkPayment.bind(null, paymentId), undefined);
  const [open, setOpen] = useState(false);
  if (state?.ok) return <span className="text-xs text-emerald-700">{state.note ?? "Bog'landi"}</span>;
  if (!invoices.length) return <span className="text-xs text-slate-400">ochiq schyot yo&apos;q</span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-slate-700 underline hover:text-slate-900">Schyotga bog&apos;lash</button>;
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1.5">
        <select name="invoiceId" defaultValue={invoices[0].id} className="h-8 max-w-56 rounded-lg border border-slate-200 bg-white px-2 text-xs">
          {invoices.map((i, n) => <option key={i.id} value={i.id}>{n === 0 ? "★ " : ""}{i.invoiceNo} · {i.date} · qoldiq {fmtNum(i.remaining)}</option>)}
        </select>
        <Button className="h-8 px-2 text-xs" disabled={pending}>{pending ? "…" : "Bog'lash"}</Button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">yopish</button>
      </div>
      <span className="text-[11px] text-slate-500">★ — eng eski ochiq schyot (FIFO)</span>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
