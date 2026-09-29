"use client";

import { useActionState, useState } from "react";
import { Wrench } from "lucide-react";
import { setVehicleStatus } from "./vehicle-status";
import { Badge, Button, Input, Select } from "@/components/ui";
import type { VehicleStatus } from "@/generated/prisma";

export const VEHICLE_STATUS: Record<VehicleStatus, { label: string; color: "green" | "red" | "amber" }> = {
  ACTIVE: { label: "Saflda", color: "green" },
  REPAIR: { label: "Ta'mirda", color: "red" },
  IDLE: { label: "Bekor turibdi", color: "amber" },
};

export function VehicleStatusBadge({ status, note }: { status: VehicleStatus; note?: string | null }) {
  const s = VEHICLE_STATUS[status];
  return <span title={note ?? undefined}><Badge color={s.color}>{s.label}</Badge></span>;
}

/** Texnika holatini almashtirish — logistika. Ta'mir/bekor uchun sabab shart. */
export function VehicleStatusForm({ vehicleId, status, note }: { vehicleId: string; status: VehicleStatus; note: string | null }) {
  const [state, action, pending] = useActionState(setVehicleStatus.bind(null, vehicleId), undefined);
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<VehicleStatus>(status);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-left" title="Holatni almashtirish">
        <VehicleStatusBadge status={status} />
        {note && <span className="max-w-[10rem] truncate text-xs text-slate-500">{note}</span>}
        <Wrench size={12} className="text-slate-400" />
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5" onSubmit={() => setOpen(false)}>
      <Select name="status" value={st} onChange={(e) => setSt(e.target.value as VehicleStatus)} className="h-8 w-36 px-2 py-1 text-xs">
        {(Object.keys(VEHICLE_STATUS) as VehicleStatus[]).map((k) => <option key={k} value={k}>{VEHICLE_STATUS[k].label}</option>)}
      </Select>
      {st !== "ACTIVE" && <Input name="note" defaultValue={note ?? ""} placeholder="sabab (dvigatel, hujjat, haydovchi yo'q…)" className="h-8 w-56 px-2 py-1 text-xs" required />}
      <Button size="sm" variant="secondary" className="h-8 px-2 text-xs" disabled={pending}>Saqlash</Button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">Bekor</button>
      {state?.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
