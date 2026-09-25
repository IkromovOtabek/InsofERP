"use client";

import { fmtNum, isoDate } from "@/lib/format";

import { useActionState, useState } from "react";
import { createInvoice } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Select, FormActions } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";

/** unit — zayavkadagi mahsulot birligi ("m³", "dona"…); aralash birlikda m³ olinadi. */
type Order = { id: string; orderNo: string; customer: string; deliveredM3: number; totalM3: number; deliveredSum: number; totalSum: number; unit: string };

export function InvoiceForm({ orders, preselect }: { orders: Order[]; preselect?: string }) {
  const [state, action, pending] = useActionState(createInvoice, undefined);
  const [orderId, setOrderId] = useState(preselect ?? orders[0]?.id ?? "");
  const o = orders.find((x) => x.id === orderId);
  const [amount, setAmount] = useState(o ? String(o.deliveredSum || o.totalSum) : "");
  const fmt = (n: number) => fmtNum(n);

  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Zayavka *">
        <Select name="orderId" value={orderId} onChange={(e) => { setOrderId(e.target.value); const x = orders.find((y) => y.id === e.target.value); if (x) setAmount(String(x.deliveredSum || x.totalSum)); }}>
          {orders.map((x) => <option key={x.id} value={x.id}>{x.orderNo} · {x.customer}</option>)}
        </Select>
      </Field>
      {o && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between"><span>Yetkazilgan</span><b>{o.deliveredM3} / {o.totalM3} {o.unit} — {fmt(o.deliveredSum)} so'm</b></div>
          <div className="flex justify-between"><span>Zayavka jami</span><b>{fmt(o.totalSum)} so'm</b></div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Summa *" hint="Yetkazilgan hajm bo'yicha taklif qilinadi"><MoneyInput name="amount" value={amount} onChange={setAmount} required /></Field>
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
      </div>
      <FormActions>
        <Button disabled={pending || !orders.length}>{pending ? "Yozilmoqda…" : "Schyot yozish"}</Button>
        <LinkButton href="/invoices" variant="secondary">Bekor</LinkButton>
      </FormActions>
      {!orders.length && <p className="text-sm text-amber-700">Schyot yozilmagan tasdiqlangan zayavka yo'q.</p>}
    </form>
  );
}
