"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { addPayAdjustment, cancelPayAdjustment, savePayRule, togglePayRule } from "./hr-actions";
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { RULE_TRIGGER } from "@/lib/hr/labels";
import type { PayRuleTrigger } from "@/generated/prisma";

export type RuleRow = {
  id: string; name: string; trigger: PayRuleTrigger; amount: number; perMinute: boolean; graceMinutes: number;
  maxPerMonth: number | null; position: string | null; isActive: boolean; note: string | null;
};

/** Jarima / bonus qoidasi — hamma uchun bir xil (lavozim berilsa — faqat shu lavozimga). */
export function RuleForm({ rule, positions, onDone }: { rule?: RuleRow; positions: string[]; onDone?: () => void }) {
  const [state, act, pending] = useActionState(savePayRule.bind(null, rule?.id ?? null), undefined);
  const [trigger, setTrigger] = useState<PayRuleTrigger>(rule?.trigger ?? "ABSENT");
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) { router.refresh(); if (onDone) onDone(); else ref.current?.reset(); } }, [state, router, onDone]);
  const meta = RULE_TRIGGER[trigger];
  const timed = trigger === "LATE" || trigger === "EARLY_LEAVE";
  return (
    <form ref={ref} action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Nomi *"><Input name="name" required defaultValue={rule?.name} placeholder="Masalan: Sababsiz kelmaslik" /></Field>
        <Field label="Nimaga qarab *" hint={meta.hint}>
          <Select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as PayRuleTrigger)}>
            {(Object.keys(RULE_TRIGGER) as PayRuleTrigger[]).map((t) => <option key={t} value={t}>{RULE_TRIGGER[t].kinds[0] === "BONUS" ? "Bonus" : "Jarima"} · {RULE_TRIGGER[t].label}</option>)}
          </Select>
        </Field>
        <Field label="Summa, so'm *" hint={timed ? "Bir holat (yoki daqiqa) uchun" : "Bir holat uchun"}><Input type="number" name="amount" min={1} step={100} required defaultValue={rule?.amount} /></Field>
        <Field label="Lavozim" hint="Bo'sh — hamma uchun">
          <Select name="position" defaultValue={rule?.position ?? ""}>
            <option value="">Hamma uchun</option>
            {positions.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
        {timed && <Field label="Imtiyoz, daqiqa" hint="Shungacha hisoblanmaydi"><Input type="number" name="graceMinutes" min={0} max={240} defaultValue={rule?.graceMinutes ?? 0} /></Field>}
        <Field label="Oyiga ko'pi bilan, so'm" hint="Bo'sh — cheklovsiz"><Input type="number" name="maxPerMonth" min={0} step={1000} defaultValue={rule?.maxPerMonth ?? undefined} /></Field>
        {meta.perMinute && <Checkbox name="perMinute" label="Har daqiqa uchun (summa × daqiqa)" defaultChecked={rule?.perMinute} />}
      </div>
      <Field label="Izoh"><Input name="note" defaultValue={rule?.note ?? ""} /></Field>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok && !onDone ? state.note : undefined} />
      <div className="flex gap-2">
        <Button disabled={pending}>{rule ? "Saqlash" : <><Plus size={14} /> Qoida qo&apos;shish</>}</Button>
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Bekor</Button>}
      </div>
    </form>
  );
}

export function RuleActions({ rule, positions, editable }: { rule: RuleRow; positions: string[]; editable: boolean }) {
  const [edit, setEdit] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  if (edit) return <div className="min-w-[320px] text-left"><RuleForm rule={rule} positions={positions} onDone={() => setEdit(false)} /></div>;
  return (
    <div className="flex justify-end gap-1">
      {editable && <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Tahrirlash</Button>}
      <Button size="sm" variant="ghost" disabled={pending} onClick={async () => { setPending(true); await togglePayRule(rule.id); setPending(false); router.refresh(); }}>
        {rule.isActive ? "O'chirish" : "Yoqish"}
      </Button>
    </div>
  );
}

/** Qo'lda jarima / bonus. */
export function AdjustmentForm({ employees, month }: { employees: { id: string; fullName: string; position: string }[]; month: string }) {
  const [state, act, pending] = useActionState(addPayAdjustment, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) { ref.current?.reset(); router.refresh(); } }, [state, router]);
  return (
    <form ref={ref} action={act} className="space-y-3">
      <input type="hidden" name="month" value={month} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_130px_150px_1.6fr_150px]">
        <Field label="Xodim *">
          <Select name="employeeId" required defaultValue="">
            <option value="" disabled>Tanlang</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.position}</option>)}
          </Select>
        </Field>
        <Field label="Turi *"><Select name="kind" defaultValue="BONUS"><option value="BONUS">Bonus</option><option value="PENALTY">Jarima</option></Select></Field>
        <Field label="Summa, so'm *"><Input type="number" name="amount" min={1} step={1000} required /></Field>
        <Field label="Sababi *"><Input name="reason" required maxLength={300} placeholder="Masalan: reja oshirib bajarildi" /></Field>
        <Field label="Sana"><Input type="date" name="date" /></Field>
      </div>
      <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
      <Button disabled={pending}><Plus size={14} /> Yozish</Button>
    </form>
  );
}

export function CancelAdjustment({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(cancelPayAdjustment.bind(null, id), undefined);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Bekor qilish</Button>;
  return (
    <form action={act} className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Input name="reason" required placeholder="Sabab" className="h-8 text-xs" />
        <Button size="sm" variant="danger" disabled={pending}>Bekor</Button>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}
