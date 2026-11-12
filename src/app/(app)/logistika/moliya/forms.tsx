"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban, HandCoins, Plus } from "lucide-react";
import { addTx, cancelTx, payMonth } from "./actions";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";

export type SourceOpt = { id: string; label: string; group: string; type: string };
type Opt = { id: string; label: string };

/** Hisob tanlovi: «Logistika hisobi» va «Zavod hisobi» guruhlari bilan. */
function SourceSelect({ name, sources, defaultValue, required = true }: { name: string; sources: SourceOpt[]; defaultValue?: string; required?: boolean }) {
  const groups = [...new Set(sources.map((s) => s.group))];
  return (
    <Select name={name} required={required} defaultValue={defaultValue ?? sources[0]?.id}>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {sources.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

/**
 * Qo'lda kirim / chiqim. Chiqim — logistika hisobidan (kassaga tushmaydi) yoki zavod kassa/bankidan (kassada qisqa qator);
 * kirim — logistika hisobiga yoki zavod hisobiga; «Zavod hisobidan o'tkazma» — zavod hisobidan logistika hisobiga.
 */
export function TxForm({ sources, vehicles, drivers, expense, income, transfer, today }: {
  sources: SourceOpt[]; vehicles: Opt[]; drivers: Opt[]; expense: readonly string[]; income: readonly string[]; transfer: string; today: string;
}) {
  const [state, action, pending] = useActionState(addTx, undefined);
  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [category, setCategory] = useState<string>(expense[0] ?? "");
  const [token, setToken] = useState(() => crypto.randomUUID());
  // Saqlangach yangi kalit: maydonlar qayta mount bo'lib tozalanadi, ikkinchi yozuv dublikat bo'lmaydi
  useEffect(() => { if (state?.ok) setToken(crypto.randomUUID()); }, [state]);
  const isTransfer = type === "INCOME" && category === transfer;
  const logi = sources.filter((s) => s.group === "Logistika hisobi");
  const factory = sources.filter((s) => s.group === "Zavod hisobi");
  // Chiqim ko'pincha zavod naqd kassasidan — sukut shu
  const defaultSource = type === "EXPENSE" ? (factory.find((s) => s.type === "CASH") ?? sources[0])?.id : logi[0]?.id;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="clientToken" value={token} />
      <div className="flex gap-2">
        {(["EXPENSE", "INCOME"] as const).map((t) => (
          <Button key={t} type="button" size="sm" variant={type === t ? "primary" : "secondary"}
            onClick={() => { setType(t); setCategory(t === "EXPENSE" ? expense[0] ?? "" : income[0] ?? ""); }}>
            {t === "EXPENSE" ? "Chiqim" : "Kirim"}
          </Button>
        ))}
      </div>
      <div key={token} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Sana *"><Input type="date" name="date" defaultValue={today} max={today} required /></Field>
        <Field label="Summa *"><MoneyInput name="amount" required decimals={0} /></Field>
        <Field label="Toifa *">
          <Select name="category" value={category} onChange={(e) => setCategory(e.target.value)} required>
            {(type === "EXPENSE" ? expense : income).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        {isTransfer ? (
          <>
            <Field label="Qaysi zavod hisobidan *"><SourceSelect key="from" name="fromCashAccountId" sources={factory} defaultValue={(factory.find((s) => s.type === "CASH") ?? factory[0])?.id} /></Field>
            <Field label="Qaysi logistika hisobiga *"><SourceSelect key="to" name="source" sources={logi} /></Field>
          </>
        ) : (
          <Field label={type === "EXPENSE" ? "Qaysi hisobdan *" : "Pul qaysi hisobga tushdi *"}
            hint={type === "EXPENSE" ? "Logistika hisobidan — kassaga tushmaydi; zavod hisobidan — kassada qisqa qator" : undefined}>
            <SourceSelect key={type} name="source" sources={sources} defaultValue={defaultSource} />
          </Field>
        )}
        <Field label="Mashina" hint={type === "EXPENSE" ? "Ta'mir, zapchast, yo'l xarajati Foydaga ham tushadi" : undefined}>
          <Select name="vehicleId" defaultValue=""><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select>
        </Field>
        <Field label="Haydovchi">
          <Select name="driverId" defaultValue=""><option value="">—</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</Select>
        </Field>
        <Field label={type === "EXPENSE" ? "Kimga" : "Kimdan"}><Input name="counterparty" placeholder="Usta, zapravka, mijoz…" /></Field>
        <Field label="Izoh"><Input name="note" placeholder="Ixtiyoriy" /></Field>
      </div>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Yozildi"} />}
      <Button disabled={pending || !sources.length}><Plus size={16} /> {pending ? "Yozilmoqda…" : type === "EXPENSE" ? "Chiqimni yozish" : isTransfer ? "O'tkazish" : "Kirimni yozish"}</Button>
    </form>
  );
}

/** Jurnal qatorini bekor qilish (sababi bilan). */
export function CancelTx({ id, docNo }: { id: string; docNo: string }) {
  const [state, action, pending] = useActionState(cancelTx.bind(null, id), undefined);
  const [open, setOpen] = useState(false);
  if (state?.ok) return <span className="text-xs text-emerald-700">Bekor qilindi</span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-red-700 hover:underline" aria-label={`${docNo} ni bekor qilish`}><Ban size={13} className="inline" /> Bekor</button>;
  return (
    <form action={action} className="flex min-w-56 flex-col gap-1.5">
      <Input name="reason" placeholder="Sabab" required className="h-8" />
      <FormError error={state?.error} />
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>Qaytish</Button>
        <Button size="sm" variant="danger" disabled={pending}>{pending ? "…" : "Bekor qilish"}</Button>
      </div>
    </form>
  );
}

/** Haydovchining oylik reys haqini zavod yoki logistika hisobidan to'lash (to'lansa — zavod vedomostiga tushmaydi). */
export function MonthPayForm({ month, driverId, amount, sources }: { month: string; driverId: string; amount: string; sources: SourceOpt[] }) {
  const [state, action, pending] = useActionState(payMonth.bind(null, month, driverId), undefined);
  if (state?.ok) return <FormSuccess text={state.note ?? "To'landi"} />;
  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <div className="min-w-60 flex-1"><SourceSelect name="source" sources={sources} /></div>
      <Button size="sm" disabled={pending}><HandCoins size={14} /> {pending ? "…" : `${amount} to'lash`}</Button>
      <div className="w-full"><FormError error={state?.error} /></div>
    </form>
  );
}
