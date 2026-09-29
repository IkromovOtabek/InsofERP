"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { addDefect, deleteDefect, deletePlan, savePlan } from "./production-actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";

type Product = { id: string; code: string; name: string; unit: string };
const u = (unit: string) => (unit === "m3" ? "m³" : unit);

/** Direktor: oy uchun mahsulot plani. Mavjud planni tanlasa — o'sha qiymatlar formaga tushadi. */
export function PlanForm({ month, products, plans }: { month: string; products: Product[]; plans: { productId: string; monthQty: number; dayQty: number | null; note: string | null }[] }) {
  const [state, action, pending] = useActionState(savePlan, undefined);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const cur = plans.find((p) => p.productId === productId);
  const unit = u(products.find((p) => p.id === productId)?.unit ?? "");
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_140px_140px_1fr_auto]" key={`${productId}:${cur?.monthQty ?? ""}`}>
      <input type="hidden" name="month" value={month} />
      <Field label="Mahsulot">
        <Select name="productId" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}{plans.some((x) => x.productId === p.id) ? " ✓" : ""}</option>)}
        </Select>
      </Field>
      <Field label={`Oylik plan (${unit})`}>
        <Input name="monthQty" type="number" step="any" min="0" required defaultValue={cur?.monthQty ?? ""} />
      </Field>
      <Field label={`Kunlik (${unit})`}>
        <Input name="dayQty" type="number" step="any" min="0" placeholder="avto" defaultValue={cur?.dayQty ?? ""} />
      </Field>
      <Field label="Izoh">
        <Input name="note" defaultValue={cur?.note ?? ""} placeholder="ixtiyoriy" />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Saqlanmoqda…" : cur ? "Yangilash" : "Belgilash"}</Button>
      <div className="sm:col-span-2 xl:col-span-5">
        <FormError error={state?.error} />
        <p className="text-xs text-slate-500">Kunlik plan bo&apos;sh qolsa oylik plan ish kunlariga (yakshanbasiz) teng bo&apos;linadi.</p>
      </div>
    </form>
  );
}

export function DeletePlanButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} title="Planni o'chirish" onClick={() => confirm("Plan o'chirilsinmi?") && start(async () => { const r = await deletePlan(id); if (r?.error) alert(r.error); })}
      className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
      <Trash2 size={14} />
    </button>
  );
}

/** Brak qayd qilish — ishlab chiqarish / ish boshqaruvchi / direktor. */
export function DefectForm({ products, brigades, reasons }: { products: Product[]; brigades: { id: string; name: string }[]; reasons: string[] }) {
  const [state, action, pending] = useActionState(addDefect, undefined);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  const unit = u(products.find((p) => p.id === productId)?.unit ?? "");
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_110px_1fr_1fr_1fr_auto]">
      <Field label="Mahsulot">
        <Select name="productId" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </Select>
      </Field>
      <Field label={`Miqdor (${unit})`}>
        <Input name="qty" type="number" step="any" min="0" required />
      </Field>
      <Field label="Sabab">
        <Select name="reason" defaultValue={reasons[0]}>{reasons.map((r) => <option key={r}>{r}</option>)}</Select>
      </Field>
      <Field label="Brigada">
        <Select name="brigadeId" defaultValue=""><option value="">— ko&apos;rsatilmagan —</option>{brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
      </Field>
      <Field label="Izoh">
        <Input name="note" placeholder="ixtiyoriy" />
      </Field>
      <Button type="submit" disabled={pending}><Plus size={15} /> {pending ? "Yozilmoqda…" : "Brak yozish"}</Button>
      <div className="sm:col-span-2 xl:col-span-6">
        <FormError error={state?.error} />
        <p className="text-xs text-slate-500">Brak hovli qoldig&apos;idan hisobdan chiqariladi.</p>
      </div>
    </form>
  );
}

export function DeleteDefectButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} title="Brak yozuvini bekor qilish" onClick={() => confirm("Brak yozuvi bekor qilinsinmi? Qoldiq qaytariladi.") && start(async () => { const r = await deleteDefect(id); if (r?.error) alert(r.error); })}
      className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
      <Trash2 size={14} />
    </button>
  );
}
