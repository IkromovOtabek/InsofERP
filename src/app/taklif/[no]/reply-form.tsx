"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, MessageCircleQuestion, Printer } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { replyOffer } from "./actions";

type T = { pubAccept: string; pubAsk: string; pubName: string; pubPhone: string; pubNote: string; pubNoteAccept: string; pubNoteAsk: string; pubSend: string; pubCancelBtn: string; pubPrint: string };

const input = "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30";

/**
 * Mijozning javobi: «Qabul qilaman» (faqat amaldagi taklifda) yoki «Savol berish».
 * Oddiy HTML — ERP dizayn primitivlariga bog'lanmaydi (bu sahifa mijoz telefonida ochiladi).
 */
export function ReplyForm({ offerNo, k, canAccept, t }: { offerNo: string; k: string; canAccept: boolean; t: T }) {
  const [mode, setMode] = useState<"" | "accept" | "question">("");
  const [state, action, pending] = useActionState<ActionState, FormData>(replyOffer.bind(null, offerNo, k), undefined);

  if (state?.ok) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
        <div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={20} /> {state.note}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 print:hidden">
      {mode === "" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {canAccept && <button type="button" onClick={() => setMode("accept")} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-semibold text-white shadow-sm hover:bg-emerald-700"><CheckCircle2 size={18} /> {t.pubAccept}</button>}
          <button type="button" onClick={() => setMode("question")} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-base font-medium text-slate-800 hover:bg-slate-50"><MessageCircleQuestion size={18} /> {t.pubAsk}</button>
          <button type="button" onClick={() => window.print()} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-base font-medium text-slate-800 hover:bg-slate-50"><Printer size={18} /> {t.pubPrint}</button>
        </div>
      ) : (
        <form action={action} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <input type="hidden" name="kind" value={mode} />
          <input type="text" name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <div className="text-base font-semibold">{mode === "accept" ? t.pubAccept : t.pubAsk}</div>
          <label className="block text-sm"><span className="mb-1 block text-slate-600">{t.pubName}</span><input name="name" required minLength={2} className={input} autoFocus /></label>
          <label className="block text-sm"><span className="mb-1 block text-slate-600">{t.pubPhone}</span><input name="phone" required inputMode="tel" placeholder="+998 90 123 45 67" className={input} /></label>
          <label className="block text-sm"><span className="mb-1 block text-slate-600">{t.pubNote}</span><textarea name="note" rows={3} placeholder={mode === "accept" ? t.pubNoteAccept : t.pubNoteAsk} className={`${input} h-auto py-2`} /></label>
          {state?.error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
          <div className="flex gap-2">
            <button disabled={pending} className={`inline-flex h-11 flex-1 items-center justify-center rounded-xl px-4 text-base font-semibold text-white shadow-sm disabled:opacity-60 ${mode === "accept" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-900 hover:bg-slate-800"}`}>{pending ? "…" : t.pubSend}</button>
            <button type="button" onClick={() => setMode("")} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-700">{t.pubCancelBtn}</button>
          </div>
        </form>
      )}
    </div>
  );
}
