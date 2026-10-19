"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Pencil, X } from "lucide-react";
import { Button, Field, FormActions, FormError, FormSuccess, Input, Select, Card, SheetTd, SheetTr } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { fmtNum, isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveRentCharge, saveRentShop, saveRentTx } from "./actions";

type ShopOpt = { id: string; name: string; location: string };

/**
 * «Kirim» / «Chiqim» tugmalari (ularning tepasida sahifa arenda kassasining umumiy summasini ko'rsatadi).
 * Bosilganda tegishli forma ochiladi; saqlangach forma tozalanadi va ochiq qoladi — ketma-ket kiritish qulay.
 */
export function RentTxPanel({ shops, month, months, expenseCats, canCreate }: {
  shops: ShopOpt[]; month: string; months: { key: string; label: string }[]; expenseCats: readonly string[]; canCreate: boolean;
}) {
  const [mode, setMode] = useState<"INCOME" | "EXPENSE" | null>(null);
  if (!canCreate) return null;
  const btn = (m: "INCOME" | "EXPENSE") => cn("h-12 flex-1 gap-2 rounded-xl px-5 text-base font-semibold sm:min-w-44 sm:flex-none", mode === m && (m === "INCOME" ? "ring-3 ring-emerald-500/30" : "ring-3 ring-red-500/30"));
  return (
    <div className="mb-6">
      <div className="flex gap-3">
        <Button type="button" variant="success" className={btn("INCOME")} onClick={() => setMode(mode === "INCOME" ? null : "INCOME")} aria-expanded={mode === "INCOME"}><ArrowDownLeft size={20} /> Kirim</Button>
        <Button type="button" variant="danger" className={btn("EXPENSE")} onClick={() => setMode(mode === "EXPENSE" ? null : "EXPENSE")} aria-expanded={mode === "EXPENSE"}><ArrowUpRight size={20} /> Chiqim</Button>
      </div>
      {mode && (
        <Card className="mt-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{mode === "INCOME" ? "Arenda kirimi — ijarachidan pul" : "Arenda chiqimi"}</h2>
            <button type="button" onClick={() => setMode(null)} aria-label="Yopish" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
          </div>
          <TxForm key={mode} type={mode} shops={shops} month={month} months={months} expenseCats={expenseCats} />
        </Card>
      )}
    </div>
  );
}

