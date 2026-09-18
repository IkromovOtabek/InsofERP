"use client";

import { useActionState } from "react";
import { markDelivered } from "../actions";
import { Button, FormError, Input } from "@/components/ui";

export function DeliverForm({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState(markDelivered.bind(null, tripId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-slate-500">Obyektda qabul qildi (F.I.O.)</label>
        <Input name="receiverName" className="w-64" required />
      </div>
      <Button variant="success" disabled={pending}>Yetkazildi</Button>
      <div className="w-full"><FormError error={state?.error} /></div>
    </form>
  );
}
