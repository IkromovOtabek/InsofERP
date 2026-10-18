"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { isAccessDenied } from "@/lib/access-denied";

/**
 * Chiqim jurnalidagi «Storno» tugmasi — `payments/confirm-button.tsx` (ConfirmButton, reason="required") uslubida:
 * birinchi bosishda savol va sabab maydoni, sababsiz (3 belgidan kam) yuborilmaydi.
 */
export function StornoButton({ action, question }: { action: (reason: string) => Promise<ActionState>; question: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [why, setWhy] = useState("");
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    try {
      const res = await action(why.trim());
      if (res?.error) { setState(res); return; }
      setState({ ok: true, note: res?.note });
      setArmed(false); setWhy("");
      router.refresh();
    } catch (e) {
      setState({ error: isAccessDenied(e) ? "Bekor qilishga huquq yo'q — direktorga murojaat qiling" : "Bajarilmadi — sahifani yangilab, qaytadan urinib ko'ring" });
    }
  });

  if (state?.error) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-red-600">
        {state.error}
        <button type="button" onClick={() => setState(undefined)} className="font-medium underline">yopish</button>
      </span>
    );
  }
  if (state?.ok && !armed) return <span className="text-xs whitespace-nowrap text-emerald-700">Bekor qilindi</span>;
  if (armed) {
    const blocked = why.trim().length < 3;
    return (
      <span className="inline-flex min-w-56 flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-600">{question}</span>
        <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Sabab (majburiy)" aria-label="Bekor qilish sababi"
          className="h-7 w-44 rounded-md border border-slate-300 bg-white px-2 text-xs" autoFocus maxLength={300} />
        <button type="button" onClick={run} disabled={pending || blocked} className="font-semibold text-red-600 hover:underline disabled:opacity-40">
          {pending ? "bajarilmoqda…" : "ha"}
        </button>
        <button type="button" onClick={() => { setArmed(false); setWhy(""); }} disabled={pending} className="text-slate-500 hover:underline">yo'q</button>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => { setState(undefined); setArmed(true); }} title="Chiqimni bekor qilish"
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-red-600 transition hover:bg-red-50">
      <Undo2 size={13} /> Bekor qilish
    </button>
  );
}
