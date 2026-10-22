"use client";

import { useActionState, useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { Button, Field, FormActions, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { isoDate } from "@/lib/format";
import {
  addRentPriceChange, addRentPriceChangeBulk, endRentLeaseAction, saveRentKwhPrice, startRentLeaseAction, uploadRentFiles,
} from "./actions";

type Month = { key: string; label: string };
const num = (v: number) => (v ? String(v) : "");

/**
 * «Ijaraga berish» (bo'sh joy) yoki «Ijarachini almashtirish»: yangi ijarachi, shartnoma muddati, zaklad va narx.
 * Almashtirishda amaldagi shartnoma yangi ijara boshlanishidan bir kun oldin yopiladi — eski ijarachi qarzi o'zida qoladi.
 */
export function LeaseForm({ shopId, replace, daily, defaults }: {
  shopId: string; replace: boolean; daily: boolean;
  defaults: { bankAmount: number; cashAmount: number; payDay: number | null };
}) {
  const [state, action, pending] = useActionState(startRentLeaseAction.bind(null, shopId), undefined);
  const per = daily ? "kunlik" : "oylik";
  if (state?.ok) return <FormSuccess text={state.note ?? "Saqlandi"} />;
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Ijarachi (F.I.O. / mas'ul) *" className="sm:col-span-2"><Input name="tenantName" required placeholder="Masalan: Vaxabjanova Nigora" /></Field>
        <Field label="Telefon *"><Input name="phone" type="tel" required placeholder="+998 90 123 45 67" /></Field>
        <Field label="INN / JShShIR"><Input name="inn" inputMode="numeric" /></Field>
        <Field label="Ijara boshlanishi *" hint={replace ? "eski shartnoma bir kun oldin yopiladi" : undefined}><Input name="startDate" type="date" defaultValue={isoDate()} required /></Field>
        <Field label="Shartnoma tugashi" hint="bo'sh — muddatsiz"><Input name="endDate" type="date" /></Field>
        <Field label="Shartnoma №"><Input name="contractNo" placeholder="Masalan: 12/2026" /></Field>
        <Field label="Zaklad (garov)" hint="ma'lumot uchun, kassaga kirmaydi"><MoneyInput name="deposit" /></Field>
        <Field label={`Perechisleniye (${per})`}><MoneyInput name="bankAmount" defaultValue={num(defaults.bankAmount)} /></Field>
        <Field label={`Naqd (${per})`}><MoneyInput name="cashAmount" defaultValue={num(defaults.cashAmount)} /></Field>
        {!daily && (
          <Field label="To'lov kuni *" hint="har oyning shu sanasigacha">
            <Select name="payDay" defaultValue={defaults.payDay ? String(defaults.payDay) : ""} required>
              <option value="">Tanlang…</option>
              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}-sana</option>)}
            </Select>
          </Field>
        )}
        <Field label="Izoh" className={daily ? "sm:col-span-2" : undefined}><Input name="leaseNote" placeholder="Kelishuv shartlari…" /></Field>
      </div>
      <FormActions><Button disabled={pending}>{pending ? "Saqlanmoqda…" : replace ? "Ijarachini almashtirish" : "Ijaraga berish"}</Button></FormActions>
    </form>
  );
}

/** Joyni bo'shatish: amaldagi shartnoma yopiladi, qarz bo'lsa ijarachi «sobiq» bo'lib qoladi. */
export function EndLeaseForm({ shopId }: { shopId: string }) {
  const [state, action, pending] = useActionState(endRentLeaseAction.bind(null, shopId), undefined);
  if (state?.ok) return <FormSuccess text={state.note ?? "Saqlandi"} />;
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Chiqib ketgan sana *"><Input name="endedAt" type="date" defaultValue={isoDate()} required /></Field>
        <Field label="Sabab"><Input name="reason" placeholder="Shartnoma tugadi, o'zi ketdi…" /></Field>
      </div>
      <FormActions><Button variant="danger" disabled={pending}>{pending ? "Saqlanmoqda…" : "Joyni bo'shatish"}</Button></FormActions>
    </form>
  );
}

