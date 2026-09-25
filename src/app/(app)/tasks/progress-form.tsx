"use client";

import { useActionState, useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { addProgress } from "./actions";
import { Button, Input } from "@/components/ui";

export function ProgressForm({ taskId, remaining, unit }: { taskId: string; remaining: number; unit: string }) {
  const [state, action, pending] = useActionState(addProgress.bind(null, taskId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex items-center gap-1.5">
      <Input name="qty" type="number" step="any" min="0" max={remaining} placeholder={`${unit}`} className="h-8 w-24 text-xs" required />
      <Button disabled={pending} variant="secondary" className="h-8 px-2 text-xs"><Check size={14} /> Bajarildi</Button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      {/* Tasdiq: qancha mahsulot hovliga kirim bo'ldi, zayavka yopildimi, xomashyo yetdimi */}
      {state?.ok && state.note && <span className="text-xs text-emerald-700">{state.note}</span>}
    </form>
  );
}
