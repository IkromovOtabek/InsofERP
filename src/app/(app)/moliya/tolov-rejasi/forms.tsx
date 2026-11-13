"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Ban, Check, Pause, Pencil, Play, Plus, Save, X } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { ConfirmButton } from "../../payments/confirm-button";
import {
  cancelRecurringAction, closePlannedAction, createPlannedAction, createRecurringAction, saveCashPlanSettingsAction, saveDailyFlagAction, saveSalesPlanAction,
  saveSupplierTermAction, toggleRecurringAction, updatePlannedAction, updateRecurringAction,
} from "./actions";

type Opt = { id: string; name: string };
export type CatOpt = { name: string; loan: boolean };

export function PlanSettingsForm({ days, factor, pct }: { days: number; factor: number; pct: number }) {
  const [state, action, pending] = useActionState(saveCashPlanSettingsAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
        <Field label="Ta'minotchiga odatiy to'lov muddati, kun" hint="tovar kelgandan keyin; ta'minotchida alohida berilmasa"><Input name="supplierPaymentDays" type="number" min={0} max={365} defaultValue={days} required /></Field>
        <Field label="Reja koeffitsiyenti" hint="1 — o'tgan 30 kundek; 1,2 — tushum 20% ko'p kutiladi"><Input name="cashPlanFactor" inputMode="decimal" defaultValue={String(factor).replace(".", ",")} required /></Field>
        <Field label="Divident: foydaning necha foizi, %" hint="o'tgan oy zavod sof foydasidan limit"><Input name="dividendPct" type="number" min={0} max={100} step="1" defaultValue={pct} required /></Field>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
      <Button size="sm" disabled={pending}><Save size={14} /> Saqlash</Button>
    </form>
  );
}

export function RecurringCreateForm({ cats, loans }: { cats: CatOpt[]; loans: Opt[] }) {
  const [state, action, pending] = useActionState(createRecurringAction, undefined);
  const [cat, setCat] = useState(cats[0]?.name ?? "");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  useEffect(() => { if (state?.ok) setCat(cats[0]?.name ?? ""); }, [state, cats]);
  const isLoan = cats.find((c) => c.name === cat)?.loan;
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Nomi *" className="lg:col-span-2"><Input name="name" required maxLength={120} placeholder="Oylik ish haqi (vedomost)" /></Field>
        <Field label="Kategoriya *"><Select name="category" value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c.name}>{c.name}</option>)}</Select></Field>
        <Field label="Oyning kuni *" hint="31 — oyning oxirgi kuni"><Input name="dayOfMonth" type="number" min={1} max={31} required defaultValue={10} /></Field>
        <Field label="Summa *"><MoneyInput name="amount" required /></Field>
        {isLoan ? (
          <Field label="Kredit"><Select name="loanId" defaultValue=""><option value="">—</option>{loans.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        ) : <Field label="Izoh"><Input name="note" maxLength={200} /></Field>}
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Doimiy to'lov qo'shildi" : undefined} />
      <Button disabled={pending}><Plus size={16} /> Qo&apos;shish</Button>
    </form>
  );
}

const EDIT_SUMMARY = "inline-flex cursor-pointer select-none items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-slate-500 hover:bg-slate-100";
const EDIT_PANEL = "mt-2 grid w-72 gap-2 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-(--shadow-pop)";

export type RecurringEdit = { id: string; name: string; category: string; dayOfMonth: number; amount: number; loanId: string | null; note: string | null };

