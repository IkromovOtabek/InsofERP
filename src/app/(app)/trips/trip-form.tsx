"use client";

import { useActionState, useState } from "react";
import { createTrip } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Select, Textarea, FormActions } from "@/components/ui";

/** unit — zayavkadagi mahsulot birligi ("m³", "dona"…); aralash birlikda m³ olinadi. */
type Order = { id: string; orderNo: string; customer: string; address: string; remainingM3: number; unit: string };
/** type — MIXER (beton) yoki TRUCK (dona mahsulot: plita, blok). */
type Vehicle = { id: string; plate: string; type: string; capacityM3: number | null };
const TYPE_LABEL: Record<string, string> = { MIXER: "mikser", TRUCK: "yuk mashina", PUMP: "nasos" };
/** vehicleId — xodim kartasida biriktirilgan mikser; phoneOk — ECO topa oladigan +998… raqami bormi. */
type Driver = { id: string; fullName: string; vehicleId: string | null; phoneOk: boolean };

export function TripForm({ orders, vehicles, drivers }: { orders: Order[]; vehicles: Vehicle[]; drivers: Driver[] }) {
  const [state, action, pending] = useActionState(createTrip, undefined);
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  // Zayavka birligiga mos texnika: beton (m³) — mikser, dona mahsulot — yuk mashina
  const wantType = (o?: Order) => (o && o.unit !== "m³" ? "TRUCK" : "MIXER");
  const firstOfType = (t: string) => vehicles.find((v) => v.type === t) ?? vehicles[0];
  const [vehicleId, setVehicleId] = useState(firstOfType(wantType(orders[0]))?.id ?? "");
  // Texnikaga biriktirilgan haydovchi — Xodimlar kartasidagi "biriktirilgan texnika"
  const driverOfVehicle = (vid: string) => drivers.find((d) => d.vehicleId === vid);
  const [driverId, setDriverId] = useState(driverOfVehicle(firstOfType(wantType(orders[0]))?.id ?? "")?.id ?? drivers[0]?.id ?? "");
  const order = orders.find((o) => o.id === orderId);
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const driver = drivers.find((d) => d.id === driverId);
  const typeMismatch = !!order && !!vehicle && vehicle.type !== wantType(order);
  // Biriktirilgani ro'yxat boshida tursin
  const driverList = [...drivers].sort((a, b) => Number(b.vehicleId === vehicleId) - Number(a.vehicleId === vehicleId));
  const [qty, setQty] = useState(order ? String(Math.min(vehicle?.capacityM3 ?? order.remainingM3, order.remainingM3)) : "");

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
  // Haydovchi tanlansa — uning biriktirilgan texnikasi o'zi tushadi (teskari bog'lanish)
  const pickDriver = (did: string) => {
    setDriverId(did);
    const d = drivers.find((x) => x.id === did);
    const v = d?.vehicleId ? vehicles.find((x) => x.id === d.vehicleId) : undefined;
    if (v) { setVehicleId(v.id); suggest(order, v); }
  };
  // Zayavka almashsa — birligiga mos texnika turiga o'tamiz (mikser ↔ yuk mashina)
  const pickOrder = (oid: string) => {
    setOrderId(oid);
    const o = orders.find((x) => x.id === oid);
    let v = vehicle;
    if (o && vehicle && vehicle.type !== wantType(o)) { v = firstOfType(wantType(o)); if (v) pickVehicle(v.id); }
    suggest(o, v);
  };

  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Zayavka *">
        <Select name="orderId" value={orderId} onChange={(e) => pickOrder(e.target.value)}>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNo} · {o.customer} · qoldi {o.remainingM3} {o.unit}</option>)}
        </Select>
      </Field>
      {order && <p className="text-sm text-slate-600">Manzil: {order.address}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Texnika *"
          hint={typeMismatch ? undefined : order?.unit === "m³" ? "Beton — mikser" : `${order?.unit ?? "dona"} mahsulot — yuk mashina`}
          error={typeMismatch ? `Zayavka ${order?.unit} da — ${TYPE_LABEL[wantType(order)]} kerak, tanlangani ${TYPE_LABEL[vehicle?.type ?? ""] ?? vehicle?.type}` : undefined}
        >
          <Select name="vehicleId" value={vehicleId} onChange={(e) => pickVehicle(e.target.value)}>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {TYPE_LABEL[v.type] ?? v.type}{v.capacityM3 ? ` (${v.capacityM3} m³)` : ""}</option>)}
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
      <Field label={`Miqdor, ${order?.unit ?? "m³"} *`} hint="Texnika sig'imi va zayavka qoldig'idan kichigi taklif qilinadi">
        <Input name="qtyM3" type="number" step="0.5" min="0.5" value={qty} onChange={(e) => setQty(e.target.value)} onFocus={() => !qty && suggest(order, vehicle)} required />
      </Field>
      <Field label="Izoh"><Textarea name="note" /></Field>
      <FormActions>
        <Button disabled={pending || orders.length === 0}>{pending ? "Yaratilmoqda…" : "Reys yaratish"}</Button>
        <LinkButton href="/trips" variant="secondary">Bekor</LinkButton>
      </FormActions>
      {orders.length === 0 && <p className="text-sm text-amber-700">Jo'natishga tayyor zayavka yo'q (tasdiqlangan va hajmi qolgan zayavka kerak).</p>}
    </form>
  );
}
