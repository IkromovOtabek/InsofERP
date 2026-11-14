"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDownToLine, CheckCircle2, Coins, Factory, Lock, MapPin, PackageCheck, Pencil, Truck } from "lucide-react";
import { addTripCost, closeTrip, driverStep, markDelivered, markLoaded, markOnRoad, reportIssue, resolveIssue, saveTripTtn } from "../actions";
import type { DriverStep } from "@/lib/trip-dispatch";
import type { ActionState } from "@/lib/action";
import { isAccessDenied } from "@/lib/access-denied";
import { Button, FormError, FormSuccess, IconButton, InfoButton, Input, Select } from "@/components/ui";

const ISSUE_OPTS: [string, string][] = [
  ["BREAKDOWN", "Mashina buzildi"], ["TRAFFIC", "Tirbandlik / yo'l yopiq"], ["SITE_NOT_READY", "Obyekt tayyor emas"],
  ["QUALITY", "Sifat / hajm e'tirozi"], ["ACCIDENT", "YTH (avariya)"], ["DECLINED", "Haydovchi rad etdi"], ["OTHER", "Boshqa"],
];

/** TTN raqami: ko'rinadi, ruxsati borga qalam bilan yoziladi/tuzatiladi (bo'sh saqlansa — olib tashlanadi). */
export function TtnForm({ tripId, ttn, canEdit }: { tripId: string; ttn: string | null; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveTripTtn.bind(null, tripId), undefined);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  if (!open) {
    return (
      <span className="inline-flex items-center gap-1">
        TTN: {ttn ? <b className="tabular text-slate-900">{ttn}</b> : <span className="text-slate-400">kiritilmagan</span>}
        {canEdit && <IconButton icon={Pencil} label="TTN raqamini tahrirlash" onClick={() => setOpen(true)} className="h-6 w-6" />}
      </span>
    );
  }
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-1.5">
      <span>TTN:</span>
      <Input name="ttn" defaultValue={ttn ?? ""} maxLength={40} autoFocus autoComplete="off" placeholder="Raqam" className="h-8 w-36 text-sm tabular"
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      <Button size="sm" disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
      {state?.error && <span className="w-full"><FormError error={state.error} /></span>}
    </form>
  );
}

