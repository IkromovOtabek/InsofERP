"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Undo2 } from "lucide-react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import type { ActionState } from "@/lib/action";
import { useRoleDenied, Modal } from "../../_monitor/action-dialog";
import { addPaymentAction, cancelPaymentAction, saveBillingSettingsAction } from "./billing-actions";

const METHODS: [string, string][] = [["otkazma", "Bank o'tkazmasi"], ["naqd", "Naqd"], ["karta", "Karta"]];
const MONTHS = [1, 3, 6, 12];

/**
 * To'lov qo'shish: summa oylik narx × oy bo'yicha taklif qilinadi (qo'lda o'zgartirsa bo'ladi).
 * `onSubmit` + transition (forma `action` emas): React formani avtomatik tozalaganda tanlangan oy va summa
 * bir-biridan ajralib qolmasin — muvaffaqiyatdan keyin ikkalasi birga boshlang'ich holatga qaytadi.
 */
export function PaymentForm({ slug, monthlyFee, today, preview }: { slug: string; monthlyFee: number | null; today: string; preview: Record<number, string> }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>();
  const [pending, start] = useTransition();
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState(monthlyFee ? String(monthlyFee) : "");
  const [paidAt, setPaidAt] = useState(today);
  const [method, setMethod] = useState("otkazma");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const pickMonths = (m: number) => { setMonths(m); if (!touched && monthlyFee) setAmount(String(monthlyFee * m)); };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData();
    for (const [k, v] of Object.entries({ months: String(months), amount, paidAt, method, note })) fd.append(k, v);
    start(async () => {
      const r = await addPaymentAction(slug, undefined, fd);
      setState(r);
      if (r?.ok) {
        setMonths(1); setAmount(monthlyFee ? String(monthlyFee) : ""); setPaidAt(today); setMethod("otkazma"); setNote(""); setTouched(false);
        router.refresh();
      }
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Necha oyga" hint={preview[months] ? `Qoplaydi: ${preview[months]}` : undefined}>
        <Select value={months} onChange={(e) => pickMonths(Number(e.target.value))}>
          {MONTHS.map((m) => <option key={m} value={m}>{m} oy</option>)}
        </Select>
      </Field>
      <Field label="Summa, so'm" hint={amount && Number(amount) > 0 ? fmtNum(Number(amount)) + " so'm" : monthlyFee ? undefined : "Oylik narx belgilanmagan"}>
        <Input inputMode="numeric" value={amount} onChange={(e) => { setTouched(true); setAmount(e.target.value.replace(/[^\d.]/g, "")); }} required />
      </Field>
      <Field label="To'lov sanasi"><Input type="date" value={paidAt} max={today} onChange={(e) => setPaidAt(e.target.value)} required /></Field>
      <Field label="Usul"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field label="Izoh" className="sm:col-span-2 lg:col-span-3"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Hisob-faktura №, to'lovchi…" /></Field>
      <div className="flex items-end">
        <Button disabled={pending} className="w-full"><Plus size={16} aria-hidden /> {pending ? "Yozilmoqda…" : "To'lov qo'shish"}</Button>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        {state?.ok && <p role="status" className="text-sm text-emerald-700">{state.note}</p>}
        <FormError error={state?.error} />
      </div>
    </form>
  );
}

export function BillingSettingsForm({ slug, monthlyFee, graceDays, paidUntil }: { slug: string; monthlyFee: string; graceDays: number; paidUntil: string }) {
  const [state, action, pending] = useActionState(saveBillingSettingsAction.bind(null, slug), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <Field label="Oylik to'lov, so'm" hint="Bo'sh — narx belgilanmagan"><Input name="monthlyFee" inputMode="numeric" defaultValue={monthlyFee} /></Field>
      <Field label="Imtiyozli kunlar" hint="Muddat o'tgach shuncha kun ishlaydi"><Input name="graceDays" type="number" min={0} max={60} defaultValue={graceDays} required /></Field>
      <Field label="To'langan muddat (qo'lda)" hint="Bo'sh — muddatsiz, avtomat to'xtatmaydi"><Input name="paidUntil" type="date" defaultValue={paidUntil} /></Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button variant="secondary" disabled={pending}><Save size={16} aria-hidden /> Saqlash</Button>
        {state?.ok && <span role="status" className="text-sm text-emerald-700">{state.note}</span>}
        <FormError error={state?.error} />
      </div>
    </form>
  );
}

/** Oxirgi to'lovni storno qilish (sabab majburiy). Muddat to'lovdan oldingi holatga qaytadi. */
export function CancelPaymentButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const denied = useRoleDenied("OWNER");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const close = () => { setOpen(false); setReason(""); setErr(undefined); };
  if (denied) return null;
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}><Undo2 size={14} aria-hidden /> Storno</Button>
      <Modal open={open} onClose={close} title="To'lovni storno qilish">
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await cancelPaymentAction(slug, id, reason);
            if (r.error) { setErr(r.error); return; }
            close(); router.refresh();
          });
        }}>
          <p className="text-sm text-slate-600">To&apos;lov o&apos;chirilmaydi — «storno» deb belgilanadi, muddat to&apos;lovdan oldingi sanaga qaytadi. Jurnalga yoziladi.</p>
          <Field label="Sabab *"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required minLength={3} maxLength={500} /></Field>
          <FormError error={err} />
          <div className="sa-sheet-acts flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Bekor qilish</Button>
            <Button type="submit" variant="danger" disabled={pending || reason.trim().length < 3} data-autofocus>{pending ? "…" : "Storno"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
