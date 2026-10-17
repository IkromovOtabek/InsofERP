"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, UserCheck } from "lucide-react";
import {
  addInterviewAction, assignCourseAction, decideProbationAction, hireAction, interviewResultAction, moveCandidateAction, saveCandidateAction,
  saveCourseAction, saveOnbTemplateAction, saveVacancyAction, startPlanAction, stepAction, toggleCourseAction, vacancyStatusAction,
} from "./hr3-actions";
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { CANDIDATE_SOURCES, INTERVIEW_RESULT_LABEL, STAGE_LABEL } from "@/lib/hr/labels";
import type { ActionState } from "@/lib/action";
import type { CandidateStage, VacancyStatus } from "@/generated/prisma";

type Opt = { id: string; label: string };

/** Muvaffaqiyatdan keyin bir marta: sahifani yangilash va `after`. */
function useDone(state: ActionState, after?: () => void) {
  const router = useRouter();
  const cb = useRef(after);
  useEffect(() => { cb.current = after; });
  useEffect(() => { if (state?.ok) { router.refresh(); cb.current?.(); } }, [state, router]);
}

function Msg({ state, showOk = true }: { state: ActionState; showOk?: boolean }) {
  return <><FormError error={state?.error} />{showOk && <FormSuccess text={state?.ok ? state.note : undefined} />}</>;
}

/** Bitta tugma → server action (holat, belgilash). */
export function ActButton({ run, label, variant = "ghost", size = "sm" }: { run: () => Promise<ActionState>; label: React.ReactNode; variant?: "ghost" | "secondary" | "success" | "danger"; size?: "sm" | "md" }) {
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, setPending] = useState(false);
  useDone(state);
  return (
    <span className="inline-flex flex-col">
      <Button size={size} variant={variant} disabled={pending} onClick={async () => { setPending(true); setState(await run()); setPending(false); }}>{label}</Button>
      {state?.error && <span className="text-[11px] text-red-600">{state.error}</span>}
    </span>
  );
}

// ───────────────────────── Yollash ─────────────────────────

export type VacancyVals = { id: string; title: string; position: string; headcount: number; description: string | null; requirements: string | null; salaryFrom: number | null; salaryTo: number | null };

export function VacancyForm({ v, positions, onDone }: { v?: VacancyVals; positions: string[]; onDone?: () => void }) {
  const [state, act, pending] = useActionState(saveVacancyAction.bind(null, v?.id ?? null), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useDone(state, onDone ?? (() => ref.current?.reset()));
  return (
    <form ref={ref} action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_90px_130px_130px]">
        <Field label="Vakansiya *"><Input name="title" required defaultValue={v?.title} placeholder="Masalan: Mikser haydovchisi" /></Field>
        <Field label="Lavozim *"><Input name="position" required list="hr-positions" defaultValue={v?.position} /></Field>
        <Field label="Soni"><Input type="number" name="headcount" min={1} max={500} defaultValue={v?.headcount ?? 1} /></Field>
        <Field label="Maosh dan"><Input type="number" name="salaryFrom" min={0} step={100000} defaultValue={v?.salaryFrom ?? undefined} /></Field>
        <Field label="gacha"><Input type="number" name="salaryTo" min={0} step={100000} defaultValue={v?.salaryTo ?? undefined} /></Field>
      </div>
      <datalist id="hr-positions">{positions.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Vazifalar"><Textarea name="description" rows={2} defaultValue={v?.description ?? ""} /></Field>
        <Field label="Talablar"><Textarea name="requirements" rows={2} defaultValue={v?.requirements ?? ""} /></Field>
      </div>
      <Msg state={state} showOk={!onDone} />
      <div className="flex gap-2">
        <Button disabled={pending}>{v ? "Saqlash" : <><Plus size={14} /> Vakansiya ochish</>}</Button>
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Bekor</Button>}
      </div>
    </form>
  );
}

