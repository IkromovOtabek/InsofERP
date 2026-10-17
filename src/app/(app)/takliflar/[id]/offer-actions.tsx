"use client";

import { useState, useTransition } from "react";
import { Ban, CheckCircle2, Copy, Check, ExternalLink } from "lucide-react";
import { Button, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { acceptOfferAction, cancelOfferAction } from "../actions";

/** Ommaviy havolani nusxalash — menejer mijozga Telegram/SMS orqali yuboradi. */
export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="max-w-full truncate rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">{url}</code>
      <Button type="button" variant="secondary" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard yopiq — foydalanuvchi qo'lda nusxalaydi */ } }}>
        {done ? <><Check size={14} /> Nusxalandi</> : <><Copy size={14} /> Havolani nusxalash</>}
      </Button>
      <a href={url} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1 text-xs text-slate-600 hover:text-slate-900"><ExternalLink size={13} /> Mijoz ko&apos;radigan sahifa</a>
    </div>
  );
}

/** Bekor qilish (sabab bilan) va «mijoz qabul qildi» (telefon orqali kelishilganda) — faqat amaldagi taklif uchun. */
export function OfferStateButtons({ id, canCancel, active }: { id: string; canCancel: boolean; active: boolean }) {
  const [mode, setMode] = useState<"" | "cancel" | "accept">("");
  const [text, setText] = useState("");
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();
  if (!canCancel || !active) return null;
  const submit = () => start(async () => {
    const r = mode === "cancel" ? await cancelOfferAction(id, text) : await acceptOfferAction(id, text);
    setState(r);
    if (r?.ok) { setMode(""); setText(""); }
  });
  return (
    <div className="flex flex-col items-start gap-2">
      {mode === "" ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="success" size="sm" onClick={() => { setMode("accept"); setState(undefined); }}><CheckCircle2 size={14} /> Mijoz qabul qildi</Button>
          <Button type="button" variant="ghost" size="sm" className="text-red-700" onClick={() => { setMode("cancel"); setState(undefined); }}><Ban size={14} /> Bekor qilish</Button>
        </div>
      ) : (
        <div className="flex w-full max-w-lg flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-medium">{mode === "cancel" ? "Taklifni bekor qilish — sababi" : "Kim, qanday qabul qildi (masalan: Alisher aka, telefon orqali)"}</div>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "cancel" ? "Narx o'zgardi / mijoz voz kechdi / xato tuzilgan…" : "Ism, qanday tasdiqladi"} autoFocus />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === "cancel" ? "danger" : "success"} disabled={pending || (mode === "cancel" && !text.trim())} onClick={submit}>{pending ? "…" : mode === "cancel" ? "Bekor qilish" : "Qabul qilindi deb belgilash"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("")}>Yopish</Button>
          </div>
        </div>
      )}
      {state?.error && <span role="alert" className="text-xs text-red-600">{state.error}</span>}
      {state?.ok && state.note && <span className="text-xs text-emerald-700">{state.note}</span>}
    </div>
  );
}
