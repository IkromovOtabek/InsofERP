"use client";

import { useActionState, useState } from "react";
import { Check, CircleDollarSign, X } from "lucide-react";
import { decide, financeDecide } from "@/lib/supply-actions";
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Ta'minot zayavkasini tasdiqlash panellari. Ikki bo'limda ishlatiladi:
 * Zayavkalar oynasi (ma'sul xodim) va Kirim-Chiqim (moliya) — shuning uchun
 * route papkasida emas, umumiy `components/` da turadi.
 */

/* ═══════════ Ma'sul xodim: tasdiqlash / bekor qilish ═══════════ */

export function ApprovePanel({ id, total, compact }: { id: string; total: number; compact?: boolean }) {
  const [state, action, pending] = useActionState(decide.bind(null, id), undefined);
  const [reject, setReject] = useState(false);

  return (
    <form action={action} className="space-y-3">
      {!compact && <p className="text-sm text-slate-600">Tasdiqlansa zayavka <b>Moliya bo&apos;limiga (Kirim-Chiqim)</b> tushadi — u yerda pul ajratilguncha soat ikonkasi turadi.</p>}
      {reject ? (
        <Field label="Bekor qilish sababi *"><Textarea name="reason" rows={2} placeholder="Nega bekor qilinmoqda" required /></Field>
      ) : (
        <Field label="Izoh"><Input name="note" placeholder="Ixtiyoriy" autoComplete="off" /></Field>
      )}
      {compact && <p className="text-xs text-slate-500">Tasdiqlansa — Moliya bo&apos;limiga (Kirim-Chiqim) tushadi.</p>}
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Bajarildi"} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-slate-500">Jami summa: <b className="text-slate-900">{money(total)}</b></span>
        <div className="flex flex-wrap gap-2">
          {reject ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setReject(false)}>Qaytish</Button>
              <Button name="mode" value="reject" variant="danger" disabled={pending}><X size={16} /> Bekor qilish</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => setReject(true)}><X size={16} /> Bekor qilish</Button>
              <Button name="mode" value="approve" variant="success" disabled={pending}><Check size={16} /> {pending ? "Yuborilmoqda…" : "Tasdiqlash"}</Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}

/* ═══════════ Moliya: pul ajratish ═══════════ */

export function FundPanel({ id, total, accounts, compact }: { id: string; total: number; accounts: { id: string; name: string; type: string }[]; compact?: boolean }) {
  const [state, action, pending] = useActionState(financeDecide.bind(null, id), undefined);
  const [reject, setReject] = useState(false);

  return (
    <form action={action} className={cn("space-y-3", compact && "space-y-2")}>
      {!compact && <p className="text-sm text-slate-600">Tasdiqlansa summa <b>Kirim-Chiqimga chiqim</b> bo&apos;lib yoziladi va snabjeniye sotib olishi mumkin. Mol kelganda fakt summa bo&apos;yicha tuzatiladi.</p>}
      <div className={cn("grid grid-cols-1 gap-3", !compact && "sm:grid-cols-2")}>
        <Field label="Qaysi hisobdan to'lanadi *">
          <Select name="cashAccountId" defaultValue={accounts.find((a) => a.type === "BANK")?.id ?? accounts[0]?.id}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === "CASH" ? " (naqd)" : " (o'tkazma)"}</option>)}
          </Select>
        </Field>
        {reject
          ? <Field label="Bekor qilish sababi *"><Input name="reason" placeholder="Nega to'lanmaydi" required autoComplete="off" /></Field>
          : <Field label="Izoh"><Input name="note" placeholder="Ixtiyoriy" autoComplete="off" /></Field>}
      </div>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Bajarildi"} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-slate-500">Ajratiladigan summa: <b className="text-slate-900">{money(total)}</b></span>
        <div className="flex flex-wrap gap-2">
          {reject ? (
            <>
              <Button type="button" variant="secondary" size={compact ? "sm" : "md"} onClick={() => setReject(false)}>Qaytish</Button>
              <Button name="mode" value="reject" variant="danger" size={compact ? "sm" : "md"} disabled={pending}><X size={16} /> Bekor qilish</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" size={compact ? "sm" : "md"} onClick={() => setReject(true)}><X size={16} /> Bekor qilish</Button>
              <Button name="mode" value="fund" variant="success" size={compact ? "sm" : "md"} disabled={pending}><CircleDollarSign size={16} /> {pending ? "Yozilmoqda…" : "Tasdiqlash — pul ajratish"}</Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
