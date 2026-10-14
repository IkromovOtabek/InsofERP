"use client";

import { useActionState, useState } from "react";
import { Ban, CheckCircle2, HandCoins, XCircle } from "lucide-react";
import { approve, cancel, pay, reject } from "./actions";
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";

/* ═══════════ Ish boshqaruvchi: tasdiqlash yoki rad etish ═══════════ */

export function DecidePanel({ id }: { id: string }) {
  const [okState, okAction, okPending] = useActionState(approve.bind(null, id), undefined);
  const [noState, noAction, noPending] = useActionState(reject.bind(null, id), undefined);
  const [rejecting, setRejecting] = useState(false);
  return (
    <div className="space-y-3">
      <form action={okAction}>
        <Button className="w-full" disabled={okPending || noPending}><CheckCircle2 size={16} /> {okPending ? "Tasdiqlanmoqda…" : "Tasdiqlash"}</Button>
      </form>
      <FormError error={okState?.error} />
      {okState?.ok && <FormSuccess text={okState.note ?? "Tasdiqlandi"} />}
      {!rejecting ? (
        <Button type="button" variant="secondary" className="w-full text-red-700" onClick={() => setRejecting(true)}><XCircle size={16} /> Rad etish</Button>
      ) : (
        <form action={noAction} className="space-y-3">
          <Field label="Rad etish sababi *"><Textarea name="reason" rows={2} placeholder="Nega rad etilmoqda" required /></Field>
          <FormError error={noState?.error} />
          {noState?.ok && <FormSuccess text={noState.note ?? "Rad etildi"} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRejecting(false)}>Qaytish</Button>
            <Button variant="danger" disabled={noPending}><XCircle size={16} /> {noPending ? "Yuborilmoqda…" : "Rad etish"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ═══════════ Kassa: pul berish ═══════════ */

export type PayAccount = { id: string; label: string };

export function PayPanel({ id, amount, accounts }: { id: string; amount: string; accounts: PayAccount[] }) {
  const [state, action, pending] = useActionState(pay.bind(null, id), undefined);
  return (
    <form action={action} className="space-y-3">
      <Field label="Qaysi kassadan *" hint={`${amount} shu hisobdan chiqim bo'lib yoziladi`}>
        <Select name="cashAccountId" required defaultValue={accounts[0]?.id}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
      </Field>
      <Field label="Izoh"><Input name="note" placeholder="Ixtiyoriy" /></Field>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Pul berildi"} />}
      <Button className="w-full" disabled={pending || !accounts.length}><HandCoins size={16} /> {pending ? "Yozilmoqda…" : "Pul berish"}</Button>
    </form>
  );
}

/* ═══════════ Mexanik: o'z so'rovini bekor qilish ═══════════ */

export function CancelPanel({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancel.bind(null, id), undefined);
  const [sure, setSure] = useState(false);
  if (!sure) return <Button type="button" variant="secondary" className="w-full text-red-700" onClick={() => setSure(true)}><Ban size={16} /> So&apos;rovni bekor qilish</Button>;
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-slate-600">So&apos;rov bekor qilinadi — ish boshqaruvchi va kassa uni ko&apos;rmaydi.</p>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Bekor qilindi"} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setSure(false)}>Qaytish</Button>
        <Button variant="danger" disabled={pending}><Ban size={16} /> {pending ? "Bekor qilinmoqda…" : "Bekor qilish"}</Button>
      </div>
    </form>
  );
}
