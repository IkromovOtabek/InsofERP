"use client";

import { useActionState, useState } from "react";
import { createTrip } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Select, Textarea, FormActions } from "@/components/ui";

import Link from "next/link";

/**
 * remainingM3 — hozir reysga berish mumkin bo'lgan miqdor: brigada tayyorlagani − jo'natilgani.
 * inProduction — hali sexda (brigada tasdiqlamagan). unit — zayavkadagi mahsulot birligi ("m³", "dona"…).
 */
type Order = { id: string; orderNo: string; customer: string; address: string; remainingM3: number; inProduction: number; unit: string; plannedAt: string; mixed?: boolean; pieceUnit?: string };
/** Qoldig'i bor, lekin tayyor mahsuloti yo'q zayavka — ro'yxatga kirmaydi, sababi ko'rsatiladi. */
type Waiting = { id: string; orderNo: string; customer: string; inProduction: number; unit: string; hasTasks: boolean };
/** type — MIXER (beton) yoki TRUCK (dona mahsulot: plita, blok). */
type Vehicle = { id: string; plate: string; type: string; capacityM3: number | null; state?: string };
const TYPE_LABEL: Record<string, string> = { MIXER: "mikser", TRUCK: "yuk mashina", PUMP: "nasos" };
/** vehicleId — xodim kartasida biriktirilgan mikser; phoneOk — ECO topa oladigan +998… raqami bormi. */
type Driver = { id: string; fullName: string; vehicleId: string | null; phoneOk: boolean };

