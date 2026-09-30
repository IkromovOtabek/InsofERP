"use client";

import { useActionState, useTransition } from "react";
import { Copy, Save } from "lucide-react";
import { copyBudgets, saveBudgets, saveThresholds } from "./actions";
import { Button, FormError, Input, Table, Td, Th, Tr } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { money, pct } from "@/lib/format";

export type BudgetRow = { cat: string; amount: number | null; limit: number | null; fact: number; forecast: number; histAvg: number | null };

/** Oy byudjeti jadvali: har kategoriya — byudjet, limit, fakt, prognoz, o'tgan 3 oy o'rtachasi. */
export function BudgetForm({ month, rows, prevMonth }: { month: string; rows: BudgetRow[]; prevMonth: string }) {
  const [state, action, pending] = useActionState(saveBudgets.bind(null, month), undefined);
  const [copying, startCopy] = useTransition();
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0), fact = rows.reduce((s, r) => s + r.fact, 0);
  return (
    <form action={action}>
      <Table>
        <thead><tr><Th>Kategoriya</Th><Th right>O&apos;tgan 3 oy o&apos;rtachasi</Th><Th right className="w-44">Byudjet (so&apos;m)</Th><Th right className="w-44">Limit (kritik)</Th><Th right>Fakt (oy)</Th><Th right>Prognoz</Th><Th right>Bajarilish</Th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const p = r.amount ? (r.fact / r.amount) * 100 : null;
            return (
              <Tr key={r.cat}>
                <Td className="font-medium">{r.cat}<input type="hidden" name="cat[]" value={r.cat} /></Td>
                <Td right className="text-slate-500 tabular">{r.histAvg !== null ? money(r.histAvg) : "—"}</Td>
                <Td right><MoneyInput name={`amt:${r.cat}`} defaultValue={r.amount ? String(r.amount) : ""} placeholder={r.histAvg ? String(Math.round(r.histAvg)) : "0"} suffix={null} className="py-1.5 text-right text-sm" /></Td>
                <Td right><MoneyInput name={`lim:${r.cat}`} defaultValue={r.limit ? String(r.limit) : ""} placeholder="= byudjet" suffix={null} className="py-1.5 text-right text-sm" /></Td>
                <Td right className={`tabular ${r.amount && r.fact > r.amount ? "font-semibold text-red-600" : ""}`}>{money(r.fact)}</Td>
                <Td right className={`tabular ${r.amount && r.forecast > r.amount ? "text-amber-700" : "text-slate-500"}`}>{money(r.forecast)}</Td>
                <Td right className="tabular">{p === null ? <span className="text-slate-400">byudjet yo&apos;q</span> : <span className={p >= 100 ? "font-semibold text-red-600" : p >= 90 ? "text-amber-700" : "text-emerald-700"}>{pct(p, 0)}</span>}</Td>
              </Tr>
            );
          })}
          <tr className="bg-slate-50 font-semibold"><Td>Jami</Td><Td /><Td right className="tabular">{money(total)}</Td><Td /><Td right className="tabular">{money(fact)}</Td><Td /><Td right className="tabular">{total ? pct((fact / total) * 100, 0) : "—"}</Td></tr>
        </tbody>
      </Table>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}><Save size={15} /> {pending ? "Saqlanmoqda…" : "Byudjetni saqlash"}</Button>
        <Button type="button" variant="secondary" disabled={copying} onClick={() => startCopy(async () => { const r = await copyBudgets(prevMonth, month); if (r?.error) alert(r.error); })}><Copy size={15} /> O&apos;tgan oydan nusxalash</Button>
        <FormError error={state?.error} />
        {state?.note && <span className="text-sm text-emerald-700">{state.note}</span>}
        <span className="text-xs text-slate-500">Bo&apos;sh qoldirilgan kategoriya — byudjetsiz: undagi har xarajat «rejalashtirilmagan» deb ko&apos;rsatiladi.</span>
      </div>
    </form>
  );
}

export function ThresholdForm({ t }: { t: { alertWarnPct: number; alertCritPct: number; stockWarnDays: number; stockCritDays: number; overdueDays: number; supplyDirectorLimit: number } }) {
  const [state, action, pending] = useActionState(saveThresholds, undefined);
  const F = ({ name, label, value, hint }: { name: string; label: string; value: number; hint: string }) => (
    <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span><Input name={name} type="number" defaultValue={value} className="py-1.5 text-sm" required /><span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span></label>
  );
  return (
    <form action={action} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3 xl:grid-cols-7">
      <F name="alertWarnPct" label="E'tibor, % byudjetdan" value={t.alertWarnPct} hint="sariq holat" />
      <F name="alertCritPct" label="Kritik, % byudjetdan" value={t.alertCritPct} hint="qizil holat" />
      <F name="stockWarnDays" label="Xomashyo e'tibor, kun" value={t.stockWarnDays} hint="shuncha kunga yetsa — sariq" />
      <F name="stockCritDays" label="Xomashyo kritik, kun" value={t.stockCritDays} hint="to'xtash xavfi — qizil" />
      <F name="overdueDays" label="Muddati o'tgan qarz, kun" value={t.overdueDays} hint="schyot shundan eski bo'lsa" />
      <F name="supplyDirectorLimit" label="Katta xarid, so'm" value={t.supplyDirectorLimit} hint="shundan katta xaridni direktor tasdiqlaydi; 0 — yo'q" />
      <div className="flex h-full flex-col justify-end gap-1"><Button type="submit" disabled={pending}>Saqlash</Button>{state?.ok && <span className="text-xs text-emerald-700">Saqlandi</span>}<FormError error={state?.error} /></div>
    </form>
  );
}
