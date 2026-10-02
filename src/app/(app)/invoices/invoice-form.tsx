"use client";

import { fmtNum, isoDate } from "@/lib/format";

import { useActionState, useState } from "react";
import { createInvoice } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Select, FormActions } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";

/**
 * unit — zayavkadagi mahsulot birligi ("m³", "dona"…); aralash birlikda m³ olinadi.
 * deliveredSum — null: turli narxli ko'p mahsulotli zayavka, yetkazilgan summani aniqlab bo'lmaydi.
 */
type Order = { id: string; orderNo: string; customer: string; deliveredM3: number; totalM3: number; deliveredSum: number | null; totalSum: number; unit: string; mixed: boolean };

/** Taklif qilinadigan summa: yetkazilgani bo'lsa shu, aks holda zayavka jami. */
const suggest = (o: Order) => String(o.deliveredSum || o.totalSum);

export function InvoiceForm({ orders, preselect }: { orders: Order[]; preselect?: string }) {
  const [state, action, pending] = useActionState(createInvoice, undefined);
  const [orderId, setOrderId] = useState(preselect ?? orders[0]?.id ?? "");
  const o = orders.find((x) => x.id === orderId);
  const [amount, setAmount] = useState(o ? suggest(o) : "");
  const fmt = (n: number) => fmtNum(n);

  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Zayavka *">
        <Select name="orderId" value={orderId} onChange={(e) => { setOrderId(e.target.value); const x = orders.find((y) => y.id === e.target.value); if (x) setAmount(suggest(x)); }}>
          {orders.map((x) => <option key={x.id} value={x.id}>{x.orderNo} · {x.customer}</option>)}
        </Select>
      </Field>
      {o && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between gap-3"><span>Yetkazilgan</span><b className="text-right">{fmt(o.deliveredM3)} / {fmt(o.totalM3)} {o.unit}{o.deliveredSum != null && <> — {fmt(o.deliveredSum)} so&apos;m</>}</b></div>
          <div className="flex justify-between gap-3"><span>Zayavka jami</span><b>{fmt(o.totalSum)} so&apos;m</b></div>
          {o.mixed && <p className="mt-1 text-xs text-amber-700">Turli narxli mahsulotlar: reys qaysi mahsulotniki ekani yozilmaydi — summa zayavka jami bo&apos;yicha taklif qilindi, kerak bo&apos;lsa tuzating.</p>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Summa *" hint="Yetkazilgan hajm bo'yicha taklif qilinadi; zayavka summasidan oshmaydi"><MoneyInput name="amount" value={amount} onChange={setAmount} required /></Field>
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
