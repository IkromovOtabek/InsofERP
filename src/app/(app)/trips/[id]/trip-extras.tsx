"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Coins, Lock, PackageCheck, Truck } from "lucide-react";
import { addTripCost, closeTrip, markDelivered, markLoaded, markOnRoad, reportIssue, resolveIssue } from "../actions";
import { Button, FormError, FormSuccess, Input, Select } from "@/components/ui";

const ISSUE_OPTS: [string, string][] = [
  ["BREAKDOWN", "Mashina buzildi"], ["TRAFFIC", "Tirbandlik / yo'l yopiq"], ["SITE_NOT_READY", "Obyekt tayyor emas"],
  ["QUALITY", "Sifat / hajm e'tirozi"], ["ACCIDENT", "YTH (avariya)"], ["DECLINED", "Haydovchi rad etdi"], ["OTHER", "Boshqa"],
];

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
      <label className="flex flex-col text-xs text-slate-500">Qabul qilindi<Input name="acceptedQty" inputMode="decimal" defaultValue={accepted ?? loaded} className="mt-1 h-9 w-28 text-sm" /></label>
      <label className="flex flex-col text-xs text-slate-500">Qaytarildi<Input name="returnedQty" inputMode="decimal" defaultValue={returned ?? ""} placeholder="0" className="mt-1 h-9 w-24 text-sm" /></label>
      <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-slate-500">Izoh<Input name="comment" className="mt-1 h-9 text-sm" /></label>
      <Button size="sm" disabled={pending}><Lock size={14} /> Reysni yopish</Button>
      <div className="w-full"><FormError error={state?.error} /><FormSuccess text={state?.note} /></div>
    </form>
  );
}

const COST_OPTS: [string, string][] = [["FUEL", "Yoqilg'i"], ["DRIVER_PAY", "Haydovchi haqi"], ["ROAD", "Yo'l to'lovi"], ["REPAIR", "Ta'mirlash"], ["PARTS", "Ehtiyot qism / moy"], ["PARKING", "Turargoh"], ["FINE", "Jarima"], ["WASH", "Yuvish"], ["OTHER", "Boshqa"]];

/** Reys xarajati — transport va haydovchi reysdan olinadi. */
export function TripCostForm({ tripId, lastPrice }: { tripId: string; lastPrice: number | null }) {
  const [state, action, pending] = useActionState(addTripCost.bind(null, tripId), undefined);
  const [what, setWhat] = useState("FUEL");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <Select name="what" value={what} onChange={(e) => setWhat(e.target.value)} className="h-9 w-44 text-sm">{COST_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      {what === "FUEL" ? (
        <>
          <Input name="liters" inputMode="decimal" placeholder="litr" className="h-9 w-20 text-sm" required />
          <Input name="pricePerL" inputMode="decimal" placeholder="narx/l" defaultValue={lastPrice ?? ""} className="h-9 w-24 text-sm" required />
          <Input name="odometerKm" inputMode="numeric" placeholder="probeg" className="h-9 w-24 text-sm" />
        </>
      ) : <Input name="amount" inputMode="numeric" placeholder="summa, so'm" className="h-9 w-32 text-sm" required />}
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

/** "Yo'lga chiqdi" — dispetcher vebdan (haydovchi ilovasi ishlamaganda). */
export function OnRoadButton({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState(markOnRoad.bind(null, tripId), undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button variant="secondary" disabled={pending}><Truck size={16} /> Yo&apos;lga chiqdi</Button>
      {state?.error && <span className="max-w-xs text-right text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** "Yetkazildi (dispetcher)": qabul qilgan kishi, qabul / qaytgan miqdor. GPS tasdig'isiz — reysga muammo yoziladi. */
export function DispatchDeliverForm({ tripId, loaded, unit }: { tripId: string; loaded: number; unit: string }) {
  const [state, action, pending] = useActionState(markDelivered.bind(null, tripId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-slate-500">Qabul qildi (F.I.O.) *<Input name="receiverName" className="mt-1 h-9 text-sm" required /></label>
      <label className="flex flex-col text-xs text-slate-500">Qabul, {unit}<Input name="acceptedQty" inputMode="decimal" defaultValue={loaded} className="mt-1 h-9 w-28 text-sm" /></label>
      <label className="flex flex-col text-xs text-slate-500">Qaytdi, {unit}<Input name="returnedQty" inputMode="decimal" placeholder="0" className="mt-1 h-9 w-24 text-sm" /></label>
      <label className="flex min-w-[10rem] flex-1 flex-col text-xs text-slate-500">Izoh<Input name="comment" className="mt-1 h-9 text-sm" /></label>
      <Button size="sm" variant="success" disabled={pending}><PackageCheck size={14} /> Yetkazildi (dispetcher)</Button>
      <div className="w-full"><FormError error={state?.error} /></div>
    </form>
  );
}
