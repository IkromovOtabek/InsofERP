"use client";

import { createContext, startTransition, useActionState, useCallback, useContext, useEffect, useId, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, X } from "lucide-react";
import { createRealizationAction, saveRealizationCellAction, saveRealizationNoteAction, updateRealizationAction } from "./actions";
import { today } from "@/lib/davomat";
import { fmtNum } from "@/lib/format";
import { NDS_RATE } from "@/lib/nds";
import { PRODUCT_UNITS } from "@/lib/unit";
import { Button, Field, FormError, FormSuccess, IconButton, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { cn } from "@/lib/utils";
import type { LogFields, LogOptions } from "@/lib/realization-log";

/** Oyna: portal orqali, Escape yoki fon bosilsa yopiladi (`components/quick-add.tsx` uslubida). */
function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal((
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-4xl" : "max-w-lg"} space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  ), document.body);
}

/** Forma ro'yxatlari sahifada bir marta beriladi — har qatordagi tugmaga takrorlanib ketmasin. */
const Options = createContext<LogOptions | null>(null);
/** Katak tahririning taklif ro'yxatlari — sahifada bir marta (`CellEdit` `list` bilan shularga ulanadi). */
export type CellList = "sellers" | "customers" | "products" | "groups" | "vehicles" | "loadPlaces" | "destinations";
const cellListId = (l: CellList) => `rz-cell-${l}`;
export function OptionsProvider({ options, children }: { options: LogOptions; children: React.ReactNode }) {
  return (
    <Options.Provider value={options}>
      {children}
      <List id={cellListId("sellers")} items={options.sellers} />
      <List id={cellListId("customers")} items={options.customers} />
      <List id={cellListId("products")} items={options.products.map((p) => p.name)} />
      <List id={cellListId("groups")} items={options.groups} />
      <List id={cellListId("vehicles")} items={options.vehicles} />
      <List id={cellListId("loadPlaces")} items={options.loadPlaces} />
      <List id={cellListId("destinations")} items={options.destinations} />
    </Options.Provider>
  );
}
const useOptions = () => useContext(Options) ?? { pays: [], customers: [], products: [], groups: [], sellers: [], vehicles: [], loadPlaces: [], destinations: [] };

/**
 * Yuborish — `onSubmit` + `startTransition`: `<form action>` bo'lsa React 19 xato bilan qaytgan amaldan keyin ham formani
 * tozalaydi va yozilgan qiymatlar yo'qoladi (`stock/rasxod/rasxod-form.tsx` dagi kabi).
 */
const submitWith = (action: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  startTransition(() => action(fd));
};

function List({ id, items }: { id: string; items: string[] }) {
  return <datalist id={id}>{items.map((x) => <option key={x} value={x} />)}</datalist>;
}

export type EntryValues = {
  id: string; date: string; payGroup: string; seller: string; customerName: string; productName: string; groupName: string;
  unit: string; ttn: string; vehicle: string; qty: number; price: number; delivery: number;
  loadPlace: string; destination: string; note: string; refName: string;
};

/**
 * Qo'lda qator (tizimga reys bo'lib tushmagan jo'natma): yangi — «Qo'lda qator» tugmasi, tuzatish — qatordagi qalam.
 * Mahsulot ro'yxatdagisi tanlansa birlik va guruh o'zi qo'yiladi. Summa, QQS, jami — yozilayotganda hisoblanadi
 * (QQS faqat perechisleniyeda). Yangi qatordan keyin oyna ochiq qoladi — keyingi qatorni darhol yozish uchun.
 */
export function EntryButton({ entry, clientToken }: { entry?: EntryValues; clientToken?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {entry
        ? <IconButton icon={Pencil} label="Qatorni tuzatish" onClick={() => setOpen(true)} className="h-6 w-6" />
        : <Button onClick={() => setOpen(true)}><Plus size={16} /> Qo&apos;lda qator</Button>}
      {open && <EntryDialog entry={entry} clientToken={clientToken} onClose={close} />}
    </>
  );
}

function EntryDialog({ entry, clientToken, onClose }: { entry?: EntryValues; clientToken?: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(entry ? updateRealizationAction.bind(null, entry.id) : createRealizationAction, undefined);
  // Saqlangach forma qayta chiziladi (bo'sh holatga) va yangi bir martalik kalit olinadi
  const [round, setRound] = useState(0);
  const [token, setToken] = useState(clientToken ?? "");
  useEffect(() => {
    if (!state?.ok) return;
    if (entry) onClose();
    else { setRound((n) => n + 1); setToken(crypto.randomUUID()); }
  }, [state, entry, onClose]);
  return (
    <Dialog title={entry ? "Qo'lda qatorni tuzatish" : "Realizatsiyaga qo'lda qator"} onClose={onClose} wide>
      <p className="text-xs text-slate-500">Tizimga reys bo&apos;lib tushmagan jo&apos;natma. Faqat reestr — mijoz qarzi, kassa va skladga ta&apos;sir qilmaydi.</p>
      {state?.ok && !entry && <FormSuccess text={state.note ?? "Qo'shildi"} />}
      <EntryFields key={round} entry={entry} token={token} action={action} pending={pending} error={state?.error} onClose={onClose} />
    </Dialog>
  );
}

function EntryFields({ entry, token, action, pending, error, onClose }: {
  entry?: EntryValues; token: string; action: (fd: FormData) => void; pending: boolean; error?: string; onClose: () => void;
}) {
  const uid = useId();
  const options = useOptions();
  const [pay, setPay] = useState(entry?.payGroup ?? "");
  const [unit, setUnit] = useState(entry?.unit ?? "m3");
  const [group, setGroup] = useState(entry?.groupName ?? "");
  const [customer, setCustomer] = useState(entry?.customerName ?? "");
  const [qty, setQty] = useState(entry ? String(entry.qty) : "");
  const [price, setPrice] = useState(entry ? String(entry.price) : "");
  const [delivery, setDelivery] = useState(entry?.delivery ? String(entry.delivery) : "");
  const onProduct = (v: string) => {
    const p = options.products.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
    if (p) { setUnit(p.unit); setGroup(p.group); }
  };
  const q = Number(qty.replace(",", ".")) || 0, pr = Number(price) || 0, dl = Number(delivery) || 0;
  const net = Math.round(q * pr + dl);
  const vat = pay === "BANK" ? Math.round(q * pr * NDS_RATE) : 0;
  return (
    <form onSubmit={submitWith(action)} className="space-y-4">
      {!entry && <input type="hidden" name="clientToken" value={token} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
        <Field label="Sana *"><Input name="date" type="date" defaultValue={entry?.date ?? today()} max={today()} required /></Field>
        <Field label="To'lov turi *">
          <Select name="payGroup" value={pay} onChange={(e) => setPay(e.target.value)} required>
            <option value="" disabled>Tanlang</option>
            {options.pays.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </Select>
        </Field>
        <Field label="Sotuvchi"><Input name="seller" list={`${uid}-s`} defaultValue={entry?.seller} maxLength={100} autoComplete="off" /></Field>
        <Field label="Xaridor *"><Input name="customerName" list={`${uid}-c`} value={customer} onChange={(e) => setCustomer(e.target.value)} required minLength={2} maxLength={200} autoComplete="off" /></Field>
        <Field label="Mahsulot *" className="sm:col-span-2">
          <Input name="productName" list={`${uid}-p`} defaultValue={entry?.productName} onChange={(e) => onProduct(e.target.value)} required maxLength={200} autoComplete="off" placeholder="Beton M300, PK 57-12-8…" />
        </Field>
        <Field label="O'lchov">
          <Select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {PRODUCT_UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Guruh"><Input name="groupName" list={`${uid}-g`} value={group} onChange={(e) => setGroup(e.target.value)} maxLength={60} autoComplete="off" placeholder="Beton, Plita…" /></Field>
        <Field label="TTN №"><Input name="ttn" defaultValue={entry?.ttn} maxLength={40} autoComplete="off" /></Field>
        <Field label="Mashina (raqami)"><Input name="vehicle" list={`${uid}-v`} defaultValue={entry?.vehicle} maxLength={40} autoComplete="off" /></Field>
        <Field label="Miqdor *"><Input name="qty" type="number" min="0.001" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} required className="text-right tabular" /></Field>
        <Field label="Narx (QQSsiz)"><MoneyInput name="price" value={price} onChange={setPrice} /></Field>
        <Field label="Dostavka"><MoneyInput name="delivery" value={delivery} onChange={setDelivery} /></Field>
        <Field label="Ortilgan joy"><Input name="loadPlace" list={`${uid}-l`} defaultValue={entry?.loadPlace} maxLength={60} autoComplete="off" placeholder="BSU-1, Sklad-2…" /></Field>
        <Field label="Boradigan manzil" className="sm:col-span-2"><Input name="destination" list={`${uid}-d`} defaultValue={entry?.destination} maxLength={200} autoComplete="off" /></Field>
        <Field label="Izoh (TTN, mashina, telefon)" className="sm:col-span-2"><Input name="note" defaultValue={entry?.note} maxLength={300} /></Field>
        <Field label="Xaridor (spravka nomi)" className="sm:col-span-2"><Input name="refName" defaultValue={entry?.refName} placeholder={customer || "Bo'sh bo'lsa — xaridor nomi"} maxLength={200} /></Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm tabular">
        <span>Summa (QQSsiz): <b>{fmtNum(net)}</b></span>
        <span>QQS 12%: <b>{vat ? fmtNum(vat) : "—"}</b></span>
        <span>Jami: <b>{fmtNum(net + vat)}</b></span>
      </div>
      <FormError error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Yopish</Button>
        <Button disabled={pending}>{entry ? <Pencil size={15} /> : <Plus size={16} />} {pending ? "Saqlanmoqda…" : entry ? "Saqlash" : "Qo'shish"}</Button>
      </div>
      <List id={`${uid}-s`} items={options.sellers} />
      <List id={`${uid}-c`} items={options.customers} />
      <List id={`${uid}-p`} items={options.products.map((p) => p.name)} />
      <List id={`${uid}-g`} items={options.groups} />
      <List id={`${uid}-v`} items={options.vehicles} />
      <List id={`${uid}-l`} items={options.loadPlaces} />
      <List id={`${uid}-d`} items={options.destinations} />
    </form>
  );
}

/**
 * Reysdan tushgan qator: ortilgan joy, boradigan manzil, izoh va spravka nomi bitta oynada.
 * Bo'sh qoldirilgani taklifga (kulrang yozuv) qaytadi. Qolgan ustunlar (xaridordan tashqari) — katakdagi qalamcha bilan.
 */
export function NoteButton({ refKey, title, filled, suggest }: { refKey: string; title: string; filled: LogFields; suggest: LogFields }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <IconButton icon={Pencil} label="Ortilgan joy, manzil, izoh" onClick={() => setOpen(true)} className="h-6 w-6" />
      {open && <NoteDialog refKey={refKey} title={title} filled={filled} suggest={suggest} onClose={close} />}
    </>
  );
}

function NoteDialog({ refKey, title, filled, suggest, onClose }: { refKey: string; title: string; filled: LogFields; suggest: LogFields; onClose: () => void }) {
  const uid = useId();
  const options = useOptions();
  const [state, action, pending] = useActionState(saveRealizationNoteAction.bind(null, refKey), undefined);
  useEffect(() => { if (state?.ok) onClose(); }, [state, onClose]);
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="text-xs text-slate-500">Bo&apos;sh qoldirilgan maydonda taklif (kulrang) ko&apos;rinadi. Sana, mahsulot, miqdor, narx va boshqa ustunlar jadval katagidagi qalamcha bilan tuzatiladi (xaridor — zayavkada).</p>
      <form onSubmit={submitWith(action)} className="space-y-3">
        <Field label="Ortilgan joy (BSU / Sklad)"><Input name="loadPlace" list={`${uid}-l`} defaultValue={filled.loadPlace ?? ""} placeholder={suggest.loadPlace ?? "BSU-1, Sklad-2…"} maxLength={60} autoComplete="off" /></Field>
        <Field label="Boradigan manzil"><Input name="destination" list={`${uid}-d`} defaultValue={filled.destination ?? ""} placeholder={suggest.destination ?? ""} maxLength={200} autoComplete="off" /></Field>
        <Field label="Izoh (TTN, mashina, telefon)"><Input name="note" defaultValue={filled.note ?? ""} placeholder={suggest.note ?? ""} maxLength={300} /></Field>
        <Field label="Xaridor (spravka nomi)"><Input name="refName" defaultValue={filled.refName ?? ""} placeholder={suggest.refName ?? ""} maxLength={200} /></Field>
        <FormError error={state?.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Yopish</Button>
          <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        </div>
        <List id={`${uid}-l`} items={options.loadPlaces} />
        <List id={`${uid}-d`} items={options.destinations} />
      </form>
    </Dialog>
  );
}

/**
 * Jadval katagi + qalamcha: bosilsa katakning o'zida maydon ochiladi. Enter yoki katakdan chiqish — saqlash,
 * Escape — bekor. Tanlov (to'lov turi, o'lchov) tanlanishi bilan saqlanadi. Xato bo'lsa maydon ochiq qoladi.
 * `value` — tahrir qiymati (sana ISO, raqam to'liq), `children` — ko'rinishi; `right` — raqam ustuni (qalam chapda).
 */
export function CellEdit({ target, field, label, value, kind = "text", list, placeholder, right, children }: {
  target: string; field: string; label: string; value: string; kind?: "text" | "number" | "date" | "pay" | "unit";
  list?: CellList; placeholder?: string; right?: boolean; children?: React.ReactNode;
}) {
  const options = useOptions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const open = () => { setDraft(value); setError(undefined); setEditing(true); };
  const close = () => { setEditing(false); setError(undefined); };
  const save = (v: string) => {
    if (pending) return;
    if (v.trim() === value.trim()) { close(); return; }
    start(async () => {
      const r = await saveRealizationCellAction(target, field, v);
      if (r?.error) setError(r.error);
      else close();
    });
  };

  if (!editing) {
    return (
      // Qalamcha katak ustida chiqadi va joy egallamaydi (varaq ixcham); sensorli ekranda doim ko'rinadi
      <span className="group/cell relative block">
        {children}
        <button type="button" onClick={open} aria-label={`${label}: tahrirlash`} title={`${label} — tahrirlash`}
          className={cn("absolute top-1/2 -translate-y-1/2 rounded bg-white p-0.5 text-slate-500 opacity-0 shadow-sm ring-1 ring-slate-200 transition group-hover/cell:opacity-100 hover:bg-slate-100 hover:text-slate-900 focus-visible:opacity-100 print:hidden [@media(hover:none)]:opacity-100", right ? "left-0" : "right-0")}>
          <Pencil size={11} />
        </button>
      </span>
    );
  }

  const cls = cn("h-7 w-full min-w-24 rounded border bg-white px-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-900", error ? "border-red-400" : "border-slate-300", right && "text-right tabular");
  const keys = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Enter") { e.preventDefault(); save(draft); }
  };
  const select = (items: { value: string; label: string }[]) => (
    <select autoFocus aria-label={label} value={draft} className={cls} onKeyDown={keys} onBlur={() => { if (!pending) close(); }}
      onChange={(e) => { setDraft(e.target.value); save(e.target.value); }}>
      {items.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
    </select>
  );
  return (
    <span className="block min-w-24">
      {kind === "pay" ? select(options.pays.map((g) => ({ value: g.key, label: g.label })))
        : kind === "unit" ? select(PRODUCT_UNITS.map(([u, l]) => ({ value: u, label: l })))
        : (
          <input autoFocus aria-label={label} value={draft} disabled={pending} placeholder={placeholder} className={cls}
            type={kind === "date" ? "date" : "text"} inputMode={kind === "number" ? "decimal" : undefined} max={kind === "date" ? today() : undefined}
            list={list ? cellListId(list) : undefined} autoComplete="off"
            onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} onBlur={() => save(draft)} />
        )}
      {pending && <span className="mt-0.5 block text-[10px] text-slate-500">Saqlanmoqda…</span>}
      {error && <span role="alert" className="mt-0.5 block text-[10px] leading-tight font-medium whitespace-normal text-red-600">{error}</span>}
    </span>
  );
}
