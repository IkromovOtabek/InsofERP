"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import { createLedgerRowAction, fixTripKmAction } from "../actions";
import { today } from "@/lib/davomat";
import { fmtNum } from "@/lib/format";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";

/**
 * Yuborish — `onSubmit` + `startTransition`: `<form action>` bo'lsa React 19 xato bilan qaytgan amaldan keyin ham formani
 * tozalaydi va yozilgan qiymatlar yo'qoladi (`realizatsiya/forms.tsx` dagi kabi).
 */
const submitWith = (action: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  startTransition(() => action(fd));
};

export type LedgerVehicle = {
  id: string; plate: string; driverId: string | null; unit: string;
  /** Kuzatiladigan yoqilg'i normasi: 100 km ga va baraban soatiga (metan m³ yoki dizel l) */
  per100: number; perHour: number; lastPrice: number | null;
};
export type LedgerOptions = {
  vehicles: LedgerVehicle[]; drivers: { id: string; name: string }[];
  pickups: string[]; dropoffs: string[]; cargos: string[];
};

const num = (v: string) => Number(v.replace(",", ".")) || 0;

/**
 * Hisob varag'iga qo'lda qator — ECO'ga tushmagan reys (Excel'dagi ustunlar tartibida). Transport — ochiq varaqniki,
 * haydovchi — transportning asosiy haydovchisi (o'zgartirish mumkin). Zapravka va xarajatlar shu qator bilan birga
 * yoziladi; haq ish boshqaruvchi tasdig'iga boradi. Saqlangach forma ochiq qoladi — keyingi qatorni darhol yozish uchun.
 */