/** Muammo qayd etish — dispetcher (haydovchi ilovadan yuboradi). */
export function ReportIssueForm({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState(reportIssue.bind(null, tripId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <Select name="kind" defaultValue="OTHER" className="h-9 w-52 text-sm">{ISSUE_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      <Input name="note" placeholder="Tafsilot" className="h-9 min-w-[14rem] flex-1 text-sm" />
      <Button size="sm" variant="secondary" disabled={pending}><AlertTriangle size={14} /> Muammo qayd etish</Button>
      <div className="w-full"><FormError error={state?.error} /></div>
    </form>
  );
}

export function ResolveIssueForm({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(resolveIssue.bind(null, issueId), undefined);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-emerald-700 hover:underline">Hal qilindi…</button>;
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-1.5">
      <Input name="resolution" placeholder="Qanday hal qilindi" className="h-8 w-56 text-xs" autoFocus required />
      <Button size="sm" variant="success" className="h-8" disabled={pending}><CheckCircle2 size={13} /> Saqlash</Button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">Bekor</button>
      <FormError error={state?.error} />
    </form>
  );
}

/** Reysni yopish (TZ oxirgi qadami): qabul qilingan / qaytarilgan miqdor tasdiqlanadi. */
export function CloseTripForm({ tripId, loaded, accepted, returned }: { tripId: string; loaded: number; accepted: number | null; returned: number | null }) {
  const [state, action, pending] = useActionState(closeTrip.bind(null, tripId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-xs text-slate-500">Qabul qilindi<Input name="acceptedQty" type="number" step="0.001" min="0" defaultValue={accepted ?? loaded} className="mt-1 h-9 w-28 text-sm" /></label>
      <label className="flex flex-col text-xs text-slate-500">Qaytarildi<Input name="returnedQty" type="number" step="0.001" min="0" defaultValue={returned ?? ""} placeholder="0" className="mt-1 h-9 w-24 text-sm" /></label>
      <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-slate-500">Izoh<Input name="comment" className="mt-1 h-9 text-sm" /></label>
      <Button size="sm" disabled={pending}><Lock size={14} /> Reysni yopish</Button>
      <div className="w-full"><FormError error={state?.error} /><FormSuccess text={state?.note} /></div>
    </form>
  );
}

const COST_OPTS: [string, string][] = [["FUEL", "Yoqilg'i"], ["DRIVER_PAY", "Haydovchi haqi"], ["ROAD", "Yo'l to'lovi"], ["REPAIR", "Ta'mirlash"], ["PARTS", "Ehtiyot qism / moy"], ["PARKING", "Turargoh"], ["FINE", "Jarima"], ["WASH", "Yuvish"], ["OTHER", "Boshqa"]];

/** Reys xarajati — transport va haydovchi reysdan olinadi. «Dizel + metan» transportda yoqilg'i turi tanlanadi. */
export function TripCostForm({ tripId, lastPrice, dualFuel = false }: { tripId: string; lastPrice: number | null; dualFuel?: boolean }) {
  const [state, action, pending] = useActionState(addTripCost.bind(null, tripId), undefined);
  const [what, setWhat] = useState("FUEL");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <Select name="what" value={what} onChange={(e) => setWhat(e.target.value)} className="h-9 w-44 text-sm">{COST_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      {what === "FUEL" ? (
        <>
          {dualFuel && (
            <Select name="fuelType" defaultValue="" required className="h-9 w-28 text-sm">
              <option value="">— turi —</option><option value="DIESEL">Dizel</option><option value="METHANE">Metan</option>
            </Select>
          )}
          <Input name="liters" type="number" step="0.01" min="0" placeholder="litr" className="h-9 w-20 text-sm" required />
          <Input name="pricePerL" type="number" step="0.01" min="0" placeholder="narx/l" defaultValue={lastPrice ?? ""} className="h-9 w-24 text-sm" required />
          <Input name="odometerKm" type="number" min="0" placeholder="probeg" className="h-9 w-24 text-sm" />
        </>
      ) : <Input name="amount" type="number" step="0.01" min="0" placeholder="summa, so'm" className="h-9 w-32 text-sm" required />}
      <Input name="note" placeholder="izoh" className="h-9 min-w-[8rem] flex-1 text-sm" />
      <Button size="sm" variant="secondary" disabled={pending}><Coins size={14} /> Qo'shish</Button>
      <div className="w-full"><FormError error={state?.error} /></div>
    </form>
  );
}

/** "Yuklandi" — ishlab chiqarish. Qoldiq yetmasa sabab tugma yonida chiqadi. */
export function LoadButton({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState(markLoaded.bind(null, tripId), undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button disabled={pending}><PackageCheck size={16} /> Yuklandi</Button>
      {state?.error && <span className="max-w-xs text-right text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** Haydovchi ilovasidagi tugma nomlari — dispetcher aynan shularni bosadi. */
const STEP_UI: Record<DriverStep | "onroad", { label: string; icon: typeof Truck }> = {
  loaded: { label: "Yukladim", icon: PackageCheck },
  onroad: { label: "Yo'lga chiqdim", icon: Truck },
  arrived: { label: "Yetib keldim", icon: MapPin },
  unloading: { label: "Tushirishni boshladim", icon: ArrowDownToLine },
  returned: { label: "Zavodga qaytdim", icon: Factory },
};

/** Haydovchi o'rniga bitta bosqich («Yetkazdim» — alohida forma, `DriverDeliverForm`). */
export function DriverStepButton({ tripId, step }: { tripId: string; step: DriverStep | "onroad" }) {
  const [state, action, pending] = useActionState(step === "onroad" ? markOnRoad.bind(null, tripId) : driverStep.bind(null, tripId, step), undefined);
  const { label, icon: Icon } = STEP_UI[step];
  return (
    <form action={action} className="flex flex-col gap-1">
      <Button variant="secondary" disabled={pending}><Icon size={16} /> {pending ? "Saqlanmoqda…" : label}</Button>
      {state?.error && <span className="max-w-xs text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/**
 * «Yetkazdim» haydovchi o'rniga: qabul qilgan kishi, qabul / qaytgan miqdor, mikserda aylantirish soni.
 * Saqlangach `ledgerHref` bo'lsa — shu mashinaning Hisob varag'i reys qatori tahriri bilan ochiladi.
 * Yuborish `onSubmit` orqali: xato qaytsa yozilgan qiymatlar o'chmasin.
 */
export function DriverDeliverForm({ tripId, loaded, unit, mixer, ledgerHref }: { tripId: string; loaded: number; unit: string; mixer: boolean; ledgerHref: string | null }) {
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();
  const router = useRouter();
  // Amal to'g'ridan-to'g'ri chaqiriladi: javob bilan kelgan yangilanishda reys «Yetkazildi» bo'lib bu forma yo'qoladi,
  // shuning uchun Hisob varag'iga o'tish effektda emas, shu yerda — natija kelishi bilan
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        const res = await markDelivered(tripId, undefined, fd);
        setState(res);
        if (res?.ok && ledgerHref) router.push(ledgerHref);
      } catch (err) {
        setState({ error: isAccessDenied(err) ? "Bu amal uchun ruxsatingiz yo'q — direktordan ruxsat so'rang" : "Amal bajarilmadi — sahifani yangilab qayta urining" });
      }
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-slate-500">Qabul qildi (F.I.O.) *<Input name="receiverName" className="mt-1 h-9 text-sm" required /></label>
      <label className="flex flex-col text-xs text-slate-500">Qabul{unit ? `, ${unit}` : ""}<Input name="acceptedQty" type="number" step="0.001" min="0" defaultValue={loaded} className="mt-1 h-9 w-28 text-sm" /></label>
      <label className="flex flex-col text-xs text-slate-500">Qaytdi{unit ? `, ${unit}` : ""}<Input name="returnedQty" type="number" step="0.001" min="0" placeholder="0" className="mt-1 h-9 w-24 text-sm" /></label>
      {mixer && <label className="flex flex-col text-xs text-slate-500">Mikser aylantirildi<Input name="drumTurns" type="number" step="1" min="0" max="500" placeholder="marta" className="mt-1 h-9 w-28 text-sm" /></label>}
      <label className="flex min-w-[10rem] flex-1 flex-col text-xs text-slate-500">Izoh<Input name="comment" className="mt-1 h-9 text-sm" /></label>
      <Button size="sm" variant="success" disabled={pending || (state?.ok && !!ledgerHref)}><PackageCheck size={14} /> {pending ? "Saqlanmoqda…" : "Yetkazdim"}</Button>
      {ledgerHref && <InfoButton title="Yetkazdim" className="mb-1.5">Saqlangach Hisob varag&apos;i ochiladi: km, baraban soati, zapravka, xarajat va haydovchi haqini shu yerda yozasiz.</InfoButton>}
      <div className="w-full">
        <FormError error={state?.error} />
        {state?.ok && ledgerHref && <FormSuccess text="Yetkazildi — Hisob varag'i ochilmoqda…" />}
      </div>
    </form>
  );
}
