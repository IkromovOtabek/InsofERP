"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, ChevronDown, ChevronUp, Clock, HandCoins, Pencil, X } from "lucide-react";
import { approveTripPaysAction, createMasterPayAction, priceSuggestedAction, priceTripAction, rejectTripPayAction, saveDriverTariff } from "../actions";
import { Button, Field, FormActions, FormError, FormSuccess, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";

/** To'lov turi tanlovi: naqd — kassa beradi, oylik — vedomostga tushadi (ikkalasi ham ish boshqaruvchi tasdig'idan keyin). */
function PayTypeSelect({ value, className }: { value?: string | null; className?: string }) {
  return (
    <Select name="payType" defaultValue={value ?? ""} required className={className} aria-label="To'lov turi">
      <option value="" disabled>To&apos;lov turi</option>
      <option value="PAYROLL">Oylik</option>
      <option value="CASH">Naqd</option>
    </Select>
  );
}

/** Bitta reysga narx: taklif oldindan yozilgan, dispetcher tasdiqlaydi yoki o'zgartiradi. Narxlangan reysni tuzatish — sabab bilan. */
export function PriceForm({ tripId, suggested, amount, payType }: { tripId: string; suggested: number; amount: number | null; payType?: string | null }) {
  const [state, action, pending] = useActionState(priceTripAction.bind(null, tripId), undefined);
  const [edit, setEdit] = useState(amount == null);
  if (!edit) {
    return (
      <button type="button" onClick={() => setEdit(true)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
        <Pencil size={12} /> Tuzatish
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-1.5">
      <Input name="amount" type="number" min="0" step="1000" defaultValue={amount ?? suggested} className="h-8 w-28 text-right tabular" aria-label="Reys haqi" required />
      <PayTypeSelect value={payType} className="h-8 w-28 py-0 text-sm" />
      {amount != null && <Input name="note" placeholder="Sabab" className="h-8 w-32" required />}
      <Button size="sm" variant="success" disabled={pending} title="Narxni tasdiqlash"><Check size={14} /></Button>
      {state?.error && <div className="w-full text-right text-xs text-red-700">{state.error}</div>}
    </form>
  );
}

/** Ko'rinib turgan narxsiz reyslarning hammasiga taklif narxini qo'yish. */
export function PriceAllButton({ ids }: { ids: string[] }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionState>(undefined);
  const [type, setType] = useState("");
  return (
    <div className="flex items-center gap-2">
      {res?.error && <span className="text-xs text-red-700">{res.error}</span>}
      <Select value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-32 py-0 text-sm" aria-label="To'lov turi">
        <option value="" disabled>To&apos;lov turi</option>
        <option value="PAYROLL">Oylik</option>
        <option value="CASH">Naqd</option>
      </Select>
      <Button size="sm" variant="secondary" disabled={pending || !ids.length || !type}
        onClick={() => { if (confirm(`${ids.length} ta reysga tarif bo'yicha taklif narxi (${type === "CASH" ? "naqd" : "oylik"}) qo'yilsinmi?`)) start(async () => setRes(await priceSuggestedAction(ids, type))); }}>
        <Check size={14} /> Hammasiga taklifni qo'yish
      </Button>
    </div>
  );
}

export type TariffValue = { drvTripRate: number; drvKmRate: number; drvWaitHourRate: number };

export function TariffForm({ v }: { v: TariffValue }) {
  const [state, action, pending] = useActionState(saveDriverTariff, undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-3">
      <div className="sm:col-span-3"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Saqlandi — yangi reyslar taklifi shu tarif bilan" />}</div>
      <Field label="Har reys uchun, so'm" hint="Qat'iy summa (bo'lmasa 0)"><Input name="drvTripRate" type="number" min="0" step="1000" defaultValue={v.drvTripRate} required /></Field>
      <Field label="1 km uchun, so'm" hint="Zavod → obyekt → zavod"><Input name="drvKmRate" type="number" min="0" step="100" defaultValue={v.drvKmRate} required /></Field>
      <Field label="Mikser kutish, so'm / soat" hint="Obyektga kelgandan tushirish boshlanguncha"><Input name="drvWaitHourRate" type="number" min="0" step="1000" defaultValue={v.drvWaitHourRate} required /></Field>
      <div className="sm:col-span-3"><FormActions><Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Tarifni saqlash"}</Button></FormActions></div>
    </form>
  );
}

/** Ish boshqaruvchi: bitta yoki hamma reys haqini tasdiqlash. */
export function ApproveButton({ ids, label }: { ids: string[]; label: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionState>(undefined);
  return (
    <span className="inline-flex items-center gap-2">
      {res?.error && <span className="text-xs text-red-700">{res.error}</span>}
      <Button size="sm" variant="success" disabled={pending || !ids.length}
        onClick={() => { if (ids.length === 1 || confirm(`${ids.length} ta reys haqi tasdiqlansinmi? Naqdlari kassaga, oyliklari vedomostga o'tadi.`)) start(async () => setRes(await approveTripPaysAction(ids))); }}>
        <Check size={14} /> {label}
      </Button>
    </span>
  );
}

/** Ish boshqaruvchi: rad etish (sabab bilan) — narx olib tashlanadi, dispetcher qayta qo'yadi. */
export function RejectPayForm({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState(rejectTripPayAction.bind(null, tripId), undefined);
  const [open, setOpen] = useState(false);
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><X size={14} /> Rad</Button>;
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center justify-end gap-1.5">
      <Input name="reason" placeholder="Rad etish sababi" className="h-8 w-44" required minLength={3} autoFocus />
      <Button size="sm" variant="danger" disabled={pending}>Rad etish</Button>
      {state?.error && <div className="w-full text-right text-xs text-red-700">{state.error}</div>}
    </form>
  );
}

/**
 * Dispetcher: remont usta puli (ta'mir, vulkanizatsiya, zapchast). «Joyida berish» — ish boshqaruvchi va kassaga;
 * «N kunda berish» — muddat kuni tasdiqqa o'tadi, «<usta> ga remont puli berish vaqti keldi» eslatmasi keladi.
 */
export function MasterPayForm({ vehicles, payees, problems }: { vehicles: { id: string; plate: string }[]; payees: string[]; problems: readonly string[] }) {
  const [state, action, pending] = useActionState(createMasterPayAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <Field label="Transport"><Select name="vehicleId" defaultValue="" required><option value="" disabled>Tanlang</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}</Select></Field>
      <Field label="Turi"><Select name="problem" defaultValue={problems[0]} required>{problems.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
      <Field label="Usta ismi">
        <Input name="payee" list="usta-list" placeholder="Masalan: Akmal usta" required minLength={2} />
        <datalist id="usta-list">{payees.map((p) => <option key={p} value={p} />)}</datalist>
      </Field>
      <Field label="Summa, so'm"><Input name="amount" type="number" min="1000" step="1000" required className="text-right tabular" /></Field>
      <Field label="Izoh" className="lg:col-span-2"><Input name="note" placeholder="Nima qilindi" maxLength={300} /></Field>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-6">
        <Button name="mode" value="now" disabled={pending}><HandCoins size={15} /> Joyida berish</Button>
        <span className="mx-1 text-sm text-slate-400">yoki</span>
        <Input name="days" type="number" min="1" max="365" placeholder="Necha kun" className="w-28 text-right tabular" aria-label="Necha kunda berish" />
        <Button name="mode" value="later" variant="secondary" disabled={pending}><Clock size={15} /> N kunda berish</Button>
        <div className="basis-full"><FormError error={state?.error} />{state?.ok && <FormSuccess text={state.note ?? "Yuborildi — ish boshqaruvchi tasdig'ini kutmoqda"} />}</div>
      </div>
    </form>
  );
}

/**
 * Uzun jadvalni yig'ib turish: yopiqda faqat birinchi 5 qator (eskisi oldin), tugma bilan hammasi.
 * Qatorlar serverda bir marta chiziladi — yashirish CSS bilan, narx formalari holatini yo'qotmaydi.
 */
export function TopRows({ total, children }: { total: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const top = 5; // CSS dagi nth-child(n+6) bilan bir xil
  if (total <= top) return <>{children}</>;
  return (
    <div>
      <div data-open={open} className="[&[data-open=false]_tbody>tr:nth-child(n+6)]:hidden">{children}</div>
      <div className="border-t border-slate-100 px-5 py-2.5 text-center">
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? <><ChevronUp size={14} /> Yig&apos;ish (birinchi {top} tasi)</> : <><ChevronDown size={14} /> Barchasini ochish ({total} ta, yana {total - top})</>}
        </Button>
      </div>
    </div>
  );
}
