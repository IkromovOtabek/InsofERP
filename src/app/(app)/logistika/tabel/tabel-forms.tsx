"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Pencil } from "lucide-react";
import { priceSuggestedAction, priceTripAction, saveDriverTariff } from "../actions";
import { Button, Field, FormActions, FormError, FormSuccess, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action";

/** Bitta reysga narx: taklif oldindan yozilgan, dispetcher tasdiqlaydi yoki o'zgartiradi. Narxlangan reysni tuzatish — sabab bilan. */
export function PriceForm({ tripId, suggested, amount }: { tripId: string; suggested: number; amount: number | null }) {
  const [state, action, pending] = useActionState(priceTripAction.bind(null, tripId), undefined);
  const [edit, setEdit] = useState(amount == null);
  if (!edit) {
    return (
      <button type="button" onClick={() => setEdit(true)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
        <Pencil size={12} /> Tuzatish
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-1.5">
      <Input name="amount" type="number" min="0" step="1000" defaultValue={amount ?? suggested} className="h-8 w-28 text-right tabular" aria-label="Reys haqi" required />
      {amount != null && <Input name="note" placeholder="Sabab" className="h-8 w-32" required />}
      <Button size="sm" variant="success" disabled={pending} title="Narxni tasdiqlash"><Check size={14} /></Button>
      {state?.error && <div className="w-full text-right text-xs text-red-700">{state.error}</div>}
    </form>
  );
}

/** Ko'rinib turgan narxsiz reyslarning hammasiga taklif narxini qo'yish. */
export function PriceAllButton({ ids }: { ids: string[] }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionState>(undefined);
  return (
    <div className="flex items-center gap-2">
      {res?.error && <span className="text-xs text-red-700">{res.error}</span>}
      <Button size="sm" variant="secondary" disabled={pending || !ids.length}
        onClick={() => { if (confirm(`${ids.length} ta reysga tarif bo'yicha taklif narxi qo'yilsinmi?`)) start(async () => setRes(await priceSuggestedAction(ids))); }}>
        <Check size={14} /> Hammasiga taklifni qo'yish
      </Button>
    </div>
  );
}

export type TariffValue = { drvTripRate: number; drvKmRate: number; drvWaitHourRate: number };

export function TariffForm({ v }: { v: TariffValue }) {
  const [state, action, pending] = useActionState(saveDriverTariff, undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-3">
      <div className="sm:col-span-3"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Saqlandi — yangi reyslar taklifi shu tarif bilan" />}</div>
      <Field label="Har reys uchun, so'm" hint="Qat'iy summa (bo'lmasa 0)"><Input name="drvTripRate" type="number" min="0" step="1000" defaultValue={v.drvTripRate} required /></Field>
      <Field label="1 km uchun, so'm" hint="Zavod → obyekt → zavod"><Input name="drvKmRate" type="number" min="0" step="100" defaultValue={v.drvKmRate} required /></Field>
      <Field label="Mikser kutish, so'm / soat" hint="Obyektga kelgandan tushirish boshlanguncha"><Input name="drvWaitHourRate" type="number" min="0" step="1000" defaultValue={v.drvWaitHourRate} required /></Field>
      <div className="sm:col-span-3"><FormActions><Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Tarifni saqlash"}</Button></FormActions></div>
    </form>
  );
}
