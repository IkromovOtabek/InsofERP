"use client";

import { useActionState } from "react";
import { CalendarDays } from "lucide-react";
import { setOrderDate } from "../actions";
import { Button, FormError, Input } from "@/components/ui";

/** Qoralama zayavkaning yetkazish sanasini belgilash/o'zgartirish ("Sana aniq emas" bo'lib ochilgan bo'lsa ham). */
export function OrderDateForm({ orderId, current, min }: { orderId: string; current?: string; min: string }) {
  const [state, action, pending] = useActionState(setOrderDate.bind(null, orderId), undefined);
  return (
    <form action={action} className="space-y-2">
      <FormError error={state?.error} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">Yetkazish sanasi *</span>
          <Input name="deliveryDate" type="date" defaultValue={current} min={min} required className="w-48" />
        </label>
        <Button disabled={pending} variant="primary"><CalendarDays size={15} /> {pending ? "Saqlanmoqda…" : "Sanani saqlash"}</Button>
      </div>
    </form>
  );
}
