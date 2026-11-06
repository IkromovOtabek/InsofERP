"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, MessageCircleQuestion, Printer, RefreshCw } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { replyOffer } from "./actions";

type T = { pubAccept: string; pubAsk: string; pubName: string; pubPhone: string; pubNote: string; pubNoteAccept: string; pubNoteAsk: string; pubSend: string; pubCancelBtn: string; pubPrint: string; qrAskNew: string; qrAskNewOffer: string };

const input = "h-12 w-full rounded-[14px] border-[1.5px] border-[#e2e8f0] bg-[#ffffff] px-3 text-base text-[#0f172b] focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/25";
const cta = "relative flex min-h-[58px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-[16px] px-4 text-[16px] font-extrabold";
const light = "flex min-h-[48px] items-center justify-center gap-2 rounded-[14px] bg-[#ffffff] px-3 text-[14px] font-bold text-[#0f172b] shadow-[inset_0_0_0_1.5px_#e2e8f0]";

/**
 * Mijozning javobi (QR ekran, artifakt «QR ochilish ekrani»): amaldagi taklifda — «Qabul qilaman» katta tugmasi,
 * «Savol berish» va chop etish; muddati o'tganda — «Yangilangan narx so'rash», bekor qilinganda — «Yangi taklif so'rash»
 * (ikkalasi ham savol sifatida yuboriladi). Oddiy HTML — ERP dizayn primitivlariga bog'lanmaydi (mijoz telefonida ochiladi).
 */
export function ReplyForm({ offerNo, k, variant, t }: { offerNo: string; k: string; variant: "active" | "expired" | "cancelled"; t: T }) {
  const [mode, setMode] = useState<"" | "accept" | "question">("");
  const [state, action, pending] = useActionState<ActionState, FormData>(replyOffer.bind(null, offerNo, k), undefined);

  if (state?.ok) {
    return (
      <div className="flex items-center gap-2 rounded-[18px] bg-[#ecfdf5] px-[18px] py-4 text-[14px] font-bold text-[#065f46]">
        <CheckCircle2 size={20} className="shrink-0" /> {state.note}
      </div>
    );
  }

  if (mode) {
    const title = mode === "accept" ? t.pubAccept : variant === "expired" ? t.qrAskNew : variant === "cancelled" ? t.qrAskNewOffer : t.pubAsk;
    return (
      <form action={action} className="flex flex-col gap-3 rounded-[18px] bg-[#ffffff] p-[18px] shadow-[0_1px_3px_rgba(15,23,42,.08)]">
        <input type="hidden" name="kind" value={mode} />
        <input type="text" name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <div className="text-[17px] font-extrabold">{title}</div>
        <label className="block text-[13px]"><span className="mb-1 block font-medium text-[#5f7088]">{t.pubName}</span><input name="name" required minLength={2} className={input} autoFocus /></label>
        <label className="block text-[13px]"><span className="mb-1 block font-medium text-[#5f7088]">{t.pubPhone}</span><input name="phone" required inputMode="tel" placeholder="+998 90 123 45 67" className={input} /></label>
        <label className="block text-[13px]"><span className="mb-1 block font-medium text-[#5f7088]">{t.pubNote}</span><textarea name="note" rows={3} placeholder={mode === "accept" ? t.pubNoteAccept : t.pubNoteAsk} className={`${input} h-auto py-2.5`} /></label>
        {state?.error && <div role="alert" className="rounded-[12px] bg-[#fef2f2] px-3 py-2 text-[14px] text-[#c10007] shadow-[inset_0_0_0_1.5px_#ffc9c9]">{state.error}</div>}
        <div className="flex gap-2">
          <button disabled={pending} className={`flex min-h-[50px] flex-1 items-center justify-center rounded-[14px] px-4 text-[15px] font-extrabold disabled:opacity-60 ${mode === "accept" ? "bg-[#f59e0b] text-[#0f172b]" : "bg-[#0f172b] text-[#ffffff]"}`}>{pending ? "…" : t.pubSend}</button>
          <button type="button" onClick={() => setMode("")} className={`${light} px-4`}>{t.pubCancelBtn}</button>
        </div>
      </form>
    );
  }

  if (variant === "expired") {
    return <button type="button" onClick={() => setMode("question")} className={`${cta} vf-shine bg-[#f59e0b] text-[#0f172b] shadow-[0_12px_26px_-12px_rgba(245,158,11,.9)]`}><RefreshCw size={20} aria-hidden /> {t.qrAskNew}</button>;
  }
  if (variant === "cancelled") {
    return <button type="button" onClick={() => setMode("question")} className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[14px] bg-[#0f172b] px-4 text-[15px] font-extrabold text-[#ffffff]"><MessageCircleQuestion size={18} aria-hidden /> {t.qrAskNewOffer}</button>;
  }
  return (
    <div className="flex flex-col gap-2.5">
      <button type="button" onClick={() => setMode("accept")} className={`${cta} vf-shine vf-breathe bg-[#f59e0b] text-[#0f172b]`}><CheckCircle2 size={20} aria-hidden /> {t.pubAccept}</button>
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => setMode("question")} className={light}><MessageCircleQuestion size={18} aria-hidden /> {t.pubAsk}</button>
        <button type="button" onClick={() => window.print()} className={light}><Printer size={18} aria-hidden /> {t.pubPrint}</button>
      </div>
    </div>
  );
}