function TxForm({ type, shops, month, months, expenseCats }: { type: "INCOME" | "EXPENSE"; shops: ShopOpt[]; month: string; months: { key: string; label: string }[]; expenseCats: readonly string[] }) {
  const [state, action, pending] = useActionState(saveRentTx, undefined);
  // Bir martalik kalit: ikki marta bosilgan «Saqlash» ikkinchi yozuv ochmaydi; saqlangach yangilanadi
  const [token, setToken] = useState("");
  const [formKey, setFormKey] = useState(0);
  useEffect(() => { setToken(crypto.randomUUID()); }, []);
  useEffect(() => { if (state?.ok) { setFormKey((k) => k + 1); setToken(crypto.randomUUID()); } }, [state]);
  const locations = [...new Set(shops.map((s) => s.location))];
  const income = type === "INCOME";

  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="clientToken" value={token} />
      <div key={formKey} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {income ? (
          <>
            <Field label="Do'kon *" className="sm:col-span-2">
              <Select name="shopId" defaultValue="" required>
                <option value="" disabled>Do&apos;konni tanlang…</option>
                {locations.map((l) => (
                  <optgroup key={l} label={l}>{shops.filter((s) => s.location === l).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Qaysi oy uchun *">
              <Select name="month" defaultValue={month}>{months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Chiqim turi *">
              <Select name="category" defaultValue={expenseCats[0]}>{expenseCats.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            </Field>
            <Field label="Do'kon" hint="Ixtiyoriy — masalan ortiqcha to'lov qaytarilsa">
              <Select name="shopId" defaultValue="">
                <option value="">—</option>
                {locations.map((l) => (
                  <optgroup key={l} label={l}>{shops.filter((s) => s.location === l).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
                ))}
              </Select>
            </Field>
            <div className="hidden sm:block" />
          </>
        )}
        <Field label="To'lov usuli *">
          <Select name="method" defaultValue="CASH"><option value="CASH">Naqd</option><option value="BANK">Perechisleniye</option></Select>
        </Field>
        <Field label="Summa *"><MoneyInput name="amount" required /></Field>
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
        <Field label="Izoh" className="sm:col-span-3"><Input name="note" placeholder={income ? "Masalan: 1500 $ zaklad" : "Kimga / nima uchun"} /></Field>
      </div>
      <FormActions>
        <Button disabled={pending || !token} variant={income ? "success" : "danger"}>
          {pending ? "Saqlanmoqda…" : income ? "Kirimni saqlash" : "Chiqimni saqlash"}
        </Button>
      </FormActions>
    </form>
  );
}

export type ChargeRowData = {
  shopId: string; name: string; isActive: boolean;
  bankDue: number; cashDue: number; due: number; electricity: number; tax: number;
  bankPaid: number; cashPaid: number; paid: number; left: number; note: string | null;
};

const cell = (v: number) => (Math.abs(v) < 0.005 ? "–" : fmtNum(v));
const num = (v: number) => (v ? String(v) : "");

/** Oy varag'ining bitta qatori. Qalam bosilsa — summalar shu qatorning o'zida tahrirlanadi. */
export function ChargeRow({ row, month, canEdit }: { row: ChargeRowData; month: string; canEdit: boolean }) {
  const [edit, setEdit] = useState(false);
  const [state, action, pending] = useActionState(saveRentCharge.bind(null, row.shopId, month), undefined);
  const [, start] = useTransition();
  const init = () => ({ bankDue: num(row.bankDue), cashDue: num(row.cashDue), electricity: num(row.electricity), tax: num(row.tax), note: row.note ?? "" });
  const [val, setVal] = useState(init);
  useEffect(() => { if (state?.ok) setEdit(false); }, [state]);
  const leftTone = row.left > 0.005 ? "text-red-600" : row.left < -0.005 ? "text-emerald-700" : "text-slate-400";

  if (edit) {
    // <tr> ichiga <form> qo'yib bo'lmaydi — qiymatlar holatda, «Saqlash» FormData yig'ib action'ni chaqiradi
    const save = () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(val)) fd.set(k, k === "note" ? v : v || "0");
      start(() => action(fd));
    };
    const money = (k: "bankDue" | "cashDue" | "electricity" | "tax", label: string) => (
      <SheetTd right className="min-w-32 p-1">
        <MoneyInput value={val[k]} onChange={(v) => setVal((o) => ({ ...o, [k]: v }))} ariaLabel={label} suffix={null} className="h-8 text-right" />
      </SheetTd>
    );
    return (
      <SheetTr className="bg-amber-50/60">
        <SheetTd strong className="sticky left-0 z-[1] bg-white">
          {row.name}
          {state?.error && <span role="alert" className="block text-xs font-normal text-red-600">{state.error}</span>}
        </SheetTd>
        {money("bankDue", "Perechisleniye summasi")}
        {money("cashDue", "Naqd to'lovi")}
        <SheetTd right tone="yellow" strong>{cell(Number(val.bankDue || 0) + Number(val.cashDue || 0))}</SheetTd>
        {money("electricity", "Svet")}
        {money("tax", "Biz to'laydigan soliq")}
        <SheetTd right>{cell(row.bankPaid)}</SheetTd>
        <SheetTd right>{cell(row.cashPaid)}</SheetTd>
        <SheetTd right>{cell(row.paid)}</SheetTd>
        <SheetTd right muted>avto</SheetTd>
        <SheetTd className="min-w-56 p-1">
          <div className="flex items-center gap-1">
            <Input value={val.note} onChange={(e) => setVal((o) => ({ ...o, note: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") save(); }} aria-label="Izoh" className="h-8 text-xs" />
            <button type="button" onClick={save} disabled={pending} aria-label="Saqlash" className="rounded-md bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={14} /></button>
            <button type="button" onClick={() => { setEdit(false); setVal(init()); }} aria-label="Bekor qilish" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={14} /></button>
          </div>
        </SheetTd>
      </SheetTr>
    );
  }

  return (
    <SheetTr className={cn(!row.isActive && "opacity-60")}>
      <SheetTd strong className="sticky left-0 z-[1] max-w-72 whitespace-normal bg-white"><Link href={`/arenda/dokon/${row.shopId}`} className="hover:underline">{row.name}</Link></SheetTd>
      <SheetTd right>{cell(row.bankDue)}</SheetTd>
      <SheetTd right>{cell(row.cashDue)}</SheetTd>
      <SheetTd right tone="yellow" strong>{cell(row.due)}</SheetTd>
      <SheetTd right>{cell(row.electricity)}</SheetTd>
      <SheetTd right>{cell(row.tax)}</SheetTd>
      <SheetTd right tone="green">{cell(row.bankPaid)}</SheetTd>
      <SheetTd right tone="green">{cell(row.cashPaid)}</SheetTd>
      <SheetTd right tone="green" strong>{cell(row.paid)}</SheetTd>
      <SheetTd right strong className={leftTone}>{cell(row.left)}</SheetTd>
      <SheetTd className="min-w-40 text-xs text-slate-600">
        <div className="flex items-start justify-between gap-2">
          <span className="whitespace-normal">{row.note}</span>
          {canEdit && <button type="button" onClick={() => { setVal(init()); setEdit(true); }} aria-label={`${row.name} — tahrirlash`} title="Summalarni tahrirlash" className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={13} /></button>}
        </div>
      </SheetTd>
    </SheetTr>
  );
}

/** Do'kon qo'shish / tahrirlash. Summalar — andoza: yangi oy ochilganda (o'tgan oy hisobi bo'lmasa) shu qiymatlar olinadi. */
export function ShopForm({ shop, locations, month, onDoneHref }: {
  shop?: { id: string; name: string; location: string; bankAmount: number; cashAmount: number; electricity: number; tax: number; note: string | null; tenantName: string | null; phone: string | null; inn: string | null };
  locations: string[]; month: string; onDoneHref?: string;
}) {
  const [state, action, pending] = useActionState(saveRentShop, undefined);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (!state?.ok) return;
    if (shop && onDoneHref) window.location.assign(onDoneHref);
    else setFormKey((k) => k + 1);
  }, [state, shop, onDoneHref]);
  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      {shop && <input type="hidden" name="id" value={shop.id} />}
      <input type="hidden" name="month" value={month} />
      <div key={formKey} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Do'kon nomi *" className="sm:col-span-2"><Input name="name" defaultValue={shop?.name} placeholder="Masalan: Xitoy kiyim do'kon" required /></Field>
        <Field label="Joy (bozor) *" className="sm:col-span-2" hint="Jadvalda shu nom bo'yicha guruhlanadi">
          <Input name="location" list="rent-locations" defaultValue={shop?.location} placeholder="Texno siti bozor" required />
          <datalist id="rent-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
        </Field>
        <Field label="Perechisleniye (oylik)"><MoneyInput name="bankAmount" defaultValue={num(shop?.bankAmount ?? 0)} /></Field>
        <Field label="Naqd (oylik)"><MoneyInput name="cashAmount" defaultValue={num(shop?.cashAmount ?? 0)} /></Field>
        <Field label="Svet"><MoneyInput name="electricity" defaultValue={num(shop?.electricity ?? 0)} /></Field>
        <Field label="Biz to'laydigan soliq"><MoneyInput name="tax" defaultValue={num(shop?.tax ?? 0)} /></Field>
        <Field label="Ijarachi (F.I.O. / mas'ul)" className="sm:col-span-2"><Input name="tenantName" defaultValue={shop?.tenantName ?? ""} placeholder="Masalan: Vaxabjanova Nigora" /></Field>
        <Field label="Telefon" hint="eslatma va bog'lanish uchun"><Input name="phone" type="tel" defaultValue={shop?.phone ?? ""} placeholder="+998 90 123 45 67" /></Field>
        <Field label="INN / JShShIR"><Input name="inn" inputMode="numeric" defaultValue={shop?.inn ?? ""} placeholder="200588569" /></Field>
        <Field label="Izoh" className="sm:col-span-4"><Input name="note" defaultValue={shop?.note ?? ""} placeholder="Shartnoma, zaklad, kelishuv…" /></Field>
      </div>
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : shop ? "Saqlash" : "Do'kon qo'shish"}</Button>
      </FormActions>
    </form>
  );
}
