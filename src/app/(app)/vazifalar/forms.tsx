"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, Pencil, Play, Plus, RotateCcw, Save, Send, XCircle } from "lucide-react";
import { commentAction, createTaskAction, quickStatus, taskStatusAction, updateTaskAction } from "./actions";
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/hr/labels";
import type { ActionState } from "@/lib/action";

function useRefresh(state: ActionState) {
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
}

/** Yangi vazifa: o'ziga yoki (huquqi bo'lsa) boshqa xodimga. */
export function NewTaskForm({ employees, myId, canAssign }: { employees: { id: string; fullName: string; position: string }[]; myId: string | null; canAssign: boolean }) {
  const [state, act, pending] = useActionState(createTaskAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [token, setToken] = useState(() => crypto.randomUUID());
  useRefresh(state);
  useEffect(() => { if (state?.ok) { ref.current?.reset(); setToken(crypto.randomUUID()); } }, [state]);
  return (
    <form ref={ref} action={act} className="space-y-3">
      <input type="hidden" name="clientToken" value={token} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.3fr_150px_110px_140px]">
        <Field label="Vazifa *"><Input name="title" required minLength={3} maxLength={200} placeholder="Masalan: oy oxiri inventarizatsiya" /></Field>
        <Field label="Bajaruvchi" hint={canAssign ? undefined : "Faqat o'zingizga"}>
          <Select name="assigneeId" defaultValue={myId ?? ""} disabled={!canAssign}>
            {myId && <option value={myId}>Men o&apos;zim</option>}
            {canAssign && employees.filter((e) => e.id !== myId).map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.position}</option>)}
          </Select>
        </Field>
        <Field label="Muddat"><Input type="date" name="dueDate" /></Field>
        <Field label="Soat"><Input type="time" name="dueTime" /></Field>
        <Field label="Muhimlik"><Select name="priority" defaultValue="NORMAL">{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
      </div>
      <Field label="Tavsif"><Textarea name="description" rows={2} maxLength={3000} /></Field>
      <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
      <Button disabled={pending}><Plus size={15} /> {pending ? "Saqlanmoqda…" : "Vazifa berish"}</Button>
    </form>
  );
}

/**
 * Vazifa kartasidagi «Tahrirlash»: nomi, bajaruvchi, muddat, muhimlik, tavsif. Bajaruvchi ro'yxati serverdan keladi
 * (`vazifalar.assign` bo'lmasa — hozirgi bajaruvchi va o'zi); almashtirilsa vazifa yangi bajaruvchiga boshidan beriladi.
 */
export function EditTaskForm({ task, employees }: {
  task: { id: string; title: string; description: string | null; assigneeId: string; dueDate: string | null; dueTime: string | null; priority: string };
  employees: { id: string; fullName: string; position: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(updateTaskAction.bind(null, task.id), undefined);
  useRefresh(state);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  if (!open) {
    return (
      <div className="space-y-2">
        <Button variant="ghost" onClick={() => setOpen(true)}><Pencil size={15} /> Tahrirlash</Button>
        <FormSuccess text={state?.ok ? state.note : undefined} />
      </div>
    );
  }
  return (
    <form action={act} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.3fr_150px_110px_140px]">
        <Field label="Vazifa *"><Input name="title" required minLength={3} maxLength={200} defaultValue={task.title} /></Field>
        <Field label="Bajaruvchi" hint={employees.length > 1 ? "Almashtirilsa — yangi bajaruvchi boshidan oladi" : undefined}>
          <Select name="assigneeId" defaultValue={task.assigneeId} disabled={employees.length < 2}>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.position}</option>)}
          </Select>
        </Field>
        <Field label="Muddat"><Input type="date" name="dueDate" defaultValue={task.dueDate ?? ""} /></Field>
        <Field label="Soat"><Input type="time" name="dueTime" defaultValue={task.dueTime ?? ""} /></Field>
        <Field label="Muhimlik"><Select name="priority" defaultValue={task.priority}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
      </div>
      <Field label="Tavsif"><Textarea name="description" rows={3} maxLength={3000} defaultValue={task.description ?? ""} /></Field>
      <FormError error={state?.error} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending}><Save size={15} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor qilish</Button>
      </div>
    </form>
  );
}

/** Kanban / ro'yxat kartasidagi tezkor tugma. */
export function QuickButton({ id, act, label }: { id: string; act: "start" | "done" | "accept"; label: string }) {
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, setPending] = useState(false);
  useRefresh(state);
  const Icon = act === "start" ? Play : act === "done" ? Check : CheckCheck;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Button size="sm" variant="secondary" disabled={pending} onClick={async () => { setPending(true); setState(await quickStatus(id, act)); setPending(false); }}>
        <Icon size={13} /> {label}
      </Button>
      {state?.error && <span className="text-[11px] text-red-600">{state.error}</span>}
    </span>
  );
}

/** Kartadagi holat tugmalari (qaytarish va bekor — sabab bilan). */
export function TaskButtons({ id, can }: { id: string; can: { start: boolean; done: boolean; accept: boolean; ret: boolean; cancel: boolean } }) {
  const [start, actStart, p1] = useActionState(taskStatusAction.bind(null, id, "start"), undefined);
  const [done, actDone, p2] = useActionState(taskStatusAction.bind(null, id, "done"), undefined);
  const [acc, actAcc, p3] = useActionState(taskStatusAction.bind(null, id, "accept"), undefined);
  const [ret, actRet, p4] = useActionState(taskStatusAction.bind(null, id, "return"), undefined);
  const [can_, actCancel, p5] = useActionState(taskStatusAction.bind(null, id, "cancel"), undefined);
  const [open, setOpen] = useState<"" | "return" | "cancel">("");
  const last = [start, done, acc, ret, can_].find((x) => x);
  useRefresh(last);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {can.start && <form action={actStart}><Button variant="secondary" disabled={p1}><Play size={15} /> Boshlash</Button></form>}
        {can.done && <form action={actDone}><Button variant="success" disabled={p2}><Check size={15} /> Bajarildi</Button></form>}
        {can.accept && <form action={actAcc}><Button variant="success" disabled={p3}><CheckCheck size={15} /> Qabul qilish</Button></form>}
        {can.ret && <Button variant="ghost" onClick={() => setOpen(open === "return" ? "" : "return")}><RotateCcw size={15} /> Qaytarish</Button>}
        {can.cancel && <Button variant="ghost" onClick={() => setOpen(open === "cancel" ? "" : "cancel")}><XCircle size={15} /> Bekor qilish</Button>}
      </div>
      {open && (
        <form action={open === "return" ? actRet : actCancel} className="flex max-w-xl gap-2">
          <Input name="note" required placeholder={open === "return" ? "Nimani qayta qilish kerak" : "Bekor qilish sababi"} />
          <Button variant={open === "cancel" ? "danger" : "secondary"} disabled={p4 || p5}>{open === "return" ? "Qaytarish" : "Bekor qilish"}</Button>
        </form>
      )}
      <FormError error={last?.error} />
      <FormSuccess text={last?.ok ? last.note : undefined} />
    </div>
  );
}

export function CommentForm({ id }: { id: string }) {
  const [state, act, pending] = useActionState(commentAction.bind(null, id), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useRefresh(state);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={act} className="flex gap-2">
      <Input name="text" required maxLength={2000} placeholder="Izoh yozing…" />
      <Button disabled={pending}><Send size={15} /></Button>
      <FormError error={state?.error} />
    </form>
  );
}
