"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban, HandCoins, Link2, Plus, Unlink } from "lucide-react";
import { addTx, cancelTx, linkCash, payMonth } from "./actions";
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

/** Jurnal qatorini bekor qilish (sababi bilan). Kassadan biriktirilgani (`unlink`) — bekor emas, logistikadan ajratiladi. */
export function CancelTx({ id, docNo, unlink = false }: { id: string; docNo: string; unlink?: boolean }) {
  const [state, action, pending] = useActionState(cancelTx.bind(null, id), undefined);
  const [open, setOpen] = useState(false);
  if (state?.ok) return <span className="text-xs text-emerald-700">{unlink ? "Ajratildi" : "Bekor qilindi"}</span>;
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="text-xs text-red-700 hover:underline" aria-label={`${docNo} ni ${unlink ? "ajratish" : "bekor qilish"}`}
      title={unlink ? "Logistikadan ajratish — kassa yozuvi o'z joyida qoladi" : undefined}>
      {unlink ? <Unlink size={13} className="inline" /> : <Ban size={13} className="inline" />} {unlink ? "Ajratish" : "Bekor"}
    </button>
  );
  return (
    <form action={action} className="flex min-w-56 flex-col gap-1.5">
      <Input name="reason" placeholder="Sabab" required className="h-8" />
      <FormError error={state?.error} />
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>Qaytish</Button>
        <Button size="sm" variant="danger" disabled={pending}>{pending ? "…" : unlink ? "Ajratish" : "Bekor qilish"}</Button>
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

export type LinkRow = {
  id: string; date: string; type: "INCOME" | "EXPENSE"; amount: string; account: string; source: string;
  counterparty: string | null; note: string | null; category: string; vehicleId: string | null;
};

/**
 * Zavod kassasida to'g'ridan yozilgan transport kirim/chiqimini logistikaga olish. Toifa va mashina taklif qilingan
 * (sub manba / izohdagi davlat raqamidan) — tekshirib, belgilab, bir tugma bilan. Kassa qoldig'i o'zgarmaydi.
 */
export function LinkCashForm({ rows, vehicles, drivers, expense, income }: {
  rows: LinkRow[]; vehicles: Opt[]; drivers: Opt[]; expense: readonly string[]; income: readonly string[];
}) {
  const [state, action, pending] = useActionState(linkCash, undefined);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const all = picked.size === rows.length && rows.length > 0;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Saqlangach ro'yxat serverdan yangilanadi — belgilar tozalansin
  useEffect(() => { if (state?.ok) setPicked(new Set()); }, [state]);
  const cell = "border-b border-slate-100 px-2 py-1.5 align-top";

  return (
    <form action={action} className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-2 py-2"><input type="checkbox" checked={all} aria-label="Hammasini belgilash"
                onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th className="px-2 py-2">Sana</th><th className="px-2 py-2">Kassa yozuvi</th><th className="px-2 py-2 text-right">Summa</th>
              <th className="px-2 py-2">Toifa (logistika)</th><th className="px-2 py-2">Mashina</th><th className="px-2 py-2">Haydovchi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={picked.has(r.id) ? "bg-blue-50/50" : undefined}>
                <td className={cell}><input type="checkbox" name="pick" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label="Belgilash" /></td>
                <td className={`${cell} whitespace-nowrap tabular`}>{r.date}</td>
                <td className={cell}>
                  <div className="font-medium">{r.source}</div>
                  <div className="text-xs text-slate-500">{[r.account, r.counterparty, r.note].filter(Boolean).join(" · ")}</div>
                </td>
                <td className={`${cell} whitespace-nowrap text-right tabular ${r.type === "INCOME" ? "text-emerald-700" : ""}`}>{r.type === "INCOME" ? "+" : "−"}{r.amount}</td>
                <td className={cell}>
                  <Select name={`c_${r.id}`} defaultValue={r.category} className="h-8 min-w-44">
                    {(r.type === "EXPENSE" ? expense : income).map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </td>
                <td className={cell}>
                  <Select name={`v_${r.id}`} defaultValue={r.vehicleId ?? ""} className="h-8 min-w-32">
                    <option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </Select>
                </td>
                <td className={cell}>
                  <Select name={`d_${r.id}`} defaultValue="" className="h-8 min-w-40">
                    <option value="">—</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Logistikaga olindi"} />}
      <Button disabled={pending || !picked.size}><Link2 size={16} /> {pending ? "Olinmoqda…" : `Belgilanganlarni logistikaga olish${picked.size ? ` (${picked.size})` : ""}`}</Button>
    </form>
  );
}