/** Bitta do'kon uchun «X oydan yangi narx» — o'sha oy hisobi ochilganda qo'llanadi. */
export function PriceChangeForm({ shopId, months, daily, current }: { shopId: string; months: Month[]; daily: boolean; current: { bankAmount: number; cashAmount: number } }) {
  const [state, action, pending] = useActionState(addRentPriceChange.bind(null, shopId), undefined);
  const [key, setKey] = useState(0);
  useEffect(() => { if (state?.ok) setKey((k) => k + 1); }, [state]);
  const per = daily ? "kunlik" : "oylik";
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <div key={key} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Qaysi oydan *"><Select name="fromMonth" defaultValue={months[0]?.key}>{months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select></Field>
        <Field label="Izoh"><Input name="note" placeholder="Masalan: yillik oshirish" /></Field>
        <Field label={`Yangi perechisleniye (${per})`}><MoneyInput name="bankAmount" defaultValue={num(current.bankAmount)} /></Field>
        <Field label={`Yangi naqd (${per})`}><MoneyInput name="cashAmount" defaultValue={num(current.cashAmount)} /></Field>
      </div>
      <FormActions><Button variant="secondary" disabled={pending}>{pending ? "Saqlanmoqda…" : "Rejalashtirish"}</Button></FormActions>
    </form>
  );
}

/** Butun bozor (joy) bo'yicha narxni % ga o'zgartirish — ijaradagi har do'kon uchun alohida rejalashtiriladi. */
export function BulkPriceForm({ locations, months }: { locations: string[]; months: Month[] }) {
  const [state, action, pending] = useActionState(addRentPriceChangeBulk, undefined);
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Joy (bozor) *"><Select name="location" defaultValue={locations[0]}>{locations.map((l) => <option key={l} value={l}>{l}</option>)}</Select></Field>
        <Field label="Qaysi oydan *"><Select name="fromMonth" defaultValue={months[0]?.key}>{months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select></Field>
        <Field label="O'zgarish, % *" hint="oshirish 10, kamaytirish −5"><Input name="percent" type="number" step="0.1" required placeholder="10" /></Field>
        <Field label="Izoh"><Input name="note" placeholder="Yillik indeksatsiya" /></Field>
      </div>
      <FormActions><Button variant="secondary" disabled={pending}>{pending ? "Saqlanmoqda…" : "Narxni rejalashtirish"}</Button></FormActions>
    </form>
  );
}

/** Hujjat / surat yuklash (bir nechta fayl). */
export function FileUploadForm({ shopId, kinds, accept, maxMb }: { shopId: string; kinds: readonly string[]; accept: string; maxMb: number }) {
  const [state, action, pending] = useActionState(uploadRentFiles.bind(null, shopId), undefined);
  const [key, setKey] = useState(0);
  useEffect(() => { if (state?.ok) setKey((k) => k + 1); }, [state]);
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <div key={key} className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Turi"><Select name="kind" defaultValue={kinds[0]}>{kinds.map((k) => <option key={k} value={k}>{k}</option>)}</Select></Field>
        <Field label="Fayl(lar)" hint={`PDF yoki rasm, har biri ${maxMb} MB gacha`}><Input name="files" type="file" accept={accept} multiple required className="pt-1.5" /></Field>
      </div>
      <FormActions><Button variant="secondary" disabled={pending}><Upload size={15} /> {pending ? "Yuklanmoqda…" : "Yuklash"}</Button></FormActions>
    </form>
  );
}

/** 1 kVt·soat svet narxi — hisoblagich ko'rsatkichidan summa shu narxda hisoblanadi. */
export function KwhPriceForm({ price }: { price: number }) {
  const [state, action, pending] = useActionState(saveRentKwhPrice, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="text-sm text-slate-600">
        <span className="mb-1 block text-xs font-medium text-slate-500">Svet tarifi — 1 kVt·soat</span>
        <MoneyInput name="price" defaultValue={num(price)} decimals={2} className="h-9 w-40" />
      </label>
      <Button size="sm" variant="secondary" disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
      <span className="basis-full text-xs text-slate-500">Jadvalda qatorni tahrirlab oy boshi va oxiri ko&apos;rsatkichini kiritsangiz, svet summasi (farq × tarif) o&apos;zi hisoblanadi. 0 — summa qo&apos;lda kiritiladi.</span>
      <div className="basis-full"><FormError error={state?.error} />{state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}</div>
    </form>
  );
}
