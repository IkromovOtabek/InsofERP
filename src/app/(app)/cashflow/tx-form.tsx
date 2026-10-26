"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Banknote, Landmark } from "lucide-react";
import { isoDate } from "@/lib/format";
import { createCashTx } from "./actions";
import { Button, Field, FormError, FormSuccess, Input, Select, FormActions } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { cn } from "@/lib/utils";
import { CASH_METHOD_LABEL, PEREKIT_CATEGORY, type CashMethod } from "@/lib/cash-categories";

type Opt = { id: string; name: string };
type Acc = Opt & { type?: CashMethod };

/**
 * `receipts` — to'lanmagan kirim hujjatlari: chiqim shulardan biriga bog'lansa, kirimning "to'langan" summasiga qo'shiladi.
 * `canPerekit` — Chiqim kategoriyalarida «Perekit»: o'z hisoblarimiz orasida o'tkazma (chiqim emas, `lib/cash-transfer.ts`).
 * «Naqd / Bank» — to'lov usuli: hisob ro'yxatini shu turdagi hisoblarga toraytiradi (usul hisob turidan olinadi).
 */
export function TxForm({ accounts, suppliers, receipts = [], incomeCats, expenseCats, canPerekit = false, clientToken = "" }: { accounts: Acc[]; suppliers: Opt[]; receipts?: { id: string; supplierId: string; label: string }[]; incomeCats: string[]; expenseCats: string[]; canPerekit?: boolean; clientToken?: string }) {
  const [state, action, pending] = useActionState(createCashTx, undefined);
  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  // Saqlangandan keyin maydonlar qayta mount qilinadi — summa (MoneyInput) ham, tanlovlar ham to'liq tozalanadi
  const [formKey, setFormKey] = useState(0);
  const [supplierId, setSupplierId] = useState("");
  const [category, setCategory] = useState("");
  const [method, setMethod] = useState<CashMethod>(accounts.some((a) => a.type === "CASH") || !accounts.some((a) => a.type === "BANK") ? "CASH" : "BANK");
  const [fromId, setFromId] = useState(accounts[0]?.id ?? "");
  // Perekit uchun bir martalik kalit: ikki marta bosilgan «Saqlash» ikkinchi o'tkazma ochmaydi; saqlangach yangilanadi
  const [token, setToken] = useState(clientToken);
  useEffect(() => { if (state?.ok) { setFormKey((k) => k + 1); setSupplierId(""); setCategory(""); setToken(crypto.randomUUID()); } }, [state]);
  const cats = type === "INCOME" ? incomeCats : canPerekit && accounts.length >= 2 ? [...expenseCats, PEREKIT_CATEGORY] : expenseCats;
  const cat = cats.includes(category) ? category : cats[0];
  const perekit = type === "EXPENSE" && cat === PEREKIT_CATEGORY;
  // Perekitda hamma hisob (kassa ⇄ bank); oddiy kirim/chiqimda — tanlangan usuldagi hisoblar
  const shownAccounts = perekit ? accounts : accounts.filter((a) => !a.type || a.type === method);
  const accId = shownAccounts.some((a) => a.id === fromId) ? fromId : shownAccounts[0]?.id ?? "";
  const accLabel = (a: Acc) => `${a.name}${a.type ? ` (${a.type === "CASH" ? "naqd" : "bank"})` : ""}`;
  const shownReceipts = supplierId ? receipts.filter((r) => r.supplierId === supplierId) : receipts;

  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <input type="hidden" name="type" value={type} />
      {perekit && <input type="hidden" name="clientToken" value={token} />}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
          <button type="button" onClick={() => setType("INCOME")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition", type === "INCOME" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100")}><ArrowDownLeft size={14} /> Kirim</button>
          <button type="button" onClick={() => setType("EXPENSE")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition", type === "EXPENSE" ? "bg-red-600 text-white" : "text-slate-600 hover:bg-slate-100")}><ArrowUpRight size={14} /> Chiqim</button>
        </div>
        {!perekit && (
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="group" aria-label="To'lov usuli">
            {(["CASH", "BANK"] as const).map((m) => {
              const Icon = m === "CASH" ? Banknote : Landmark;
              const none = !accounts.some((a) => a.type === m);
              return <button key={m} type="button" disabled={none} title={none ? "Bu turdagi faol hisob yo'q (Sozlamalar → Kassa / hisoblar)" : undefined} onClick={() => setMethod(m)} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-40", method === m ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}><Icon size={14} /> {CASH_METHOD_LABEL[m]}</button>;
            })}
          </div>
        )}
      </div>
      <div key={formKey} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
        <Field label={perekit ? "Qayerdan (hisob) *" : "Kassa / hisob *"}><Select name="cashAccountId" value={accId} onChange={(e) => setFromId(e.target.value)} required>{shownAccounts.map((a) => <option key={a.id} value={a.id}>{perekit ? accLabel(a) : a.name}</option>)}</Select></Field>
        <Field label="Summa *"><MoneyInput name="amount" required /></Field>
        <Field label="Kategoriya *"><Select name="category" value={cat} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
        {perekit ? (
          <Field label="Qayerga (hisob) *" hint="Pul o'z hisobimizga o'tadi — chiqim emas, ikkala hisob tarixida ko'rinadi" className="sm:col-span-2">
            <Select name="toAccountId" defaultValue="" required><option value="" disabled>Hisobni tanlang…</option>{accounts.filter((a) => a.id !== accId).map((a) => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}</Select>
          </Field>
        ) : type === "EXPENSE" ? (
          <Field label="Yetkazuvchi" hint="Xomashyo uchun"><Select name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        ) : <div />}
        {type === "EXPENSE" && !perekit && shownReceipts.length > 0 && (
          <Field label="Kirim hujjati" hint="Tanlansa — shu kirimga to'lov (qisman ham), qolgandan oshmaydi" className="sm:col-span-2">
            <Select name="receiptId" defaultValue=""><option value="">— bog&apos;lanmagan —</option>{shownReceipts.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select>
          </Field>
        )}
        {!perekit && <Field label={type === "INCOME" ? "Kimdan" : "Kimga"}><Input name="counterparty" placeholder="Nomi / F.I.O." /></Field>}
        <Field label="Izoh" className="sm:col-span-3"><Input name="note" placeholder="Nima uchun" /></Field>
      </div>
      <FormActions>
        {perekit
          ? <Button disabled={pending}><ArrowRightLeft size={14} className="mr-1.5 inline" />{pending ? "Saqlanmoqda…" : "Perekitni saqlash"}</Button>
          : <Button disabled={pending} className={type === "INCOME" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}>{pending ? "Saqlanmoqda…" : type === "INCOME" ? "Kirimni saqlash" : "Chiqimni saqlash"}</Button>}
      </FormActions>
    </form>
  );
}