/** Doimiy to'lov tahriri — qatordagi «Tahrir» ichida (nomi, kategoriya, kuni, summa, kredit, izoh). */
export function RecurringEditForm({ r, cats, loans }: { r: RecurringEdit; cats: CatOpt[]; loans: Opt[] }) {
  const [state, action, pending] = useActionState(updateRecurringAction, undefined);
  const [cat, setCat] = useState(r.category);
  // Nofaol bo'lib qolgan kategoriya / yopilgan kredit ham tanlovda tursin — saqlaganda jim almashib ketmasin
  const catList = cats.some((c) => c.name === r.category) ? cats : [{ name: r.category, loan: false }, ...cats];
  const loanList = !r.loanId || loans.some((l) => l.id === r.loanId) ? loans : [{ id: r.loanId, name: "Joriy kredit (yopilgan)" }, ...loans];
  const isLoan = catList.find((c) => c.name === cat)?.loan;
  return (
    <details className="text-left">
      <summary className={EDIT_SUMMARY} title="Tahrirlash"><Pencil size={13} /> Tahrir</summary>
      <form action={action} className={EDIT_PANEL}>
        <input type="hidden" name="id" value={r.id} />
        <Field label="Nomi *"><Input name="name" defaultValue={r.name} required maxLength={120} /></Field>
        <Field label="Kategoriya *"><Select name="category" value={cat} onChange={(e) => setCat(e.target.value)}>{catList.map((c) => <option key={c.name}>{c.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Oyning kuni *"><Input name="dayOfMonth" type="number" min={1} max={31} required defaultValue={r.dayOfMonth} /></Field>
          <Field label="Summa *"><MoneyInput name="amount" defaultValue={String(r.amount)} required /></Field>
        </div>
        {isLoan && <Field label="Kredit"><Select name="loanId" defaultValue={r.loanId ?? ""}><option value="">—</option>{loanList.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
        <Field label="Izoh"><Input name="note" defaultValue={r.note ?? ""} maxLength={200} /></Field>
        <FormError error={state?.error} />
        <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
        <Button size="sm" disabled={pending}><Save size={14} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
      </form>
    </details>
  );
}

export function RecurringRowActions({ id, active }: { id: string; active: boolean }) {
  const [ts, toggle, tp] = useActionState(toggleRecurringAction, undefined);
  const [cs, cancel, cp] = useActionState(cancelRecurringAction, undefined);
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <form action={toggle}>
        <input type="hidden" name="id" value={id} />
        <Button size="sm" variant="ghost" disabled={tp} title={active ? "Vaqtincha to'xtatish" : "Qayta yoqish"}>{active ? <Pause size={14} /> : <Play size={14} />}</Button>
      </form>
      <details>
        <summary className="cursor-pointer select-none rounded-lg px-2 py-1 text-[13px] font-medium text-slate-500 hover:bg-slate-100">Bekor</summary>
        <form action={cancel} className="mt-2 grid w-60 gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-(--shadow-pop)">
          <input type="hidden" name="id" value={id} />
          <Input name="reason" placeholder="Sababi *" required maxLength={200} />
          <FormError error={cs?.error} />
          <Button size="sm" variant="danger" disabled={cp}><Ban size={14} /> Bekor qilish</Button>
        </form>
      </details>
      {ts?.error && <span className="text-[13px] text-red-600">{ts.error}</span>}
    </div>
  );
}

export function PlannedCreateForm({ today, cats }: { today: string; cats: string[] }) {
  const [state, action, pending] = useActionState(createPlannedAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Turi *"><Select name="type" defaultValue="EXPENSE"><option value="EXPENSE">To&apos;lov (chiqim)</option><option value="INCOME">Kutilayotgan tushum</option></Select></Field>
        <Field label="Sana *"><Input name="date" type="date" defaultValue={today} required /></Field>
        <Field label="Summa *"><MoneyInput name="amount" required /></Field>
        <Field label="Kimga / kimdan *" className="lg:col-span-2"><Input name="counterparty" required maxLength={160} placeholder="Masalan: Soliq inspeksiyasi / M.F. qurilish" /></Field>
        <Field label="Kategoriya"><Select name="category" defaultValue=""><option value="">—</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      </div>
      <Field label="Izoh"><Input name="note" maxLength={200} placeholder="Nima uchun" /></Field>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Qo'shildi" : undefined} />
      <Button disabled={pending}><Plus size={16} /> Qo&apos;shish</Button>
    </form>
  );
}

export type PlannedEdit = { id: string; type: "INCOME" | "EXPENSE"; date: string; amount: number; counterparty: string; category: string | null; note: string | null };

/** Bir martalik to'lov / tushum tahriri — faqat ochiq (rejadagi) yozuvda; qatordagi «Tahrir» ichida. */
export function PlannedEditForm({ p, cats }: { p: PlannedEdit; cats: string[] }) {
  const [state, action, pending] = useActionState(updatePlannedAction, undefined);
  const catList = !p.category || cats.includes(p.category) ? cats : [p.category, ...cats];
  return (
    <details className="text-left">
      <summary className={EDIT_SUMMARY} title="Tahrirlash"><Pencil size={13} /> Tahrir</summary>
      <form action={action} className={EDIT_PANEL}>
        <input type="hidden" name="id" value={p.id} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Turi *"><Select name="type" defaultValue={p.type}><option value="EXPENSE">To&apos;lov (chiqim)</option><option value="INCOME">Kutilayotgan tushum</option></Select></Field>
          <Field label="Sana *"><Input name="date" type="date" defaultValue={p.date} required /></Field>
        </div>
        <Field label="Summa *"><MoneyInput name="amount" defaultValue={String(p.amount)} required /></Field>
        <Field label="Kimga / kimdan *"><Input name="counterparty" defaultValue={p.counterparty} required maxLength={160} /></Field>
        <Field label="Kategoriya"><Select name="category" defaultValue={p.category ?? ""}><option value="">—</option>{catList.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Izoh"><Input name="note" defaultValue={p.note ?? ""} maxLength={200} /></Field>
        <FormError error={state?.error} />
        <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
        <Button size="sm" disabled={pending}><Save size={14} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
      </form>
    </details>
  );
}

export function PlannedRowActions({ id }: { id: string }) {
  const [ds, done, dp] = useActionState(closePlannedAction, undefined);
  // Bekor qilish qaytarib bo'lmaydi (kalendardan chiqadi) — avval savol; sabab ixtiyoriy, AuditLog'ga yoziladi
  const cancel = (why: string) => {
    const fd = new FormData();
    fd.set("id", id); fd.set("status", "CANCELLED");
    if (why) fd.set("reason", why);
    return closePlannedAction(undefined, fd);
  };
  return (
    <div className="flex items-center justify-end gap-1">
      <form action={done}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="DONE" /><Button size="sm" variant="ghost" disabled={dp} title="Bajarildi"><Check size={14} /></Button></form>
      <ConfirmButton action={cancel} label="" title="Bekor qilish" icon={<X size={14} />} question="Bekor qilinsinmi? Yozuv kalendardan chiqadi." reason="optional" okText="Bekor qilindi" className="h-8 px-2 text-slate-500 hover:text-red-600" />
      {ds?.error && <span className="text-[13px] text-red-600">{ds.error}</span>}
    </div>
  );
}

export function SupplierTermForm({ supplierId, days, placeholder }: { supplierId: string; days: number | null; placeholder: number }) {
  const [state, action, pending] = useActionState(saveSupplierTermAction, undefined);
  return (
    <form action={action} className="flex items-center justify-end gap-1.5">
      <input type="hidden" name="supplierId" value={supplierId} />
      <Input name="days" type="number" min={0} max={365} defaultValue={days ?? ""} placeholder={String(placeholder)} className="h-8 w-20 text-right" aria-label="To'lov muddati, kun" />
      <Button size="sm" variant="secondary" disabled={pending} title="Saqlash"><Save size={14} /></Button>
      {state?.error && <span className="text-[13px] text-red-600">{state.error}</span>}
    </form>
  );
}

/** «Oylik reja» jadvalidagi sariq kataklar — har guruh uchun oyiga reja miqdori; bitta «Saqlash» bilan. */
export function SalesPlanForm({ id, children }: { id: string; children: React.ReactNode }) {
  const [state, action, pending] = useActionState(saveSalesPlanAction, undefined);
  return (
    <form id={id} action={action} className="space-y-2">
      {children}
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending}><Save size={14} /> Rejani saqlash</Button>
        <FormError error={state?.error} />
        <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
      </div>
    </form>
  );
}

/** Kundalik xarajat qatoridagi Ha / Yo'q almashtirgich. */
export function DailyFlagToggle({ line, field, on }: { line: string; field: "off" | "scaled"; on: boolean }) {
  const [state, action, pending] = useActionState(saveDailyFlagAction, undefined);
  // «Hisobga olinsinmi»: Ha = off yo'q
  const yes = field === "off" ? !on : on;
  return (
    <form action={action} className="inline-flex items-center gap-1">
      <input type="hidden" name="line" value={line} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={on ? "0" : "1"} />
      <button disabled={pending} title="O'zgartirish" className={yes ? "rounded-md bg-emerald-50 px-2 py-0.5 text-[13px] font-semibold text-emerald-700 hover:bg-emerald-100" : "rounded-md bg-slate-100 px-2 py-0.5 text-[13px] font-semibold text-slate-500 hover:bg-slate-200"}>
        {yes ? "Ha" : "Yo'q"}
      </button>
      {state?.error && <span className="text-[13px] text-red-600">{state.error}</span>}
    </form>
  );
}
