"use client";

import { useActionState, useState } from "react";
import { createTrip } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Select, Textarea, FormActions } from "@/components/ui";

type Order = { id: string; orderNo: string; customer: string; address: string; remainingM3: number };
type Vehicle = { id: string; plate: string; capacityM3: number | null };
type Driver = { id: string; fullName: string };

export function TripForm({ orders, vehicles, drivers }: { orders: Order[]; vehicles: Vehicle[]; drivers: Driver[] }) {
  const [state, action, pending] = useActionState(createTrip, undefined);
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const order = orders.find((o) => o.id === orderId);
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const [qty, setQty] = useState(order ? String(Math.min(vehicle?.capacityM3 ?? order.remainingM3, order.remainingM3)) : "");

  const suggest = (o?: Order, v?: Vehicle) => {
    if (!o) return;
    const cap = v?.capacityM3 ?? o.remainingM3;
    setQty(String(Math.min(cap, o.remainingM3)));
  };

  return (
    <form action={action} className="max-w-xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <Field label="Zayavka *">
        <Select name="orderId" value={orderId} onChange={(e) => { setOrderId(e.target.value); suggest(orders.find((o) => o.id === e.target.value), vehicle); }}>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNo} · {o.customer} · qoldi {o.remainingM3} m³</option>)}
        </Select>
      </Field>
      {order && <p className="text-sm text-slate-600">Manzil: {order.address}</p>}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Mikser *">
          <Select name="vehicleId" value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); suggest(order, vehicles.find((v) => v.id === e.target.value)); }}>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.capacityM3 ? ` (${v.capacityM3} m³)` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Haydovchi *">
          <Select name="driverId" defaultValue={drivers[0]?.id}>{drivers.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}</Select>
        </Field>
      </div>
      <Field label="Miqdor, m³ *" hint="Mikser sig'imi va zayavka qoldig'idan kichigi taklif qilinadi">
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