export function VacancyRowActions({ v, status, positions }: { v: VacancyVals; status: VacancyStatus; positions: string[] }) {
  const [edit, setEdit] = useState(false);
  if (edit) return <div className="min-w-[360px] text-left"><VacancyForm v={v} positions={positions} onDone={() => setEdit(false)} /></div>;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Tahrirlash</Button>
      {status === "OPEN" && <ActButton run={() => vacancyStatusAction(v.id, "PAUSED")} label="To'xtatish" />}
      {status !== "OPEN" && <ActButton run={() => vacancyStatusAction(v.id, "OPEN")} label="Ochish" />}
      {status !== "CLOSED" && <ActButton run={() => vacancyStatusAction(v.id, "CLOSED")} label="Yopish" />}
    </div>
  );
}

export type CandVals = { id: string; vacancyId: string | null; fullName: string; phone: string | null; source: string | null; rating: number | null; note: string | null };

export function CandidateForm({ c, vacancies, onDone }: { c?: CandVals; vacancies: Opt[]; onDone?: () => void }) {
  const [state, act, pending] = useActionState(saveCandidateAction.bind(null, c?.id ?? null), undefined);
  useDone(state, onDone);
  return (
    <form action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_90px]">
        <Field label="F.I.O. *"><Input name="fullName" required defaultValue={c?.fullName} /></Field>
        <Field label="Telefon"><Input name="phone" defaultValue={c?.phone ?? ""} placeholder="+998 90 123 45 67" /></Field>
        <Field label="Vakansiya">
          <Select name="vacancyId" defaultValue={c?.vacancyId ?? ""}>
            <option value="">— vakansiyasiz (zaxira)</option>
            {vacancies.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Manba">
          <Select name="source" defaultValue={c?.source ?? ""}><option value="">—</option>{CANDIDATE_SOURCES.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Baho"><Select name="rating" defaultValue={c?.rating ? String(c.rating) : ""}><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Izoh"><Textarea name="note" rows={2} defaultValue={c?.note ?? ""} /></Field>
        <Field label="Rezyume (PDF yoki rasm)"><Input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></Field>
      </div>
      <Msg state={state} />
      <Button disabled={pending}>{c ? "Saqlash" : <><Plus size={14} /> Nomzod qo&apos;shish</>}</Button>
    </form>
  );
}

/** Bosqich tugmalari (rad etishda sabab so'raladi). */
export function StageButtons({ id, stage }: { id: string; stage: CandidateStage }) {
  const [rejecting, setRejecting] = useState(false);
  const [state, act, pending] = useActionState(moveCandidateAction.bind(null, id, "REJECTED"), undefined);
  useDone(state, () => setRejecting(false));
  const go = (to: CandidateStage) => moveCandidateAction(id, to, undefined, new FormData());
  const next: CandidateStage[] = (["NEW", "SCREEN", "INTERVIEW", "OFFER", "RESERVE"] as CandidateStage[]).filter((s) => s !== stage);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {next.map((s) => <ActButton key={s} run={() => go(s)} label={`→ ${STAGE_LABEL[s]}`} variant="secondary" />)}
        {stage !== "REJECTED" && <Button size="sm" variant="ghost" onClick={() => setRejecting((v) => !v)}>Rad etish</Button>}
      </div>
      {rejecting && (
        <form action={act} className="flex max-w-lg gap-2">
          <Input name="reason" required placeholder="Rad etish sababi" />
          <Button size="sm" variant="danger" disabled={pending}>Rad etish</Button>
        </form>
      )}
      <FormError error={state?.error} />
    </div>
  );
}

