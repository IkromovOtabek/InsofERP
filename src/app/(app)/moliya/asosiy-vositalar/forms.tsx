"use client";

import { useActionState, useEffect, useRef } from "react";
import { Ban, LogOut, Plus } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { cancelAssetAction, createAssetAction, disposeAssetAction } from "./actions";

export const ASSET_GROUPS = ["Bino va yer", "Uskuna va jihozlar", "Transport", "Ofis jihozlari", "Boshqa"];

export type AssetPrefill = { name?: string; cost?: string; acquiredAt?: string; cashTxId?: string };
type TxOpt = { id: string; label: string };

/** Yangi asosiy vosita. Kassadagi «Asosiy vosita xaridi» yozuvidan ochilsa — summa va sana o'sha yozuvdan. */
export function AssetCreateForm({ prefill, txOptions, today }: { prefill?: AssetPrefill; txOptions: TxOpt[]; today: string }) {
  const [state, action, pending] = useActionState(createAssetAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3" key={prefill?.cashTxId ?? "new"}>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Nomi *" className="lg:col-span-2"><Input name="name" required maxLength={160} defaultValue={prefill?.name} placeholder="Masalan: Beton zavodi (BRU) — Begzod" /></Field>
        <Field label="Guruh *">
          <Select name="group" required defaultValue={ASSET_GROUPS[1]}>{ASSET_GROUPS.map((g) => <option key={g}>{g}</option>)}</Select>
        </Field>
        <Field label="Olingan / hisobga olingan sana *"><Input name="acquiredAt" type="date" required defaultValue={prefill?.acquiredAt ?? today} /></Field>
        <Field label="Qiymati *" hint="olingan narxi yoki bugungi baholangan qiymat"><MoneyInput name="cost" required defaultValue={prefill?.cost} /></Field>
        <Field label="Xizmat muddati, yil *" hint="amortizatsiya shu muddatga bo'linadi"><Input name="lifeYears" type="number" step="0.25" min="0.25" required defaultValue="10" /></Field>
      </div>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
        <Field label="Kassa yozuvi (ixtiyoriy)" hint="«Asosiy vosita xaridi» bilan yozilgan chiqim">
          <Select name="cashTxId" defaultValue={prefill?.cashTxId ?? ""}>
            <option value="">— bog'lanmagan (oldindan bor vosita) —</option>
            {txOptions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Izoh"><Input name="note" maxLength={300} /></Field>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Vosita qo'shildi" : undefined} />
      <Button disabled={pending}><Plus size={16} /> {pending ? "Saqlanmoqda…" : "Qo'shish"}</Button>
    </form>
  );
}

/** Qator amallari: hisobdan chiqarish (sotildi) va xato kartochkani bekor qilish. */
export function AssetRowActions({ id, today }: { id: string; today: string }) {
  const [ds, dispose, dp] = useActionState(disposeAssetAction, undefined);
  const [cs, cancel, cp] = useActionState(cancelAssetAction, undefined);
  return (
    <details className="text-left">
      <summary className="cursor-pointer select-none text-[13px] font-medium text-slate-500 hover:text-slate-900">Amallar</summary>
      <div className="mt-2 grid w-72 gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-(--shadow-pop)">
        <form action={dispose} className="grid gap-2">
          <input type="hidden" name="id" value={id} />
          <Field label="Hisobdan chiqarish sanasi"><Input name="date" type="date" defaultValue={today} required /></Field>
          <Input name="reason" placeholder="Sababi (sotildi, yaroqsiz…)" maxLength={200} />
          <FormError error={ds?.error} />
          <Button size="sm" variant="secondary" disabled={dp}><LogOut size={14} /> Chiqarish</Button>
        </form>
        <form action={cancel} className="grid gap-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="id" value={id} />
          <Input name="reason" placeholder="Bekor qilish sababi *" required maxLength={200} />
          <FormError error={cs?.error} />
          <Button size="sm" variant="danger" disabled={cp}><Ban size={14} /> Bekor qilish</Button>
        </form>
      </div>
    </details>
  );
}
