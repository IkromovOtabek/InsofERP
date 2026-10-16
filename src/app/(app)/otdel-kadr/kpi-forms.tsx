"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { saveChecklistTemplate, saveKpiMetric, setKpiFact, toggleChecklistTemplate, toggleKpiMetric } from "./hr-actions";
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { KPI_SOURCE, KPI_SOURCES } from "@/lib/hr/labels";
import type { ActionState } from "@/lib/action";
import type { KpiSource } from "@/generated/prisma";

/** Muvaffaqiyatdan keyin bir marta: sahifani yangilash va `after` (forma tozalash / tahrirni yopish). */
function useDone(state: ActionState, after?: () => void) {
  const router = useRouter();
  const cb = useRef(after);
  useEffect(() => { cb.current = after; });
  useEffect(() => { if (state?.ok) { router.refresh(); cb.current?.(); } }, [state, router]);
}

// ───────────────────────── Cheklistlar ─────────────────────────

export type TplRow = { id: string; name: string; position: string | null; items: string[]; isActive: boolean };

export function ChecklistForm({ t, positions, onDone }: { t?: TplRow; positions: string[]; onDone?: () => void }) {
  const [state, act, pending] = useActionState(saveChecklistTemplate.bind(null, t?.id ?? null), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useDone(state, onDone ?? (() => ref.current?.reset()));
  return (
    <form ref={ref} action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nomi *"><Input name="name" required defaultValue={t?.name} placeholder="Masalan: Sklad — kun yakuni" /></Field>
        <Field label="Lavozim" hint="Bo'sh — hamma xodim uchun">
          <Select name="position" defaultValue={t?.position ?? ""}>
            <option value="">Hamma uchun</option>
            {positions.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Bandlar *" hint="Har qatorga bitta majburiyat (40 tagacha)">
        <Textarea name="items" rows={5} required defaultValue={t?.items.join("\n")} placeholder={"Ish joyi tozalandi\nQoldiq tekshirildi\nKalit topshirildi"} />
      </Field>
      <FormError error={state?.error} /><FormSuccess text={state?.ok && !onDone ? state.note : undefined} />
      <div className="flex gap-2">
        <Button disabled={pending}>{t ? "Saqlash" : <><Plus size={14} /> Cheklist qo&apos;shish</>}</Button>
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Bekor</Button>}
      </div>
    </form>
  );
}

export function ChecklistRowActions({ t, positions }: { t: TplRow; positions: string[] }) {
  const [edit, setEdit] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  if (edit) return <div className="min-w-[320px] text-left"><ChecklistForm t={t} positions={positions} onDone={() => setEdit(false)} /></div>;
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Tahrirlash</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={async () => { setPending(true); await toggleChecklistTemplate(t.id); setPending(false); router.refresh(); }}>{t.isActive ? "O'chirish" : "Yoqish"}</Button>
    </div>
  );
}

// ───────────────────────── KPI ─────────────────────────

export type MetricRow = { id: string; name: string; source: KpiSource; unit: string; position: string | null; employeeId: string | null; target: number; reward: number; minPct: number; capPct: number; note: string | null; isActive: boolean };

