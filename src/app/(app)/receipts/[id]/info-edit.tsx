"use client";

import { startTransition, useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { Button, Field, FormActions, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { editReceiptInfo } from "../actions";

type Opt = { id: string; name: string };
export type ReceiptInfo = {
  waybillNo: string; address: string; purpose: string; carrier: string; loadedFrom: string; note: string;
  buyerId: string; recipientId: string;
};

/**
 * Kirim sahifasidagi «Rekvizitlar» kartasi: ko'rish (`children` — DL) yoki tahrirlash formasi.
 * Faqat qoldiq va pulga ta'sir qilmaydigan maydonlar (`lib/receipts.ts#updateReceiptInfo`); miqdor, narx, yetkazuvchi,
 * sklad, sana va to'lov — «Tuzatish» orqali. `defaultOpen` — jurnaldagi qalamchadan (`?tahrir=1`) kelganda.
 */
export function ReceiptInfoEdit({ id, values, buyers, recipients, defaultOpen = false, children }: {
  id: string; values: ReceiptInfo; buyers: Opt[]; recipients: Opt[]; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await editReceiptInfo(id, prev, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, undefined);

  if (!open) {
    return (
      <div>
        {children}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}><Pencil size={15} /> Rekvizitlarni tahrirlash</Button>
          <FormSuccess text={state?.ok ? state.note : undefined} />
        </div>
      </div>
    );
  }

  return (
    // <form action> emas: React 19 xato bilan qaytgan action'dan keyin formani reset qiladi — yozilganlar yo'qolardi
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (pending) return;
      const fd = new FormData(e.currentTarget);
      startTransition(() => action(fd));
    }}>
      <p className="text-sm text-slate-600">Bu yerda faqat sklad qoldig&apos;i va to&apos;lovga ta&apos;sir qilmaydigan maydonlar o&apos;zgaradi. Miqdor, narx, QQS, yetkazuvchi, sklad yoki sana xato bo&apos;lsa — «Tuzatish».</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nakladnoy (TTN)"><Input name="waybillNo" defaultValue={values.waybillNo} maxLength={60} autoComplete="off" placeholder="Nakladnoy №" /></Field>
        <Field label="Manzil"><Input name="address" defaultValue={values.address} maxLength={300} autoComplete="off" placeholder="Yetkazilgan manzil" /></Field>
        <Field label="Qayerdan yuklandi"><Input name="loadedFrom" defaultValue={values.loadedFrom} maxLength={300} autoComplete="off" placeholder="Zavod, bozor, sklad…" /></Field>
        <Field label="Mashina (kim olib keldi)"><Input name="carrier" defaultValue={values.carrier} maxLength={120} autoComplete="off" placeholder="Ta'minotchi o'zi / mashina raqami" /></Field>
        <Field label="Snabjenets" hint="Bo'sh — kirimni kiritgan xodim">
          <Select name="buyerId" defaultValue={values.buyerId}>
            <option value="">— kiritgan xodim —</option>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Kimga (jurnal yozuvi)" hint="Faqat yozuv: qoldiq va chiqimga ta'sir qilmaydi">
          <Select name="recipientId" defaultValue={values.recipientId}>
            <option value="">— sklad —</option>
            {recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
        <Field label="Nima uchun (maqsad)" className="sm:col-span-2"><Input name="purpose" defaultValue={values.purpose} maxLength={300} autoComplete="off" placeholder="Nima uchun sotib olindi" /></Field>
        <Field label="Izoh" className="sm:col-span-2"><Textarea name="note" defaultValue={values.note} maxLength={1000} rows={3} placeholder="Holati, qo'shimcha ma'lumot…" /></Field>
      </div>
      <FormError error={state?.error} />
      <FormActions>
        <Button type="submit" disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Bekor qilish</Button>
      </FormActions>
    </form>
  );
}
