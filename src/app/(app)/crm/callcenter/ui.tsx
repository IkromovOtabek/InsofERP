"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCheck, Hand, Phone } from "lucide-react";
import { Button, FormError, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/action";
import { dialAction, handleCallAction, lookupPhoneAction, takeCallAction } from "./actions";

/** Navbat qatoridagi «Men olaman» / «Hal qilindi» */
export function QueueButtons({ ids, takenByMe, takenByOther }: { ids: string[]; takenByMe: boolean; takenByOther: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(undefined);
  const run = (fn: (ids: string[]) => Promise<ActionState>) => start(async () => setMsg(await fn(ids)));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!takenByMe && (
        <button type="button" disabled={pending || !!takenByOther} onClick={() => run(takeCallAction)}
          title={takenByOther ? `${takenByOther} olgan` : undefined}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Hand size={14} /> Men olaman
        </button>
      )}
      <button type="button" disabled={pending} onClick={() => run(handleCallAction)}
        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        <CheckCheck size={14} /> Hal qilindi
      </button>
      {msg?.error && <span className="text-xs text-red-600">{msg.error}</span>}
    </div>
  );
}

/** Raqamga qo'ng'iroq (mijoz kartasi bo'lmasa ham): onlinePBX bo'lsa — kompyuterdan, aks holda `tel:` */
export function CallNumber({ phone, pbx, label = "Qo'ng'iroq" }: { phone: string; pbx: boolean; label?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(undefined);
  const cls = "inline-flex min-h-9 items-center gap-1 rounded-lg bg-emerald-500 px-2.5 text-[13px] font-medium text-white hover:bg-emerald-600 disabled:opacity-60";
  if (!pbx) return <a href={`tel:${phone}`} className={cls}><Phone size={14} /> {label}</a>;
  return (
    <span className="relative inline-flex">
      <button type="button" disabled={pending} className={cls} onClick={() => start(async () => {
        const fd = new FormData(); fd.set("phone", phone);
        const r = await dialAction(undefined, fd);
        setMsg(r); setTimeout(() => setMsg(undefined), 8000);
      })}>
        <Phone size={14} className={cn(pending && "animate-pulse")} /> {pending ? "Ulanmoqda…" : label}
      </button>
      {msg && (
        <span role="status" className={cn("absolute right-0 top-full z-30 mt-2 w-64 rounded-lg px-3 py-2 text-left text-xs shadow-lg ring-1",
          msg.error ? "bg-red-50 text-red-700 ring-red-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200")}>
          {msg.error ?? msg.note}
        </span>
      )}
    </span>
  );
}

/** Terish paneli: raqam → bazadagi mijozni ko'rsatadi → onlinePBX orqali qo'ng'iroq */
export function DialPad({ pbx }: { pbx: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(dialAction, undefined);
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [, startLookup] = useTransition();
  const lookup = (v: string) => {
    setFound(undefined);
    if (v.replace(/\D/g, "").length < 9) return;
    startLookup(async () => setFound(await lookupPhoneAction(v)));
  };
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}
      className="grid gap-2"
    >
      <div className="flex gap-2">
        <Input name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="90 123 45 67" value={phone}
          onChange={(e) => { setPhone(e.target.value); lookup(e.target.value); }} aria-label="Telefon raqami" aria-invalid={state?.field === "phone"} className="text-base" />
        {pbx ? (
          <Button type="submit" disabled={pending || !phone.trim()}><Phone size={15} /> {pending ? "Ulanmoqda…" : "Qo'ng'iroq"}</Button>
        ) : (
          <a href={phone.trim() ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white aria-disabled:opacity-50" aria-disabled={!phone.trim()}>
            <Phone size={15} /> Qo&apos;ng&apos;iroq
          </a>
        )}
      </div>
      {found && <p className="text-sm text-slate-600">Bazada: <Link href={`/crm/mijozlar/${found.id}`} className="font-medium text-slate-900 underline">{found.name}</Link></p>}
      {found === null && <p className="text-sm text-slate-500">Bazada yo&apos;q — <Link href={`/crm/mijozlar/new?phone=${encodeURIComponent(phone)}`} className="font-medium text-slate-900 underline">mijoz yaratish</Link></p>}
      {state?.ok && <p role="status" className="text-sm text-emerald-700">{state.note}</p>}
      <FormError error={state?.error} />
      {!pbx && <p className="text-xs text-slate-500">onlinePBX ulanmagan yoki sizga ichki raqam berilmagan — qo&apos;ng&apos;iroq telefoningizdan ochiladi.</p>}
    </form>
  );
}
