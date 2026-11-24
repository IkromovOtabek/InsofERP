"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, PackageCheck, Wand2, XCircle } from "lucide-react";
import { bulkCloseOrders } from "./bulk-actions";
import { Button, FormError, FormSuccess, FormWarning, Input } from "@/components/ui";

/** Ro'yxatdagi belgilash katakchalari shu formaga bog'lanadi (`form` atributi) — jadval server komponentida qoladi. */
export const ORDERS_BULK_FORM = "orders-bulk";

/**
 * «7 kundan ortiq ochiq» ko'rinishidagi ommaviy amallar: belgilangan zayavkalarni yetkazilganicha yopish, bekor qilish
 * yoki avtomatik (yetkazilgani bori — yopish, boshlanmagani — bekor). Sabab majburiy. Qoida — `bulk-actions.ts`.
 */
export function OrdersBulkBar({ total }: { total: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(bulkCloseOrders, undefined);
  const [picked, setPicked] = useState(0);
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${ORDERS_BULK_FORM}"]`)];
  useEffect(() => {
    const count = () => setPicked(boxes().filter((b) => b.checked).length);
    count();
    document.addEventListener("change", count);
    return () => document.removeEventListener("change", count);
  }, []);
  useEffect(() => { if (state?.ok) { router.refresh(); setPicked(0); } }, [state, router]);
  const toggleAll = () => {
    const list = boxes();
    const on = list.some((b) => !b.checked);
    for (const b of list) b.checked = on;
    setPicked(on ? list.length : 0);
  };
  return (
    <form id={ORDERS_BULK_FORM} action={action} className="mb-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={toggleAll}><CheckSquare size={15} /> {picked && picked === total ? "Belgini olish" : `Hammasini belgilash (${total})`}</Button>
        <div className="min-w-64 flex-1">
          <Input name="reason" required minLength={3} maxLength={300} placeholder="Sabab: masalan, mijoz qolganidan voz kechdi / zayavka takror kiritilgan" aria-label="Sabab" />
        </div>
        <Button name="mode" value="auto" size="sm" disabled={pending || !picked} title="Yetkazilgan reysi bori — yetkazilganicha yopiladi, boshlanmagani — bekor qilinadi"><Wand2 size={15} /> Avtomatik ({picked})</Button>
        <Button name="mode" value="close" variant="secondary" size="sm" disabled={pending || !picked}><PackageCheck size={15} /> Yetkazilganicha yopish</Button>
        <Button name="mode" value="cancel" variant="danger" size="sm" disabled={pending || !picked}><XCircle size={15} /> Bekor qilish</Button>
      </div>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note} />}
      <FormWarning text={state?.warn} />
    </form>
  );
}
