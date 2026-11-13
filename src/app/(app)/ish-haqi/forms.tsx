"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Check, RefreshCw, Send, Undo2, Wallet, XCircle } from "lucide-react";
import { approveAction, calculateAction, cancelAction, payAction, recalcAction, returnAction, saveSettingsAction, savePieceRatesAction, submitAction, unpayAction } from "./actions";
import { Button, Card, CardHeader, Checkbox, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { money } from "@/lib/format";
import type { ActionState } from "@/lib/action";

/** Oy va tur tanlab hisoblash (bor qoralama bo'lsa — qayta hisoblanadi). */
export function CalculateForm({ month }: { month: string }) {
  const [state, act, pending] = useActionState(calculateAction, undefined);
  return (
    <form action={act} className="flex flex-wrap items-end gap-3">
      <Field label="Oy"><Input type="month" name="month" defaultValue={month} max={month} required /></Field>
      <Field label="Vedomost">
        <Select name="kind" defaultValue="FINAL"><option value="ADVANCE">Avans</option><option value="FINAL">Oy yakuni</option></Select>
      </Field>
      <Button disabled={pending}><Calculator size={15} /> {pending ? "Hisoblanmoqda…" : "Hisoblash"}</Button>
      <div className="w-full"><FormError error={state?.error} /></div>
    </form>
  );
}

function useRefresh(state: ActionState) {
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
}

/** Bitta tugmali amal (qayta hisoblash, yuborish, tasdiqlash). */
function SimpleAction({ run, label, icon: Icon, variant = "primary", confirm }: { run: () => Promise<ActionState>; label: string; icon: typeof Check; variant?: "primary" | "secondary" | "success"; confirm?: string }) {
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, setPending] = useState(false);
  useRefresh(state);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant={variant} disabled={pending} onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setPending(true); setState(await run()); setPending(false);
      }}><Icon size={15} /> {pending ? "…" : label}</Button>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </div>
  );
}

export function RunActions({ id, status, kind, canCalc, canApprove, net }: { id: string; status: string; kind: string; canCalc: boolean; canApprove: boolean; net: number }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {status === "DRAFT" && canCalc && kind !== "EXTRA" && <SimpleAction run={() => recalcAction(id)} label="Qayta hisoblash" icon={RefreshCw} variant="secondary" />}
      {status === "DRAFT" && canCalc && <SimpleAction run={() => submitAction(id)} label="Direktor tasdig'iga yuborish" icon={Send} confirm="Vedomostni direktor tasdig'iga yuborasizmi? Shundan keyin qayta hisoblanmaydi" />}
      {status === "SUBMITTED" && canApprove && <SimpleAction run={() => approveAction(id)} label="Tasdiqlash" icon={Check} variant="success" confirm={`Vedomostni tasdiqlaysizmi? Kassa ${money(net)} to'laydi`} />}
      {status === "SUBMITTED" && canApprove && <NoteAction action={returnAction.bind(null, id)} field="note" label="Qaytarish" placeholder="Nimani tuzatish kerak" icon={Undo2} />}
      {["DRAFT", "SUBMITTED", "APPROVED"].includes(status) && canApprove && <NoteAction action={cancelAction.bind(null, id)} field="reason" label="Bekor qilish" placeholder="Bekor qilish sababi" icon={XCircle} danger />}
    </div>
  );
}