export function LedgerRowForm({ options, vehicleId, clientToken }: { options: LedgerOptions; vehicleId: string | null; clientToken: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button onClick={() => setOpen(true)}><Plus size={16} /> Qator qo&apos;shish</Button>;
  return <RowForm options={options} vehicleId={vehicleId} clientToken={clientToken} onClose={() => setOpen(false)} />;
}

function RowForm({ options, vehicleId, clientToken, onClose }: { options: LedgerOptions; vehicleId: string | null; clientToken: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(createLedgerRowAction, undefined);
  const router = useRouter();
  // Saqlangach forma qayta chiziladi (bo'sh holatga, transport va sana qoladi) va yangi bir martalik kalit olinadi
  const [round, setRound] = useState(0);
  const [token, setToken] = useState(clientToken);
  const [vid, setVid] = useState(vehicleId ?? "");
  const [date, setDate] = useState(today());
  useEffect(() => { if (state?.ok) { setRound((n) => n + 1); setToken(crypto.randomUUID()); router.refresh(); } }, [state, router]);
  const v = options.vehicles.find((x) => x.id === vid) ?? null;
  return (
    <div className="space-y-3 rounded-(--radius-card) border border-slate-200 bg-white p-4 shadow-(--shadow-card)">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Qo&apos;lda qator{v ? ` — ${v.plate}` : ""}</h3>
          <p className="text-xs text-slate-500">ECO&apos;ga tushmagan reys. Zapravka va xarajat shu mashinaga yoziladi, haq ish boshqaruvchi tasdig&apos;iga boradi.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
      </div>
      {state?.ok && <FormSuccess text={state.note ?? "Qo'shildi"} />}
      <FormError error={state?.error} />
      <RowFields key={round} options={options} v={v} vid={vid} setVid={setVid} date={date} setDate={setDate} token={token} action={action} pending={pending} />
      <datalist id="ledger-pickups">{options.pickups.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="ledger-dropoffs">{options.dropoffs.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="ledger-cargos">{options.cargos.map((x) => <option key={x} value={x} />)}</datalist>
    </div>
  );
}

function RowFields({ options, v, vid, setVid, date, setDate, token, action, pending }: {
  options: LedgerOptions; v: LedgerVehicle | null; vid: string; setVid: (id: string) => void; date: string; setDate: (d: string) => void;
  token: string; action: (fd: FormData) => void; pending: boolean;
}) {
  const [driver, setDriver] = useState(v?.driverId ?? "");
  const [km, setKm] = useState("");
  const [hours, setHours] = useState("");
  const [pay, setPay] = useState("");
  const [revenue, setRevenue] = useState("");
  // Norma bo'yicha sarf — jadvaldagidek: km × 100 km normasi + baraban soati × soat normasi
  const use = v && (v.per100 || v.perHour) ? (num(km) * v.per100) / 100 + num(hours) * v.perHour : null;
  return (
    <form onSubmit={submitWith(action)} className="space-y-3">
      <input type="hidden" name="clientToken" value={token} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 [&>*]:min-w-0">
        <Field label="Sana *"><Input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={today()} required /></Field>
        <Field label="Transport *">
          <Select name="vehicleId" value={vid} required onChange={(e) => { setVid(e.target.value); const d = options.vehicles.find((x) => x.id === e.target.value)?.driverId; if (d) setDriver(d); }}>
            <option value="" disabled>Tanlang</option>
            {options.vehicles.map((x) => <option key={x.id} value={x.id}>{x.plate}</option>)}
          </Select>
        </Field>
        <Field label="Haydovchi" className="col-span-2">
          <Select name="driverId" value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="">—</option>{options.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Yuklash joyi"><Input name="pickup" list="ledger-pickups" placeholder="Zavod" maxLength={120} /></Field>
        <Field label="Reys soni"><Input name="trips" type="number" min="0" max="1000" step="1" defaultValue="1" className="text-right tabular" /></Field>

        <Field label="Tushirish joyi *" className="col-span-2"><Input name="dropoff" list="ledger-dropoffs" placeholder="Obyekt yoki mijoz" required minLength={3} maxLength={160} /></Field>
        <Field label="Yuk" className="col-span-2"><Input name="cargo" list="ledger-cargos" placeholder="M-250 10 m³" maxLength={120} /></Field>
        <Field label="Probeg, km"><Input name="km" type="number" min="0" step="0.1" value={km} onChange={(e) => setKm(e.target.value)} className="text-right tabular" /></Field>
        <Field label="Baraban, soat"><Input name="drumHours" type="number" min="0" max="24" step="0.1" value={hours} onChange={(e) => setHours(e.target.value)} className="text-right tabular" /></Field>

        <Field label={`Zapravka, ${v?.unit ?? "m³ / l"}`}><Input name="refuel" type="number" min="0" max="1000" step="0.1" className="text-right tabular" /></Field>
        <Field label="Zapravka narxi" hint={v?.lastPrice ? `bo'sh — ${fmtNum(v.lastPrice, 0)}` : undefined}><Input name="fuelPrice" type="number" min="0" step="0.01" placeholder={v?.lastPrice ? String(v.lastPrice) : ""} className="text-right tabular" /></Field>
        <Field label="Ta'mir (usta)"><Input name="repair" type="number" min="0" step="1000" className="text-right tabular" /></Field>
        <Field label="Zapchast"><Input name="parts" type="number" min="0" step="1000" className="text-right tabular" /></Field>
        <Field label="Vulkanizator"><Input name="vulc" type="number" min="0" step="1000" className="text-right tabular" /></Field>
        <div className="flex items-end pb-2 text-xs text-slate-500">{use != null ? <>Sarf (norma): <b className="ml-1 tabular text-slate-800">{fmtNum(use, 1)} {v?.unit}</b></> : null}</div>

        <Field label="Haydovchi haqi"><Input name="payAmount" type="number" min="0" step="1000" value={pay} onChange={(e) => setPay(e.target.value)} className="text-right tabular" /></Field>
        <Field label={`To'lov turi${num(pay) > 0 ? " *" : ""}`}>
          <Select name="payType" defaultValue="" required={num(pay) > 0}><option value="">—</option><option value="PAYROLL">Oylik</option><option value="CASH">Naqd</option></Select>
        </Field>
        <Field label="Kirim (bajarilgan)"><Input name="revenue" type="number" min="0" step="1000" value={revenue} onChange={(e) => setRevenue(e.target.value)} className="text-right tabular" /></Field>
        <Field label={`Kirim turi${num(revenue) > 0 ? " *" : ""}`}>
          <Select name="revenueType" defaultValue="" required={num(revenue) > 0}><option value="">—</option><option value="BANK">P/R</option><option value="CASH">N/L</option><option value="OBJECT">Obyekt</option></Select>
        </Field>
        <Field label="Izoh" className="col-span-2"><Input name="note" placeholder="Tun 22:30, 3 soat kutdi…" maxLength={300} /></Field>
      </div>
      <Button disabled={pending}><Plus size={15} /> {pending ? "Saqlanmoqda…" : "Qatorni qo'shish"}</Button>
    </form>
  );
}

/**
 * Reys qatorida km va baraban soati: ECO bermagan (0 / bo'sh) bo'lsa sariq, qalam bilan qo'lda yoziladi.
 * Narxi qo'yilmagan reysda taklif ham yangi km bilan qayta hisoblanadi.
 */
export function KmFix({ tripId, km, hours, children }: { tripId: string; km: number; hours: number | null; children: React.ReactNode }) {
  const [edit, setEdit] = useState(false);
  const [state, action, pending] = useActionState(fixTripKmAction.bind(null, tripId), undefined);
  const router = useRouter();
  useEffect(() => { if (state?.ok) { setEdit(false); router.refresh(); } }, [state, router]);
  if (!edit) {
    return (
      <button type="button" onClick={() => setEdit(true)} title="Km va baraban soatini qo'lda yozish" className="group inline-flex items-center gap-1 hover:underline">
        {children}<Pencil size={11} className="text-slate-300 group-hover:text-slate-600" />
      </button>
    );
  }
  return (
    <form onSubmit={submitWith(action)} className="flex items-center justify-end gap-1">
      <Input name="km" type="number" min="0" step="0.1" defaultValue={km || ""} placeholder="km" className="h-7 w-16 px-1.5 text-right text-xs tabular" aria-label="Km" autoFocus />
      <Input name="hours" type="number" min="0" max="24" step="0.1" defaultValue={hours ?? ""} placeholder="soat" className="h-7 w-14 px-1.5 text-right text-xs tabular" aria-label="Baraban soati" />
      <Button size="sm" variant="success" disabled={pending} className="h-7 px-1.5" title="Saqlash"><Check size={13} /></Button>
      <button type="button" onClick={() => setEdit(false)} className="p-1 text-slate-400 hover:text-slate-900" aria-label="Bekor"><X size={13} /></button>
      {state?.error && <span className="basis-full text-right text-[11px] text-red-700">{state.error}</span>}
    </form>
  );
}