export function TripForm({ orders, waiting = [], vehicles, drivers, initialOrderId }: { orders: Order[]; waiting?: Waiting[]; vehicles: Vehicle[]; drivers: Driver[]; initialOrderId?: string }) {
  const [state, action, pending] = useActionState(createTrip, undefined);
  const [orderId, setOrderId] = useState(orders.find((o) => o.id === initialOrderId)?.id ?? orders[0]?.id ?? "");
  // Rejadagi yetkazish vaqti — zayavkadan olinadi, dispetcher o'zgartira oladi (kalendar va kechikish shunga qaraydi)
  const [plannedAt, setPlannedAt] = useState(orders.find((o) => o.id === orderId)?.plannedAt ?? "");
  // Zayavka birligiga mos texnika: beton (m³) — mikser, dona mahsulot — yuk mashina
  // Aralash zayavkada (beton + dona) ikkala tur ham to'g'ri: mikser betonni, yuk mashina dona qatorini oladi
  const wantType = (o?: Order) => (o && o.unit !== "m³" && !o.mixed ? "TRUCK" : "MIXER");
  const fits = (o?: Order, v?: Vehicle) => !o || !v || (o.mixed ? v.type === "MIXER" || v.type === "TRUCK" : v.type === wantType(o));
  const firstOfType = (t: string) => vehicles.find((v) => v.type === t) ?? vehicles[0];
  const [vehicleId, setVehicleId] = useState(firstOfType(wantType(orders[0]))?.id ?? "");
  // Texnikaga biriktirilgan haydovchi — Xodimlar kartasidagi "biriktirilgan texnika"
  const driverOfVehicle = (vid: string) => drivers.find((d) => d.vehicleId === vid);
  const [driverId, setDriverId] = useState(driverOfVehicle(firstOfType(wantType(orders[0]))?.id ?? "")?.id ?? drivers[0]?.id ?? "");
  const order = orders.find((o) => o.id === orderId);
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const driver = drivers.find((d) => d.id === driverId);
  const typeMismatch = !fits(order, vehicle);
  // Ko'rsatiladigan birlik: aralash zayavkada texnikaga qarab (mikser — m³, yuk mashina — dona)
  const unit = order?.mixed ? (vehicle?.type === "MIXER" ? "m³" : order.pieceUnit ?? "dona") : order?.unit ?? "m³";
  // Biriktirilgani ro'yxat boshida tursin
  const driverList = [...drivers].sort((a, b) => Number(b.vehicleId === vehicleId) - Number(a.vehicleId === vehicleId));
  const [qty, setQty] = useState(order ? String(Math.min(vehicle?.capacityM3 ?? order.remainingM3, order.remainingM3)) : "");
  // Tayyor qoldiqdan ko'p yozilsa — serverdagi bilan bir xil sabab, yuborishdan oldin
  const qtyNum = Number(qty);
  const overReady = !order || qtyNum <= order.remainingM3 + 0.001
    ? undefined
    : order.inProduction > 0
      ? `Faqat ${order.remainingM3} ${unit} tayyor. Qolgan ${order.inProduction} ${unit} ishlab chiqarilmoqda — brigada tasdiqini kuting`
      : `Zayavkada faqat ${order.remainingM3} ${unit} qoldi`;

  const suggest = (o?: Order, v?: Vehicle) => {
    if (!o) return;
    const cap = v?.capacityM3 ?? o.remainingM3;
    setQty(String(Math.min(cap, o.remainingM3)));
  };

  // Texnika almashtirilsa — o'sha mashinaning haydovchisiga o'tamiz (biriktirilmagan bo'lsa tanlov qoladi)
  const pickVehicle = (vid: string) => {
    setVehicleId(vid);
    const d = driverOfVehicle(vid);
    if (d) setDriverId(d.id);
    suggest(order, vehicles.find((v) => v.id === vid));
  };
  // Haydovchi tanlansa — uning biriktirilgan texnikasi o'zi tushadi (teskari bog'lanish), lekin faqat
  // dispetcher texnikani hali qo'lda tanlamagan bo'lsa: qo'lda tanlangan mashina jimgina almashib ketmasin
  const [vehicleManual, setVehicleManual] = useState(false);
  const pickDriver = (did: string) => {
    setDriverId(did);
    if (vehicleManual) return;
    const d = drivers.find((x) => x.id === did);
    const v = d?.vehicleId ? vehicles.find((x) => x.id === d.vehicleId) : undefined;
    if (v && fits(order, v)) { setVehicleId(v.id); suggest(order, v); }
  };
  // Zayavka almashsa — birligiga mos texnika turiga o'tamiz (mikser ↔ yuk mashina)
  const pickOrder = (oid: string) => {
    setOrderId(oid);
    const o = orders.find((x) => x.id === oid);
    setPlannedAt(o?.plannedAt ?? "");
    let v = vehicle;
    if (o && vehicle && !fits(o, vehicle)) { v = firstOfType(wantType(o)); if (v) pickVehicle(v.id); }
    suggest(o, v);
  };

  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Zayavka *">
        <Select name="orderId" value={orderId} onChange={(e) => pickOrder(e.target.value)}>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNo} · {o.customer} · tayyor {o.remainingM3} {o.unit}{o.inProduction > 0 ? ` · sexda ${o.inProduction} ${o.unit}` : ""}{o.mixed ? " · aralash" : ""}</option>)}
        </Select>
      </Field>
      {order && (
        <div className="space-y-1 text-sm text-slate-600">
          <p>Manzil: {order.address}</p>
          <p>
            Brigada tayyorlagan: <b className="text-slate-900">{order.remainingM3} {order.unit}</b> reysga berish mumkin
            {order.inProduction > 0 && <>, <b className="text-amber-700">{order.inProduction} {order.unit}</b> hali ishlab chiqarilmoqda — brigada tasdiqini kuting</>}
          </p>
          {order.mixed && <p className="text-amber-700">Aralash zayavka (beton + {order.pieceUnit ?? "dona"}): mikser faqat betonni, yuk mashina faqat dona mahsulotni oladi. Bir turda bir nechta mahsulot bo&apos;lsa — zayavkani mahsulot bo&apos;yicha ajrating.</p>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Texnika *"
          hint={typeMismatch ? undefined : order?.mixed ? (vehicle?.type === "MIXER" ? "Mikser — zayavkaning beton qatori" : "Yuk mashina — zayavkaning dona qatori") : order?.unit === "m³" ? "Beton — mikser" : `${order?.unit ?? "dona"} mahsulot — yuk mashina`}
          error={typeMismatch ? `Zayavka ${order?.unit} da — ${TYPE_LABEL[wantType(order)]} kerak, tanlangani ${TYPE_LABEL[vehicle?.type ?? ""] ?? vehicle?.type}` : undefined}
        >
          <Select name="vehicleId" value={vehicleId} onChange={(e) => { setVehicleManual(true); pickVehicle(e.target.value); }}>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {TYPE_LABEL[v.type] ?? v.type}{v.capacityM3 ? ` (${v.capacityM3} m³)` : ""}{v.state ? ` · ${v.state}` : ""}</option>)}
          </Select>
        </Field>
        <Field
          label="Haydovchi *"
          hint={driverOfVehicle(vehicleId) ? "Texnikaga biriktirilgan haydovchi — kerak bo'lsa almashtiring" : "Bu texnikaga haydovchi biriktirilmagan (Xodimlar kartasida biriktiriladi)"}
          error={driver && !driver.phoneOk ? "Telefon raqami yo'q — reys haydovchi ilovasiga bormaydi. Xodimlar sahifasida +998… formatida kiriting." : undefined}
        >
          {/* Haydovchi tanlansa uning texnikasi yuqorida o'zi tanlanadi */}
          <Select name="driverId" value={driverId} onChange={(e) => pickDriver(e.target.value)}>
            {driverList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
                {d.vehicleId === vehicleId ? " · shu texnika" : d.vehicleId ? "" : " · texnikasiz"}
                {d.phoneOk ? "" : " · telefon yo'q"}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={`Miqdor, ${unit} *`} hint={overReady ? undefined : "Texnika sig'imi va tayyor qoldiqdan kichigi taklif qilinadi"} error={overReady}>
        <Input name="qtyM3" type="number" step="0.5" min="0.5" max={order?.remainingM3} value={qty} onChange={(e) => setQty(e.target.value)} onFocus={() => !qty && suggest(order, vehicle)} required />
      </Field>
      <Field label="Rejadagi yetkazish vaqti" hint="Zayavkadan olinadi. Dispetcher kalendari va kechikish hisobi shu vaqtga qaraydi">
        <Input name="plannedAt" type="datetime-local" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
      </Field>
      <Field label="Izoh"><Textarea name="note" /></Field>
      <FormActions>
        <Button disabled={pending || orders.length === 0 || !!overReady}>{pending ? "Yaratilmoqda…" : "Reys yaratish"}</Button>
        <LinkButton href="/trips" variant="secondary">Bekor</LinkButton>
      </FormActions>
      {orders.length === 0 && <p className="text-sm text-amber-700">Jo'natishga tayyor zayavka yo'q — brigada tasdiqlagan mahsulot bo'lishi kerak.</p>}
      {drivers.length === 0 && <p className="text-sm text-amber-700">Haydovchi lavozimidagi faol xodim yo&apos;q — Otdel kadrda lavozimni &quot;haydovchi&quot; deb belgilang.</p>}
      {waiting.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">Brigada tasdiqini kutayotgan zayavkalar (reysga hali berilmaydi):</p>
          <ul className="mt-1 space-y-0.5">
            {waiting.map((w) => (
              <li key={w.id}>
                <Link href={`/orders/${w.id}`} className="font-medium hover:underline">{w.orderNo}</Link> · {w.customer} —{" "}
                {w.hasTasks ? `${w.inProduction} ${w.unit} ishlab chiqarilmoqda` : "brigada tayinlanmagan"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