function NoteAction({ action, field, label, placeholder, icon: Icon, danger }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; field: string; label: string; placeholder: string; icon: typeof Check; danger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(action, undefined);
  useRefresh(state);
  if (!open) return <Button variant="ghost" onClick={() => setOpen(true)}><Icon size={15} /> {label}</Button>;
  return (
    <form action={act} className="flex flex-col gap-1">
      <div className="flex gap-1">
        <Input name={field} required placeholder={placeholder} className="w-64" />
        <Button variant={danger ? "danger" : "secondary"} disabled={pending}>{label}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Yopish</Button>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}

export type PayLine = { id: string; fullName: string; net: number };
export type PayAccount = { id: string; name: string; type: string; balance: number };

/** Kassadan to'lash: hammasi yoki belgilanganlar. */
export function PayForm({ id, lines, accounts }: { id: string; lines: PayLine[]; accounts: PayAccount[] }) {
  const [state, act, pending] = useActionState(payAction.bind(null, id), undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useRefresh(state);
  const sum = (picked.size ? lines.filter((l) => picked.has(l.id)) : lines).reduce((s, l) => s + l.net, 0);
  if (!lines.length) return null;
  return (
    <form action={act} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Qaysi kassadan / hisobdan">
          <Select name="cashAccountId" required defaultValue={accounts.find((a) => a.type === "CASH")?.id ?? accounts[0]?.id}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.type === "CASH" ? "naqd" : "bank"} · qoldiq {money(a.balance)}</option>)}
          </Select>
        </Field>
        <Field label="Izoh"><Input name="note" placeholder="Masalan: plastik kartaga" /></Field>
        <Button variant="success" disabled={pending}><Wallet size={15} /> {pending ? "To'lanmoqda…" : `${picked.size ? `${picked.size} xodimga` : "Hammaga"} ${money(sum)} to'lash`}</Button>
      </div>
      <details className="rounded-lg border border-slate-200 p-2 text-sm">
        <summary className="cursor-pointer text-slate-600">Faqat ayrim xodimlarga to&apos;lash ({lines.length} ta to&apos;lanmagan)</summary>
        <div className="mt-2 grid max-h-60 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {lines.map((l) => (
            <label key={l.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-slate-50">
              <span className="flex items-center gap-2">
                <input type="checkbox" name="line" value={l.id} checked={picked.has(l.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} className="h-4 w-4 rounded border-slate-300" />
                {l.fullName}
              </span>
              <span className="tabular text-slate-600">{money(l.net)}</span>
            </label>
          ))}
        </div>
      </details>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}

/** Bitta to'lov — bitta kassa chiqimi va u yopgan qatorlar (chiqim bo'linmaydi, shuning uchun butunligicha tanlanadi). */
export type UnpayGroup = { key: string; label: string; amount: number; lines: { id: string; fullName: string }[] };

