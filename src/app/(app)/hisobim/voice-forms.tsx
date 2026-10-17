"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { answerSurveyAction, myFeedbackReplyAction, sendFeedbackAction } from "./hr-actions";
import type { ActionState } from "@/lib/action";

function useOk(state: ActionState, reset?: () => void) {
  const router = useRouter();
  const cb = useRef(reset);
  useEffect(() => { cb.current = reset; });
  useEffect(() => { if (state?.ok) { router.refresh(); cb.current?.(); } }, [state, router]);
}

type Q = { key: string; text: string; type: "nps" | "scale5" | "choice" | "text"; options?: string[] };

/** So'rovnomaga javob: NPS (0–10), baho (1–5), variant, erkin matn. */
export function SurveyAnswerForm({ id, questions, anonymous }: { id: string; questions: Q[]; anonymous: boolean }) {
  const [state, act, pending] = useActionState(answerSurveyAction.bind(null, id), undefined);
  useOk(state);
  return (
    <form action={act} className="space-y-4">
      {questions.map((q) => (
        <fieldset key={q.key} className="space-y-1.5">
          <legend className="text-sm font-medium">{q.text}</legend>
          {q.type === "nps" && <div className="flex flex-wrap gap-1">{Array.from({ length: 11 }, (_, n) => <label key={n} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"><input type="radio" name={q.key} value={n} required className="sr-only" />{n}</label>)}</div>}
          {q.type === "scale5" && <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <label key={n} className="flex h-9 w-11 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"><input type="radio" name={q.key} value={n} required className="sr-only" />{"★".repeat(n)}</label>)}</div>}
          {q.type === "choice" && <Select name={q.key} required defaultValue=""><option value="" disabled>Tanlang</option>{(q.options ?? []).map((o) => <option key={o}>{o}</option>)}</Select>}
          {q.type === "text" && <Textarea name={q.key} rows={2} maxLength={2000} />}
        </fieldset>
      ))}
      <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
      <Button disabled={pending}><Send size={15} /> Yuborish{anonymous ? " (anonim)" : ""}</Button>
    </form>
  );
}

/** Murojaat (HR chat): shikoyat, taklif, savol — anonim bo'lishi mumkin. */
export function FeedbackForm() {
  const [state, act, pending] = useActionState(sendFeedbackAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useOk(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Turi"><Select name="kind" defaultValue="QUESTION"><option value="QUESTION">Savol</option><option value="SUGGESTION">Taklif</option><option value="COMPLAINT">Shikoyat</option><option value="THANKS">Minnatdorchilik</option></Select></Field>
        <Field label="Mavzu *"><Input name="subject" required maxLength={150} /></Field>
      </div>
      <Field label="Matn *"><Textarea name="text" rows={3} required maxLength={4000} /></Field>
      <Checkbox name="anonymous" label="Anonim — ismim otdel kadrga ko'rinmasin" />
      <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
      <Button disabled={pending}><Send size={15} /> Yuborish</Button>
    </form>
  );
}

export function MyReplyForm({ id }: { id: string }) {
  const [state, act, pending] = useActionState(myFeedbackReplyAction.bind(null, id), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useOk(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={act} className="flex gap-2">
      <Textarea name="text" rows={2} required placeholder="Javob yozing…" />
      <Button disabled={pending}><Send size={15} /></Button>
      <FormError error={state?.error} />
    </form>
  );
}
