"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Pencil, Printer, X } from "lucide-react";
import { Button, Checkbox, Field, FormActions, FormError, FormSuccess, Input, Select, Card, SheetTd, SheetTr } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { fmtNum, isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveRentCharge, saveRentShop, saveRentTx } from "./actions";

type ShopOpt = { id: string; name: string; location: string; daily?: boolean };

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

/**
 * Do'kon kartasidagi kirim formasi: do'kon tanlangan, `leaseId` berilsa — o'sha (sobiq) ijarachi qarzi uchun.
 */
export function ShopTxForm({ shop, leaseId, month, months }: { shop: ShopOpt; leaseId?: string; month: string; months: { key: string; label: string }[] }) {
  return <TxForm type="INCOME" shops={[shop]} month={month} months={months} expenseCats={[]} fixed={{ shopId: shop.id, leaseId }} />;
}

/** «Necha oyga» tanlovi: oylik ijarada summa tanlangan oydan boshlab shuncha oyga teng bo'linadi. */
const MONTH_COUNTS = Array.from({ length: 12 }, (_, i) => i + 1);

function TxForm({ type, shops, month, months, expenseCats, fixed }: {
  type: "INCOME" | "EXPENSE"; shops: ShopOpt[]; month: string; months: { key: string; label: string }[]; expenseCats: readonly string[];
  fixed?: { shopId: string; leaseId?: string };
}) {
  const [state, action, pending] = useActionState(saveRentTx, undefined);
  // Bir martalik kalit: ikki marta bosilgan «Saqlash» ikkinchi yozuv ochmaydi; saqlangach yangilanadi
  const [token, setToken] = useState("");
  const [formKey, setFormKey] = useState(0);
  useEffect(() => { setToken(crypto.randomUUID()); }, []);
  useEffect(() => { if (state?.ok) { setFormKey((k) => k + 1); setToken(crypto.randomUUID()); } }, [state]);
  const locations = [...new Set(shops.map((s) => s.location))];
  const income = type === "INCOME";
  // Kunlik ijarali do'kon tanlansa — «Qaysi oy uchun» o'rniga «Qaysi kun uchun»
  const [shopId, setShopId] = useState(fixed?.shopId ?? "");
  // Kirim turi: ijara yoki svet to'lovi (svet — alohida hisob, oy bo'yicha, kunlik/necha oyga yo'q)
  const [kind, setKind] = useState<"rent" | "elec">("rent");
  const elec = income && kind === "elec";
  const daily = income && kind !== "elec" && !!shops.find((s) => s.id === shopId)?.daily;
  const [count, setCount] = useState(1);
  useEffect(() => { if (state?.ok) { setShopId(fixed?.shopId ?? ""); setCount(1); } }, [state, fixed?.shopId]);

  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      {state?.ok && state.receiptId && (
        <a href={`/arenda/kvitansiya/${state.receiptId}?print=1`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"><Printer size={14} /> Kvitansiyani chop etish</a>
      )}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="clientToken" value={token} />
      {fixed && <input type="hidden" name="shopId" value={fixed.shopId} />}
      {fixed?.leaseId && <input type="hidden" name="leaseId" value={fixed.leaseId} />}
      {income && <input type="hidden" name="incomeKind" value={kind} />}
      {income && (
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="radiogroup" aria-label="Kirim turi">
          {([["rent", "Ijara to'lovi"], ["elec", "Svet to'lovi"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={cn("rounded-md px-3 py-1.5 font-medium", kind === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{l}</button>
          ))}
        </div>
      )}
      <div key={formKey} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {income ? (
          <>
            {!fixed && <Field label="Do'kon *" className="sm:col-span-2">
              <Select name="shopId" value={shopId} onChange={(e) => setShopId(e.target.value)} required>
                <option value="" disabled>Do&apos;konni tanlang…</option>
                {locations.map((l) => (
                  <optgroup key={l} label={l}>{shops.filter((s) => s.location === l).map((s) => <option key={s.id} value={s.id}>{s.name}{s.daily ? " (kunlik)" : ""}</option>)}</optgroup>
                ))}
              </Select>
            </Field>}
            {daily ? (
              <Field label="Qaysi kun uchun *" hint="kunlik ijara — shu kunning to'lovi">
                <Input name="day" type="date" defaultValue={isoDate()} required />
              </Field>
            ) : (
              <Field label={elec ? "Qaysi oy sveti uchun *" : count > 1 ? "Qaysi oydan *" : "Qaysi oy uchun *"}>
                <Select name="month" defaultValue={month}>{months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select>
              </Field>
            )}
            {!daily && !elec && !fixed?.leaseId && (
              <Field label="Necha oyga" hint={count > 1 ? "summa oylarga teng bo'linadi, kvitansiya bitta" : "oldindan to'lov bo'lsa — oylar sonini tanlang"}>
                <Select name="months" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {MONTH_COUNTS.map((k) => <option key={k} value={k}>{k === 1 ? "1 oy" : `${k} oy`}</option>)}
                </Select>
              </Field>
            )}
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
  shopId: string; leaseId: string; name: string; isActive: boolean; tenantName: string | null; former: boolean;
  period: "MONTHLY" | "DAILY"; days: number | null; bankRate: number; cashRate: number;
  meterStart: number | null; meterEnd: number | null; elecBilled: boolean;
  bankDue: number; cashDue: number; elecDue: number; due: number; electricity: number; tax: number;
  bankPaid: number; cashPaid: number; paid: number; left: number; note: string | null;
};

const cell = (v: number) => (Math.abs(v) < 0.005 ? "–" : fmtNum(v));
const num = (v: number) => (v ? String(v) : "");

/** Oy varag'ining bitta qatori. Qalam bosilsa — summalar shu qatorning o'zida tahrirlanadi. */
export function ChargeRow({ row, month, canEdit, showTenant }: { row: ChargeRowData; month: string; canEdit: boolean; showTenant: boolean }) {
  const [edit, setEdit] = useState(false);
  const [state, action, pending] = useActionState(saveRentCharge.bind(null, row.leaseId, month), undefined);
  const [, start] = useTransition();
  const daily = row.period === "DAILY";
  const init = () => ({
    bankDue: num(row.bankDue), cashDue: num(row.cashDue), electricity: num(row.electricity), tax: num(row.tax), note: row.note ?? "", days: daily ? String(row.days ?? "") : "",
  });
  const [val, setVal] = useState(init);
  useEffect(() => { if (state?.ok) setEdit(false); }, [state]);
  const leftTone = row.left > 0.005 ? "text-red-600" : row.left < -0.005 ? "text-emerald-700" : "text-slate-400";

  if (edit) {
    // <tr> ichiga <form> qo'yib bo'lmaydi — qiymatlar holatda, «Saqlash» FormData yig'ib action'ni chaqiradi
    const save = () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(val)) if (k !== "days" || daily) fd.set(k, k === "note" || k === "days" ? v : v || "0");
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
          {daily && (
            // Kunlar o'zgarsa summa kunlik andoza bo'yicha qayta hisoblanadi (keyin qo'lda tuzatsa ham bo'ladi)
            <label className="mt-1 flex items-center gap-1.5 text-xs font-normal text-slate-600">
              <Input value={val.days} inputMode="numeric" aria-label="Kunlar soni" className="h-7 w-14 text-center text-xs"
                onChange={(e) => {
                  const d = e.target.value.replace(/\D/g, "").slice(0, 2), k = Number(d || 0);
                  setVal((o) => ({ ...o, days: d, bankDue: num(Math.round(row.bankRate * k * 100) / 100), cashDue: num(Math.round(row.cashRate * k * 100) / 100) }));
                }} />
              kun × {fmtNum(row.bankRate + row.cashRate)}
            </label>
          )}
          {state?.error && <span role="alert" className="block text-xs font-normal text-red-600">{state.error}</span>}
        </SheetTd>
        {money("bankDue", "Perechisleniye summasi")}
        {money("cashDue", "Naqd to'lovi")}
        <SheetTd right tone="yellow" strong>{cell(Number(val.bankDue || 0) + Number(val.cashDue || 0))}</SheetTd>
        {row.elecBilled
          // Svet hisobidagi joy — summa «Svet» varag'ida (hisoblagich bo'yicha)
          ? <SheetTd right muted className="text-xs">«Svet» varag&apos;ida</SheetTd>
          : money("electricity", "Svet")}
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
      <SheetTd strong className="sticky left-0 z-[1] max-w-72 whitespace-normal bg-white">
        <Link href={`/arenda/dokon/${row.shopId}`} className="hover:underline">{row.name}</Link>
        {(showTenant || row.former) && row.tenantName && <span className="block text-xs font-normal text-slate-500">{row.tenantName}{row.former ? " · sobiq ijarachi" : ""}</span>}
        {daily && <span className="block text-xs font-normal text-slate-500">kunlik · {row.days ?? "?"} kun × {fmtNum(row.bankRate + row.cashRate)}</span>}
      </SheetTd>
      <SheetTd right>{cell(row.bankDue)}</SheetTd>
      <SheetTd right>{cell(row.cashDue)}</SheetTd>
      <SheetTd right tone="yellow" strong>{cell(row.due)}</SheetTd>
      <SheetTd right>
        {cell(row.electricity)}
        {row.elecBilled && <span className="block text-[11px] text-slate-500">alohida hisob{row.meterStart != null && row.meterEnd != null ? ` · ${fmtNum(row.meterEnd - row.meterStart, 1)} kVt` : ""}</span>}
      </SheetTd>
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
  shop?: {
    id: string; name: string; location: string; period: "MONTHLY" | "DAILY"; payDay: number | null; area: number | null; bankAmount: number; cashAmount: number;
    electricity: number; electricityBilled: boolean; elecFixed: number; tax: number; note: string | null; tenantName: string | null; phone: string | null; inn: string | null;
    address: string | null; cadastre: string | null;
    /** Amaldagi shartnoma (bo'sh joyda — yo'q) */
    lease: {
      no: string | null; startDate: string; endDate: string | null; deposit: number;
      tenantRep: string | null; tenantAddress: string | null; tenantAccount: string | null; tenantMfo: string | null;
    } | null;
  };
  locations: string[]; month: string; onDoneHref?: string;
}) {
  const [state, action, pending] = useActionState(saveRentShop, undefined);
  const [, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [period, setPeriod] = useState(shop?.period ?? "MONTHLY");
  const [vacant, setVacant] = useState(false);
  const [billed, setBilled] = useState(shop?.electricityBilled ?? false);
  // Shartnoma maydonlari: yangi joyda (bo'sh bo'lmasa) va amaldagi shartnomasi bor joyni tahrirlashda
  const withLease = shop ? !!shop.lease : !vacant;
  const per = period === "DAILY" ? "kunlik" : "oylik";
  // Xato qaysi katakda bo'lsa — matni o'sha katak ostida (`Field error`), katak qizil va fokusda
  const err = (f: string) => (state?.field === f ? state.error : undefined);
  useEffect(() => {
    if (!state?.ok) return;
    if (shop && onDoneHref) window.location.assign(onDoneHref);
    else setFormKey((k) => k + 1);
  }, [state, shop, onDoneHref]);
  useEffect(() => {
    const form = formRef.current;
    form?.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    if (!form || !state?.field) return;
    // MoneyInput'da `name` yashirin maydonda — ko'rinadigan katak uning yonida
    let el = form.querySelector<HTMLElement>(`[name="${state.field}"]`);
    if (el instanceof HTMLInputElement && el.type === "hidden") el = el.nextElementSibling as HTMLElement | null;
    if (!el) return;
    el.setAttribute("aria-invalid", "true");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, [state]);
  // `<form action>` emas: React 19 action tugagach formani tozalaydi — xato bo'lsa terilgan kataklar o'chib ketardi.
  // Muvaffaqiyatda tozalash `formKey` orqali (yuqorida).
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => action(fd));
  };
  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4">
      <FormError error={state?.error && (state.field ? `${state.error} — qizil bilan belgilangan katakni tekshiring` : state.error)} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      {shop && <input type="hidden" name="id" value={shop.id} />}
      <input type="hidden" name="month" value={month} />
      <div key={formKey} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Do'kon nomi *" className="sm:col-span-2" error={err("name")}><Input name="name" defaultValue={shop?.name} placeholder="Masalan: Xitoy kiyim do'kon" required /></Field>
        <Field label="Joy (bozor) *" hint="Jadvalda shu nom bo'yicha guruhlanadi" error={err("location")}>
          <Input name="location" list="rent-locations" defaultValue={shop?.location} placeholder="Texno siti bozor" required />
          <datalist id="rent-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
        </Field>
        <Field label={shop ? "Maydoni, m²" : "Maydoni, m² *"} hint="1 m² narxi shundan hisoblanadi" error={err("area")}>
          <Input name="area" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={shop?.area ?? ""} placeholder="Masalan: 24" required={!shop} />
        </Field>
        <Field label="Ijara turi" hint={period === "DAILY" ? "Oy hisobi = kunlik summa × kunlar; kirimda kun so'raladi" : "Har oy bir summa"}>
          <Select name="period" value={period} onChange={(e) => setPeriod(e.target.value as "MONTHLY" | "DAILY")}>
            <option value="MONTHLY">Oylik</option><option value="DAILY">Kunlik</option>
          </Select>
        </Field>
        <Field label={`Perechisleniye (${per})`} error={err("bankAmount")}><MoneyInput name="bankAmount" defaultValue={num(shop?.bankAmount ?? 0)} /></Field>
        <Field label={`Naqd (${per})`} error={err("cashAmount")}><MoneyInput name="cashAmount" defaultValue={num(shop?.cashAmount ?? 0)} /></Field>
        {period === "DAILY" ? <div className="hidden sm:block" /> : (
          <Field label="To'lov kuni *" hint="har oyning shu sanasigacha" error={err("payDay")}>
            <Select name="payDay" defaultValue={shop?.payDay ? String(shop.payDay) : ""}>
              <option value="">Tanlang…</option>
              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}-sana{i >= 28 ? " (qisqa oyda — oxirgi kun)" : ""}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Svet" hint={billed ? "svet hisobida — «Svet» varag'ida" : "ma'lumot uchun"} error={err("electricity")}><MoneyInput name="electricity" defaultValue={num(shop?.electricity ?? 0)} disabled={billed} /></Field>
        <Field label="Biz to'laydigan soliq" error={err("tax")}><MoneyInput name="tax" defaultValue={num(shop?.tax ?? 0)} /></Field>
        {withLease && (
          <>
            <Field label="Ijarachi (F.I.O. / mas'ul)" className="sm:col-span-2" error={err("tenantName")}><Input name="tenantName" defaultValue={shop?.tenantName ?? ""} placeholder="Masalan: Vaxabjanova Nigora" /></Field>
            <Field label="Telefon *" hint="ijaradagi joy uchun shart" error={err("phone")}><Input name="phone" type="tel" defaultValue={shop?.phone ?? ""} placeholder="+998 90 123 45 67" /></Field>
            <Field label="INN / JShShIR" error={err("inn")}><Input name="inn" inputMode="numeric" defaultValue={shop?.inn ?? ""} placeholder="200588569" /></Field>
          </>
        )}
        {withLease && (
          <>
            <Field label="Shartnoma №" hint="bo'sh qoldirilsa — avtomatik" error={err("contractNo")}><Input name="contractNo" defaultValue={shop?.lease?.no ?? ""} placeholder="IJ-2026-00001" /></Field>
            <Field label="Ijara boshlanishi" error={err("startDate")}><Input name="startDate" type="date" defaultValue={shop?.lease?.startDate ?? isoDate()} /></Field>
            <Field label="Shartnoma tugashi" hint="bo'sh — muddatsiz" error={err("endDate")}><Input name="endDate" type="date" defaultValue={shop?.lease?.endDate ?? ""} /></Field>
            <Field label="Zaklad (garov)" hint="ma'lumot uchun" error={err("deposit")}><MoneyInput name="deposit" defaultValue={num(shop?.lease?.deposit ?? 0)} /></Field>
            <Field label="Ijarachi vakili / asos" className="sm:col-span-2" hint="shartnomada: «в лице директора …, Устав» yoki pasport ma'lumoti" error={err("tenantRep")}>
              <Input name="tenantRep" defaultValue={shop?.lease?.tenantRep ?? ""} placeholder="в лице директора Иванова И.И., действующего на основании Устава" />
            </Field>
            <Field label="Ijarachi manzili" className="sm:col-span-2" error={err("tenantAddress")}><Input name="tenantAddress" defaultValue={shop?.lease?.tenantAddress ?? ""} /></Field>
            <Field label="Ijarachi h/r" className="sm:col-span-2" error={err("tenantAccount")}><Input name="tenantAccount" inputMode="numeric" defaultValue={shop?.lease?.tenantAccount ?? ""} placeholder="20208000…" /></Field>
            <Field label="Ijarachi MFO" error={err("tenantMfo")}><Input name="tenantMfo" inputMode="numeric" defaultValue={shop?.lease?.tenantMfo ?? ""} /></Field>
          </>
        )}
        <Field label="Joy manzili (shartnoma uchun)" className="sm:col-span-2" error={err("address")}><Input name="address" defaultValue={shop?.address ?? ""} placeholder="г. Янгиюль, ул. Самарканд, 113" /></Field>
        <Field label="Kadastr raqami" error={err("cadastre")}><Input name="cadastre" defaultValue={shop?.cadastre ?? ""} placeholder="11:22:01:01:05:1507" /></Field>
        <Field label="Izoh" className="sm:col-span-4" error={err("note")}><Input name="note" defaultValue={shop?.note ?? ""} placeholder="Kelishuv, joy haqida…" /></Field>
        <Checkbox name="electricityBilled" checked={billed} onChange={(e) => setBilled(e.target.checked)} label="Svet hisobida — ijarachi svetni alohida to'laydi (hisoblagich, «Svet» varag'i)" className="sm:col-span-3" />
        {billed && <Field label="Shartnoma bo'yicha svet (oylik)" hint="hisoblagichsiz joyda svet summasi shu" error={err("elecFixed")}><MoneyInput name="elecFixed" defaultValue={num(shop?.elecFixed ?? 0)} /></Field>}
        {!shop && <Checkbox name="vacant" checked={vacant} onChange={(e) => setVacant(e.target.checked)} label="Bo'sh joy — hali ijaraga berilmagan (oylik hisobga tushmaydi)" className="sm:col-span-4" />}
      </div>
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : shop ? "Saqlash" : "Do'kon qo'shish"}</Button>
      </FormActions>
    </form>
  );
}
