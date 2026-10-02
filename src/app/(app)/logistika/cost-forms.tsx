"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addExpense, addFuel } from "./actions";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";

type Opt = { id: string; label: string };
const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ")} so'm`;

/** Zapravka: litr × narx = summa (ko'rinib turadi), probeg — sarfni hisoblash uchun. */
export function FuelForm({ vehicles, drivers, trips, lastPrice, vehicleId }: {
  vehicles: (Opt & { fuelType: string | null; driverId: string | null })[]; drivers: Opt[]; trips: (Opt & { vehicleId: string })[];
  lastPrice: number | null; vehicleId?: string;
}) {
  const [state, action, pending] = useActionState(addFuel, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [vid, setVid] = useState(vehicleId ?? vehicles[0]?.id ?? "");
  const [liters, setLiters] = useState("");
  const [price, setPrice] = useState(lastPrice ? String(lastPrice) : "");
  const v = vehicles.find((x) => x.id === vid);
  const total = Number(liters.replace(",", ".")) * Number(price.replace(",", "."));
  useEffect(() => { if (state?.ok) { ref.current?.reset(); setLiters(""); } }, [state]);
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-4 [&>*]:min-w-0">
      <div className="sm:col-span-4"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Zapravka yozildi" />}</div>
      <Field label="Transport *">
        <Select name="vehicleId" value={vid} onChange={(e) => setVid(e.target.value)}>{vehicles.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
      </Field>
      <Field label="Haydovchi">
        <Select name="driverId" key={vid} defaultValue={v?.driverId ?? ""}><option value="">—</option>{drivers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
      </Field>
      <Field label="Reys (ixtiyoriy)">
        <Select name="tripId" key={`t${vid}`} defaultValue=""><option value="">—</option>{trips.filter((t) => t.vehicleId === vid).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
      </Field>
      <Field label="Sana"><Input name="date" type="date" defaultValue={today()} /></Field>
      <Field label="Yoqilg'i turi">
        <Select name="fuelType" key={`f${vid}`} defaultValue={v?.fuelType ?? "DIESEL"}><option value="DIESEL">Dizel</option><option value="PETROL">Benzin</option><option value="METHANE">Metan</option><option value="PROPANE">Propan</option></Select>
      </Field>
      <Field label="Miqdor, litr *"><Input name="liters" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} required /></Field>
      <Field label="1 litr narxi *"><Input name="pricePerL" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required /></Field>
      <Field label="Jami"><div className="flex h-10 items-center text-sm font-semibold tabular">{Number.isFinite(total) && total > 0 ? money(total) : "—"}</div></Field>
      <Field label="Probeg, km" hint="Sarf (l/100 km) shundan"><Input name="odometerKm" inputMode="numeric" /></Field>
      <Field label="Zapravka"><Input name="station" placeholder="UzGazOil, Mustang…" /></Field>
      <Field label="Izoh" className="sm:col-span-2"><Input name="note" /></Field>
      <div className="sm:col-span-4"><Button disabled={pending || vehicles.length === 0}>{pending ? "Saqlanmoqda…" : "Zapravkani yozish"}</Button></div>
    </form>
  );
}

const KINDS: [string, string][] = [["DRIVER_PAY", "Haydovchi haqi"], ["ROAD", "Yo'l to'lovi"], ["REPAIR", "Ta'mirlash"], ["PARTS", "Ehtiyot qism / moy"], ["PARKING", "Turargoh"], ["FINE", "Jarima"], ["WASH", "Yuvish"], ["OTHER", "Boshqa"]];

/** Transport xarajati: transport, haydovchi yoki reysga bog'lanadi (reys tanlansa qolgani undan). */
export function ExpenseForm({ vehicles, drivers, trips, vehicleId }: { vehicles: Opt[]; drivers: Opt[]; trips: (Opt & { vehicleId: string })[]; vehicleId?: string }) {
  const [state, action, pending] = useActionState(addExpense, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [vid, setVid] = useState(vehicleId ?? "");
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-4 [&>*]:min-w-0">
      <div className="sm:col-span-4"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Xarajat yozildi" />}</div>
      <Field label="Turi *"><Select name="kind" defaultValue="REPAIR">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field label="Summa, so'm *"><Input name="amount" inputMode="numeric" required /></Field>
      <Field label="Sana"><Input name="date" type="date" defaultValue={today()} /></Field>
      <Field label="Transport">
        <Select name="vehicleId" value={vid} onChange={(e) => setVid(e.target.value)}><option value="">—</option>{vehicles.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
      </Field>
      <Field label="Haydovchi"><Select name="driverId" defaultValue=""><option value="">—</option>{drivers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
      <Field label="Reys (ixtiyoriy)">
        <Select name="tripId" defaultValue=""><option value="">—</option>{trips.filter((t) => !vid || t.vehicleId === vid).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
      </Field>
      <Field label="Izoh" className="sm:col-span-2"><Input name="note" placeholder="Nima uchun: shina almashtirish, jarima raqami…" /></Field>
      <div className="sm:col-span-4"><Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Xarajatni yozish"}</Button></div>
    </form>
  );
}
