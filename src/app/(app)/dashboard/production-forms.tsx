"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { CheckCheck, ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { addDefect, assignStaff, deleteDefect, deletePlan, markAllStaff, markStaff, saveReport, savePlan } from "./production-actions";
import { cn } from "@/lib/utils";
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
        <Select name="reason" defaultValue={reasons[0]}>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
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

/* ───────────────────────── Sex davomati ───────────────────────── */

const MARK_BTNS = [
  { v: "PRESENT", label: "Keldi", cls: "hover:bg-emerald-50 hover:text-emerald-700 data-[on=true]:bg-emerald-100 data-[on=true]:text-emerald-800" },
  { v: "ABSENT", label: "Kelmadi", cls: "hover:bg-red-50 hover:text-red-700 data-[on=true]:bg-red-100 data-[on=true]:text-red-700" },
  { v: "SICK", label: "Kasal", cls: "hover:bg-amber-50 hover:text-amber-700 data-[on=true]:bg-amber-100 data-[on=true]:text-amber-800" },
  { v: "LEAVE", label: "Ta'til", cls: "hover:bg-sky-50 hover:text-sky-700 data-[on=true]:bg-sky-100 data-[on=true]:text-sky-800" },
] as const;

/** Qatordagi tezkor belgilar: Keldi (hozirgi soat) / Kelmadi / Kasal / Ta'til, kelgan bo'lsa — Ketdi. */
export function StaffMark({ employeeId, status, checkedOut }: { employeeId: string; status: string | null; checkedOut: boolean }) {
  const [pending, start] = useTransition();
  const send = (st: string) => start(async () => {
    const fd = new FormData();
    fd.set("employeeId", employeeId); fd.set("status", st);
    const r = await markStaff(undefined, fd);
    if (r?.error) alert(r.error);
  });
  return (
    <div className={cn("inline-flex flex-wrap justify-end gap-1", pending && "opacity-50")}>
      {MARK_BTNS.map((b) => (
        <button key={b.v} type="button" disabled={pending} data-on={status === b.v} onClick={() => send(b.v)}
          className={cn("rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 transition", b.cls)}>{b.label}</button>
      ))}
      {status === "PRESENT" && !checkedOut && (
        <button type="button" disabled={pending} onClick={() => send("CHECKOUT")} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100">Ketdi</button>
      )}
    </div>
  );
}

export function MarkAllButton({ left }: { left: number }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  if (!left && !note) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {note && <span className="text-xs text-emerald-700">{note}</span>}
      {left > 0 && (
        <Button type="button" variant="secondary" disabled={pending} onClick={() => confirm(`Belgilanmagan ${left} kishi "Keldi" deb belgilansinmi?`) && start(async () => { const r = await markAllStaff(); setNote(r?.note ?? null); })}>
          <CheckCheck size={15} /> {pending ? "Belgilanmoqda…" : `Hammasi keldi (${left})`}
        </Button>
      )}
    </span>
  );
}

/* ───────────────────────── Taqsimlash (direktor) ───────────────────────── */

export function AssignSelect({ employeeId, brigadeId, brigades }: { employeeId: string; brigadeId: string | null; brigades: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(brigadeId ?? "");
  return (
    <Select value={val} disabled={pending} className={cn("min-w-48", !val && "text-slate-400", pending && "opacity-60")}
      onChange={(e) => { const v = e.target.value; const prev = val; setVal(v); start(async () => { const r = await assignStaff(employeeId, v); if (r?.error) { alert(r.error); setVal(prev); } }); }}>
      <option value="">— sexda emas / taqsimlanmagan —</option>
      {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </Select>
  );
}

/* ───────────────────────── Kunlik hisobot: "Qayd etish" ───────────────────────── */

export function SaveReportForm({ iso, compact = false }: { iso: string; compact?: boolean }) {
  const [state, action, pending] = useActionState(saveReport, undefined);
  return (
    <form action={action} className={cn("flex flex-wrap items-center gap-2", compact ? "" : "w-full")}>
      <input type="hidden" name="iso" value={iso} />
      {!compact && <Input name="note" placeholder="Izoh (ixtiyoriy): smena, to'xtash sababi…" className="min-w-64 flex-1" />}
      <Button type="submit" disabled={pending}><ClipboardCheck size={15} /> {pending ? "Saqlanmoqda…" : "Qayd etish"}</Button>
      {state?.ok && <span className="text-sm text-emerald-700">{state.note}</span>}
      <FormError error={state?.error} />
    </form>
  );
}