export function InterviewForm({ candidateId, users }: { candidateId: string; users: Opt[] }) {
  const [state, act, pending] = useActionState(addInterviewAction.bind(null, candidateId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useDone(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={act} className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_1fr_auto] sm:items-end">
        <Field label="Vaqti *"><Input type="datetime-local" name="at" required /></Field>
        <Field label="Joyi"><Input name="place" placeholder="Ofis, Telegram qo'ng'iroq…" /></Field>
        <Field label="Suhbatchi"><Select name="interviewerId" defaultValue=""><option value="">— kadr o&apos;zi</option>{users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
        <Button disabled={pending}><Plus size={14} /> Belgilash</Button>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function InterviewResultForm({ id, candidateId, result, feedback }: { id: string; candidateId: string; result: string; feedback: string | null }) {
  const [state, act, pending] = useActionState(interviewResultAction.bind(null, id, candidateId), undefined);
  useDone(state);
  return (
    <form action={act} className="flex flex-wrap items-center gap-2">
      <Select name="result" defaultValue={result} className="h-8 w-36 text-xs">{Object.entries(INTERVIEW_RESULT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      <Input name="feedback" defaultValue={feedback ?? ""} placeholder="Xulosa" className="h-8 min-w-48 flex-1 text-xs" />
      <Button size="sm" variant="ghost" disabled={pending}><Check size={13} /></Button>
      <FormError error={state?.error} />
    </form>
  );
}

export function HireForm({ id, position, employees }: { id: string; position: string; employees: Opt[] }) {
  const [state, act, pending] = useActionState(hireAction.bind(null, id), undefined);
  const today = new Date().toLocaleDateString("sv-SE");
  return (
    <form action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Lavozim *"><Input name="position" required defaultValue={position} list="hr-positions" /></Field>
        <Field label="Ishga kirish sanasi *"><Input type="date" name="hiredAt" required defaultValue={today} /></Field>
        <Field label="Murabbiy"><Select name="mentorId" defaultValue=""><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</Select></Field>
        <Field label="Sinov muddati, oy"><Input type="number" name="probationMonths" min={0} max={12} defaultValue={3} /></Field>
      </div>
      <FormError error={state?.error} />
      <Button variant="success" disabled={pending}><UserCheck size={15} /> {pending ? "Qabul qilinmoqda…" : "Ishga qabul qilish — kartani ochish"}</Button>
      <p className="text-xs text-slate-500">Xodim kartasi va moslashuv rejasi ochiladi; hujjatlar (ariza, shartnoma, buyruq) — kartadagi «Kadr hujjatlari»dan.</p>
    </form>
  );
}

// ───────────────────────── Moslashuv ─────────────────────────

export function StartPlanForm({ employees }: { employees: Opt[] }) {
  const [state, act, pending] = useActionState(startPlanAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useDone(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={act} className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1.5fr_150px_110px_auto] sm:items-end">
        <Field label="Xodim *"><Select name="employeeId" required defaultValue=""><option value="" disabled>Tanlang</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</Select></Field>
        <Field label="Murabbiy"><Select name="mentorId" defaultValue=""><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</Select></Field>
        <Field label="Boshlanishi *"><Input type="date" name="startDate" required defaultValue={new Date().toLocaleDateString("sv-SE")} /></Field>
        <Field label="Sinov, oy"><Input type="number" name="probationMonths" min={0} max={12} defaultValue={3} /></Field>
        <Button disabled={pending}><Plus size={14} /> Reja ochish</Button>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function StepToggle({ id, done, label, run }: { id: string; done: boolean; label: string; run?: (id: string, done: boolean) => Promise<ActionState> }) {
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, setPending] = useState(false);
  useDone(state);
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={done} disabled={pending} className="h-4 w-4 rounded border-slate-300"
        onChange={async (e) => { setPending(true); setState(await (run ?? stepAction)(id, e.target.checked)); setPending(false); }} />
      <span className={done ? "text-slate-500 line-through" : ""}>{label}</span>
      {state?.error && <span className="text-[11px] text-red-600">{state.error}</span>}
    </label>
  );
}

export function ProbationForm({ planId }: { planId: string }) {
  const [state, act, pending] = useActionState(decideProbationAction.bind(null, planId), undefined);
  const [status, setStatus] = useState("PASSED");
  useDone(state);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40 text-xs">
        <option value="PASSED">Sinovdan o&apos;tdi</option><option value="EXTENDED">Uzaytirish</option><option value="FAILED">O&apos;tmadi</option>
      </Select>
      {status === "EXTENDED" && <Input type="date" name="extendTo" required className="h-8 w-40 text-xs" />}
      <Input name="note" placeholder={status === "FAILED" ? "Sababi *" : "Izoh"} required={status === "FAILED"} className="h-8 min-w-40 flex-1 text-xs" />
      <Button size="sm" disabled={pending}>Qayd etish</Button>
      <FormError error={state?.error} />
    </form>
  );
}

export function OnbTemplateForm({ t, positions }: { t?: { id: string; name: string; position: string | null; text: string }; positions: string[] }) {
  const [state, act, pending] = useActionState(saveOnbTemplateAction.bind(null, t?.id ?? null), undefined);
  useDone(state);
  return (
    <form action={act} className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Shablon nomi *"><Input name="name" required defaultValue={t?.name ?? "Umumiy moslashuv"} /></Field>
        <Field label="Lavozim" hint="Bo'sh — hamma uchun"><Select name="position" defaultValue={t?.position ?? ""}><option value="">Hamma uchun</option>{positions.map((p) => <option key={p}>{p}</option>)}</Select></Field>
      </div>
      <Field label="Qadamlar *" hint="Har qatorda «kun: qadam», masalan «3: Xavfsizlik yo'riqnomasi»"><Textarea name="steps" rows={6} required defaultValue={t?.text} /></Field>
      <Msg state={state} />
      <Button size="sm" disabled={pending}>Saqlash</Button>
    </form>
  );
}

// ───────────────────────── O'qitish ─────────────────────────

export type CourseVals = { id: string; title: string; description: string | null; material: string | null; contentUrl: string | null; position: string | null; mandatory: boolean; questionsText: string; passScore: number; validMonths: number | null };

export function CourseForm({ c, positions }: { c?: CourseVals; positions: string[] }) {
  const [state, act, pending] = useActionState(saveCourseAction.bind(null, c?.id ?? null), undefined);
  useDone(state);
  return (
    <form action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.2fr_100px_110px]">
        <Field label="Kurs nomi *"><Input name="title" required defaultValue={c?.title} placeholder="Masalan: Xavfsizlik texnikasi" /></Field>
        <Field label="Lavozim" hint="Tanlansa — shu lavozimga o'zi biriktiriladi"><Select name="position" defaultValue={c?.position ?? ""}><option value="">—</option>{positions.map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="O'tish bali, %"><Input type="number" name="passScore" min={1} max={100} defaultValue={c?.passScore ?? 70} /></Field>
        <Field label="Sertifikat, oy" hint="Bo'sh — muddatsiz"><Input type="number" name="validMonths" min={1} max={120} defaultValue={c?.validMonths ?? undefined} /></Field>
      </div>
      <Field label="Qisqacha"><Input name="description" defaultValue={c?.description ?? ""} /></Field>
      <Field label="Material (matn)"><Textarea name="material" rows={6} defaultValue={c?.material ?? ""} /></Field>
      <Field label="Video / hujjat havolasi"><Input name="contentUrl" type="url" defaultValue={c?.contentUrl ?? ""} placeholder="https://…" /></Field>
      <Field label="Test savollari *" hint="Bloklar bo'sh qator bilan: birinchi qator — savol, «+» — to'g'ri javob, «-» — noto'g'ri">
        <Textarea name="questions" rows={10} required defaultValue={c?.questionsText} placeholder={"Mikser barabani qachon tozalanadi?\n+ Har smena oxirida\n- Haftada bir marta\n- Faqat buzilganda"} className="font-mono text-xs" />
      </Field>
      <Checkbox name="mandatory" label="Majburiy kurs" defaultChecked={c?.mandatory} />
      <Msg state={state} />
      <Button disabled={pending}>{c ? "Saqlash" : <><Plus size={14} /> Kurs qo&apos;shish</>}</Button>
    </form>
  );
}

export function CourseToggle({ id, active }: { id: string; active: boolean }) {
  return <ActButton run={() => toggleCourseAction(id)} label={active ? "O'chirish" : "Yoqish"} />;
}

export function AssignForm({ courseId, employees, positions }: { courseId: string; employees: Opt[]; positions: string[] }) {
  const [state, act, pending] = useActionState(assignCourseAction.bind(null, courseId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [q, setQ] = useState("");
  useDone(state, () => ref.current?.reset());
  const list = employees.filter((e) => !q || e.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <form ref={ref} action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
        <Field label="Yoki butun lavozimga"><Select name="position" defaultValue=""><option value="">—</option>{positions.map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Muddat"><Input type="date" name="dueDate" /></Field>
      </div>
      <Input placeholder="Xodimni qidirish…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
        {list.map((e) => (
          <label key={e.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
            <input type="checkbox" name="emp" value={e.id} className="h-4 w-4 rounded border-slate-300" /> {e.label}
          </label>
        ))}
      </div>
      <Msg state={state} />
      <Button disabled={pending}><Plus size={14} /> Biriktirish</Button>
    </form>
  );
}