export function MetricForm({ m, positions, employees, onDone }: { m?: MetricRow; positions: string[]; employees: { id: string; fullName: string }[]; onDone?: () => void }) {
  const [state, act, pending] = useActionState(saveKpiMetric.bind(null, m?.id ?? null), undefined);
  const [source, setSource] = useState<KpiSource>(m?.source ?? "ATTENDANCE");
  const ref = useRef<HTMLFormElement>(null);
  useDone(state, onDone ?? (() => ref.current?.reset()));
  return (
    <form ref={ref} action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ko'rsatkich *"><Input name="name" required defaultValue={m?.name} placeholder="Masalan: Davomat intizomi" /></Field>
        <Field label="Fakt manbasi *" hint={KPI_SOURCE[source].hint}>
          <Select name="source" value={source} onChange={(e) => setSource(e.target.value as KpiSource)}>
            {KPI_SOURCES.map((s) => <option key={s} value={s}>{KPI_SOURCE[s].label}</option>)}
          </Select>
        </Field>
        <Field label={`Reja (oyiga)${KPI_SOURCE[source].unit ? `, ${KPI_SOURCE[source].unit}` : ""} *`}><Input type="number" step="any" name="target" required defaultValue={m?.target ?? (KPI_SOURCE[source].unit === "%" ? 95 : undefined)} /></Field>
        <Field label="Birlik" hint="Bo'sh — manbaniki"><Input name="unit" defaultValue={m?.unit} placeholder={KPI_SOURCE[source].unit || "dona"} /></Field>
        <Field label="Mukofot (100%), so'm"><Input type="number" min={0} step={1000} name="reward" defaultValue={m?.reward ?? 0} /></Field>
        <Field label="Minimal %" hint="Undan kam — mukofot yo'q"><Input type="number" name="minPct" defaultValue={m?.minPct ?? 80} /></Field>
        <Field label="Yuqori chegara %" hint="Oshgani hisoblanmaydi"><Input type="number" name="capPct" defaultValue={m?.capPct ?? 120} /></Field>
        <Field label="Kimga">
          <Select name="target_who" defaultValue={m?.employeeId ? `e:${m.employeeId}` : m?.position ? `p:${m.position}` : ""} onChange={(e) => {
            const f = e.currentTarget.form!; const v = e.currentTarget.value;
            (f.elements.namedItem("employeeId") as HTMLInputElement).value = v.startsWith("e:") ? v.slice(2) : "";
            (f.elements.namedItem("position") as HTMLInputElement).value = v.startsWith("p:") ? v.slice(2) : "";
          }}>
            <option value="">Hamma xodim</option>
            <optgroup label="Lavozim">{positions.map((p) => <option key={p} value={`p:${p}`}>{p}</option>)}</optgroup>
            <optgroup label="Xodim">{employees.map((e) => <option key={e.id} value={`e:${e.id}`}>{e.fullName}</option>)}</optgroup>
          </Select>
        </Field>
      </div>
      <input type="hidden" name="employeeId" defaultValue={m?.employeeId ?? ""} />
      <input type="hidden" name="position" defaultValue={m?.position ?? ""} />
      <Field label="Izoh"><Input name="note" defaultValue={m?.note ?? ""} /></Field>
      <FormError error={state?.error} /><FormSuccess text={state?.ok && !onDone ? state.note : undefined} />
      <div className="flex gap-2">
        <Button disabled={pending}>{m ? "Saqlash" : <><Plus size={14} /> Ko&apos;rsatkich qo&apos;shish</>}</Button>
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Bekor</Button>}
      </div>
    </form>
  );
}

export function MetricRowActions({ m, positions, employees }: { m: MetricRow; positions: string[]; employees: { id: string; fullName: string }[] }) {
  const [edit, setEdit] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  if (edit) return <div className="min-w-[340px] text-left"><MetricForm m={m} positions={positions} employees={employees} onDone={() => setEdit(false)} /></div>;
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Tahrirlash</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={async () => { setPending(true); await toggleKpiMetric(m.id); setPending(false); router.refresh(); }}>{m.isActive ? "O'chirish" : "Yoqish"}</Button>
    </div>
  );
}

/** Faktni qo'lda kiritish / tuzatish (bo'sh — avtomatik). */
export function FactInput({ metricId, employeeId, month, fact, manual, editable }: { metricId: string; employeeId: string; month: string; fact: number | null; manual: boolean; editable: boolean }) {
  const [state, act, pending] = useActionState(setKpiFact.bind(null, metricId, employeeId, month), undefined);
  useDone(state);
  if (!editable) return <span>{fact ?? "—"}</span>;
  return (
    <form action={act} className="flex items-center justify-end gap-1">
      <Input name="fact" type="number" step="any" min={0} defaultValue={manual ? fact ?? "" : ""} placeholder={fact != null ? String(fact) : "—"} className={`h-8 w-24 text-right text-xs ${manual ? "border-amber-300 bg-amber-50" : ""}`} title={manual ? "Qo'lda kiritilgan" : "Avtomatik — o'zgartirish uchun yozing"} />
      <Button size="sm" variant="ghost" disabled={pending}>OK</Button>
      {state?.error && <span className="text-[11px] text-red-600">{state.error}</span>}
    </form>
  );
}
