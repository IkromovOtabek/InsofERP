"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Award, Send } from "lucide-react";
import { Button, Callout, FormError } from "@/components/ui";
import { takeTestAction, type TestState } from "./hr-actions";

/** Test: har savolga bitta javob; natija darhol (to'g'ri javoblar ko'rsatilmaydi — qayta topshirish mumkin). */
export function TestForm({ courseId, questions, enrollmentId }: { courseId: string; enrollmentId: string; questions: { n: number; q: string; options: string[] }[] }) {
  const [state, act, pending] = useActionState<TestState, FormData>(takeTestAction.bind(null, courseId), undefined);
  return (
    <form action={act} className="space-y-4">
      <input type="hidden" name="total" value={questions.length} />
      {questions.map((x) => (
        <fieldset key={x.n} className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium">{x.n + 1}. {x.q}</legend>
          <div className="space-y-1">
            {x.options.map((o, i) => (
              <label key={i} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                <input type="radio" name={`a${x.n}`} value={i} required className="h-4 w-4" /> {o}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <FormError error={state?.error} />
      {state?.ok && (
        <Callout tone={state.passed ? "success" : "warning"} title={state.passed ? `O'tdingiz — ${state.score}%` : `O'tmadingiz — ${state.score}% (kerak ${state.passScore}%)`}>
          {state.correct} / {state.total} to&apos;g&apos;ri.{" "}
          {state.passed && state.certificateNo
            ? <Link href={`/hisobim/sertifikat/${enrollmentId}`} className="inline-flex items-center gap-1 underline"><Award size={14} /> Sertifikat {state.certificateNo}</Link>
            : "Materialni qayta o'qib, yana topshiring."}
        </Callout>
      )}
      <Button disabled={pending}><Send size={15} /> {pending ? "Tekshirilmoqda…" : "Topshirish"}</Button>
    </form>
  );
}
