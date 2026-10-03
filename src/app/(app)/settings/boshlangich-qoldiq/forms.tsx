"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, Save, Pencil, Banknote } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { createOpeningAction, paySupplierOpeningAction, updateOpeningAction } from "./actions";
import type { OpeningKind } from "@/generated/prisma";

type Opt = { id: string; label: string };

/** Ishora tanlovi matni: qaysi tomon kimga qarzdor. */
export const SIGN_LABELS: Record<Exclude<OpeningKind, "STOCK">, [string, string]> = {
  CUSTOMER: ["Mijoz bizga qarz (+)", "Mijoz avans bergan (−)"],
  SUPPLIER: ["Biz yetkazuvchiga qarzmiz (+)", "Biz avans berganmiz (−)"],
  CASH: ["Qoldiq (+)", "Bank overdrafti (−)"],
};

const ENTITY_LABEL: Record<OpeningKind, string> = { CUSTOMER: "Mijoz", SUPPLIER: "Yetkazuvchi", CASH: "Kassa / bank hisobi", STOCK: "Mahsulot" };

/** Qo'lda bitta boshlang'ich qoldiq kiritish. */
export function OpeningCreateForm({ kind, entities, warehouses, defaultDate }: { kind: OpeningKind; entities: Opt[]; warehouses: Opt[]; defaultDate: string }) {
  const [state, action, pending] = useActionState(createOpeningAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Sana holatiga *" hint="tizimga o'tish sanasi"><Input name="date" type="date" defaultValue={defaultDate} required /></Field>
        <Field label={`${ENTITY_LABEL[kind]} *`} hint={entities.length ? undefined : "hammasiga qoldiq kiritilgan"}>
          <Select name="entityId" required defaultValue="">
            <option value="" disabled>— tanlang —</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </Select>
        </Field>
        {kind === "STOCK" ? (
          <>
            <Field label="Sklad *">
              <Select name="warehouseId" required defaultValue={warehouses[0]?.id ?? ""}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </Select>
            </Field>
            <Field label="Miqdor *"><Input name="qty" inputMode="decimal" required placeholder="0" /></Field>
            <Field label="Birlik tannarxi" hint="ombor qiymati uchun"><MoneyInput name="unitCost" decimals={2} /></Field>
          </>
        ) : (
          <>
            <Field label="Yo'nalish">
              <Select name="sign" defaultValue="1">
                <option value="1">{SIGN_LABELS[kind][0]}</option>
                <option value="-1">{SIGN_LABELS[kind][1]}</option>
              </Select>
            </Field>
            <Field label="Summa *"><MoneyInput name="amount" required decimals={2} /></Field>
          </>
        )}
        <Field label="Izoh" className={kind === "STOCK" ? "" : "lg:col-span-2"}><Input name="note" placeholder="masalan: 1C dagi akt sverka bo'yicha" /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !entities.length}><Plus size={16} /> {pending ? "Saqlanmoqda…" : "Qoldiqni saqlash"}</Button>
        <FormError error={state?.error} />
        {state?.ok && <FormSuccess text={state.note} />}
      </div>
    </form>
  );
}

/** Direktor uchun: qatorni tahrirlash (summa/miqdor, sana, izoh). */
export function OpeningEditForm({ id, kind, date, amount, qty, unitCost, note }: { id: string; kind: OpeningKind; date: string; amount: number; qty: number | null; unitCost: number | null; note: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateOpeningAction.bind(null, id), undefined);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"><Pencil size={14} /> Tahrir</button>
        {state?.ok && <span className="text-xs text-emerald-700">{state.note}</span>}
      </span>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
      <Input name="date" type="date" defaultValue={date} required className="h-8 w-36" />
      {kind === "STOCK" ? (
        <>
          <Input name="qty" defaultValue={String(qty ?? "")} inputMode="decimal" className="h-8 w-24" placeholder="miqdor" />
          <div className="w-36"><MoneyInput name="unitCost" decimals={2} defaultValue={unitCost == null ? "" : String(unitCost)} /></div>
        </>
      ) : (
        <>
          <Select name="sign" defaultValue={amount < 0 ? "-1" : "1"} className="h-8 w-48">
            <option value="1">{SIGN_LABELS[kind][0]}</option>
            <option value="-1">{SIGN_LABELS[kind][1]}</option>
          </Select>
          <div className="w-44"><MoneyInput name="amount" decimals={2} defaultValue={String(Math.abs(amount))} /></div>
        </>
      )}
      <Input name="note" defaultValue={note ?? ""} placeholder="izoh" className="h-8 w-44" />
      <Button size="sm" disabled={pending}><Save size={14} /> {pending ? "…" : "Saqlash"}</Button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">yopish</button>
      <FormError error={state?.error} />
    </form>
  );
}

/** Yetkazuvchiga boshlang'ich qarzni to'lash (qisman ham). */
export function SupplierPayForm({ id, left, accounts }: { id: string; left: number; accounts: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(paySupplierOpeningAction.bind(null, id), undefined);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50"><Banknote size={14} /> To&apos;lash</button>
        {state?.ok && <span className="text-xs text-emerald-700">{state.note}</span>}
      </span>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
      <Select name="cashAccountId" required defaultValue="" className="h-8 w-44">
        <option value="" disabled>— hisob —</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </Select>
      <div className="w-44"><MoneyInput name="amount" decimals={2} defaultValue={String(Math.max(0, left))} /></div>
      <Button size="sm" disabled={pending}>{pending ? "…" : "To'lash"}</Button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">yopish</button>
      <FormError error={state?.error} />
    </form>
  );
}