/** To'lovni bekor qilish (faqat direktor): hammasi yoki belgilangan to'lovlar, sabab majburiy. */
export function UnpayForm({ id, groups }: { id: string; groups: UnpayGroup[] }) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(unpayAction.bind(null, id), undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useRefresh(state);
  if (!groups.length) return state?.ok ? <FormSuccess text={state.note} /> : null;
  // Belgilangani yangilangan ro'yxatda qolmagan bo'lsa (bekor qilingandan keyin) — «hammasi» deb ko'rsatiladi va yuboriladi
  const sel = groups.filter((g) => picked.has(g.key));
  const chosen = sel.length ? sel : groups;
  const sum = chosen.reduce((s, g) => s + g.amount, 0);
  const people = chosen.reduce((s, g) => s + g.lines.length, 0);
  if (!open) {
    return (
      <div className="space-y-1">
        <Button variant="ghost" onClick={() => setOpen(true)}><Undo2 size={15} /> To&apos;lovni bekor qilish</Button>
        <FormSuccess text={state?.ok ? state.note : undefined} />
      </div>
    );
  }
  return (
    <Card>
      <CardHeader title="To'lovni bekor qilish" description="Noto'g'ri to'lov: kassadagi «Ish haqi» chiqimi sabab bilan bekor qilinadi, qatorlar yana to'lanmagan bo'ladi — kassir qayta to'laydi" />
      <form action={act} className="space-y-3"
        onSubmit={(e) => { if (!window.confirm(`${people} xodim to'lovi (${money(sum)}) bekor qilinsinmi? Chiqim kassada bekor qilinadi, qatorlar yana to'lanmagan bo'ladi`)) e.preventDefault(); }}>
        {chosen.flatMap((g) => g.lines).map((l) => <input key={l.id} type="hidden" name="line" value={l.id} />)}
        <div className="grid max-h-60 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm">
          {groups.map((g) => (
            <label key={g.key} className="flex items-start justify-between gap-2 rounded px-2 py-1 hover:bg-slate-50">
              <span className="flex items-start gap-2">
                <input type="checkbox" checked={picked.has(g.key)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(g.key); else n.delete(g.key); return n; })} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
                <span>
                  {g.lines.map((l) => l.fullName).join(", ")}
                  <span className="block text-xs text-slate-500">{g.label}</span>
                </span>
              </span>
              <span className="tabular whitespace-nowrap text-slate-600">{money(g.amount)}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">Belgilanmasa — barcha to&apos;lovlar. Bitta to&apos;lov (kassa chiqimi) bir nechta xodimni birga yopgan bo&apos;lsa, u butunligicha bekor qilinadi.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input name="reason" required minLength={3} maxLength={300} placeholder="Bekor qilish sababi (majburiy)" className="w-72" />
          <Button variant="danger" disabled={pending}><Undo2 size={15} /> {pending ? "Bajarilmoqda…" : `${sel.length ? `${people} xodim` : "Hammasi"} · ${money(sum)} bekor qilish`}</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Yopish</Button>
        </div>
        <FormError error={state?.error} />
        <FormSuccess text={state?.ok ? state.note : undefined} />
      </form>
    </Card>
  );
}

export type SettingsVals = { incomeTaxPct: number; inpsPct: number; socialTaxPct: number; advancePct: number; advanceDay: number; sickPctShort: number; sickPctLong: number; hoursPerDay: number; vacationPaid: boolean };

export function SettingsForm({ v, editable }: { v: SettingsVals; editable: boolean }) {
  const [state, act, pending] = useActionState(saveSettingsAction, undefined);
  useRefresh(state);
  return (
    <form action={act} className="space-y-4">
      <fieldset disabled={!editable} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="JShDS (daromad solig'i), %" hint="Hisoblangan summadan ushlanadi"><Input type="number" step="0.01" name="incomeTaxPct" defaultValue={v.incomeTaxPct} /></Field>
        <Field label="INPS (shaxsiy pensiya), %" hint="JShDS ichidan o'tkaziladi — qo'lga summaga ta'sir qilmaydi"><Input type="number" step="0.01" name="inpsPct" defaultValue={v.inpsPct} /></Field>
        <Field label="Ijtimoiy soliq, %" hint="Ish beruvchi to'laydi, xodimdan ushlanmaydi"><Input type="number" step="0.01" name="socialTaxPct" defaultValue={v.socialTaxPct} /></Field>
        <Field label="Avans, %" hint="Oylik (bashorat) summaning foizi"><Input type="number" name="advancePct" defaultValue={v.advancePct} /></Field>
        <Field label="Avans hisoblanadigan kun" hint="Shu kungacha ishlangani bo'yicha"><Input type="number" name="advanceDay" defaultValue={v.advanceDay} /></Field>
        <Field label="Ish kuni, soat" hint="Soatbay xodim ta'til/kasallik kuni uchun"><Input type="number" step="0.5" name="hoursPerDay" defaultValue={v.hoursPerDay} /></Field>
        <Field label="Kasallik: staj 8 yilgacha, %"><Input type="number" name="sickPctShort" defaultValue={v.sickPctShort} /></Field>
        <Field label="Kasallik: staj 8 yildan ko'p, %"><Input type="number" name="sickPctLong" defaultValue={v.sickPctLong} /></Field>
        <div className="flex items-end pb-2"><Checkbox name="vacationPaid" label="Mehnat ta'tili kunlari haq to'lanadi" defaultChecked={v.vacationPaid} /></div>
      </fieldset>
      <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
      {editable && <Button disabled={pending}>Saqlash</Button>}
    </form>
  );
}

export function PieceRatesForm({ products, editable }: { products: { id: string; name: string; unit: string; pieceRate: number | null }[]; editable: boolean }) {
  const [state, act, pending] = useActionState(savePieceRatesAction, undefined);
  useRefresh(state);
  return (
    <form action={act} className="space-y-3">
      <fieldset disabled={!editable} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {products.map((p) => (
          <label key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{p.name} <span className="text-xs text-slate-500">· 1 {p.unit}</span></span>
            <Input type="number" min={0} step={100} name={`rate:${p.id}`} defaultValue={p.pieceRate ?? undefined} placeholder="—" className="h-8 w-32 text-right" />
          </label>
        ))}
      </fieldset>
      <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
      {editable && products.length > 0 && <Button disabled={pending}>Saqlash</Button>}
    </form>
  );
}
