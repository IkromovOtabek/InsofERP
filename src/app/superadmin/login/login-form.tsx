"use client";

import { useActionState, useState } from "react";
import { ArrowLeft, KeyRound, LogIn, ShieldCheck, Smartphone } from "lucide-react";
import { Button, Field, FormError, Input, PasswordInput } from "@/components/ui";
import { adminEcoLoginAction, adminLoginAction, cancelTwoFactorAction, verifyTwoFactorAction } from "./actions";

/** `eco` — control.env da ECO sozlangan: "ECO ilovasi (telefon)" tabi ko'rinadi. */
export function AdminLoginForm({ eco }: { eco: boolean }) {
  const [tab, setTab] = useState<"password" | "eco">("password");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-[26px] font-bold leading-tight tracking-tight text-slate-900"><ShieldCheck size={26} strokeWidth={2.2} aria-hidden /> Panelga kirish</h1>
        <p className="mt-1 text-sm text-slate-500">Faqat platforma administratorlari uchun. Korxona xodimlari o&apos;z manzilidan kiradi.</p>
      </div>
      {eco && (
        <div role="tablist" aria-label="Kirish usuli" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
          <TabButton active={tab === "password"} onClick={() => setTab("password")}><KeyRound size={15} aria-hidden /> Login/parol</TabButton>
          <TabButton active={tab === "eco"} onClick={() => setTab("eco")}><Smartphone size={15} aria-hidden /> ECO ilovasi (telefon)</TabButton>
        </div>
      )}
      <div role={eco ? "tabpanel" : undefined}>{eco && tab === "eco" ? <EcoForm /> : <PasswordForm />}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-center font-semibold leading-tight ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
      {children}
    </button>
  );
}

function PasswordForm() {
  const [state, action, pending] = useActionState(adminLoginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Login"><Input name="login" autoComplete="username" required autoFocus /></Field>
      <Field label="Parol"><PasswordInput name="password" autoComplete="current-password" required /></Field>
      <FormError error={state?.error} />
      <Button size="lg" className="w-full" disabled={pending}><LogIn size={16} aria-hidden /> Kirish</Button>
    </form>
  );
}

function EcoForm() {
  const [state, action, pending] = useActionState(adminEcoLoginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Telefon" hint="Insof ECO ilovasidagi raqam"><Input name="phone" type="tel" inputMode="tel" autoComplete="username" placeholder="+998 90 123 45 67" required autoFocus /></Field>
      <Field label="ECO ilovasi paroli"><PasswordInput name="password" autoComplete="current-password" required /></Field>
      <FormError error={state?.error} />
      <Button size="lg" className="w-full" disabled={pending}><LogIn size={16} aria-hidden /> {pending ? "Tekshirilmoqda…" : "Kirish"}</Button>
      <p className="text-xs text-slate-500">ECO hisobi panelda oldindan ulangan bo&apos;lishi kerak (IT jamoasi → Mening hisobim).</p>
    </form>
  );
}

/** 2-bosqich: parol to'g'ri, 2FA yoqilgan — autentifikator ilovasidagi kod yoki zaxira kod. */
export function TwoFactorForm() {
  const [state, action, pending] = useActionState(verifyTwoFactorAction, undefined);
  const [recovery, setRecovery] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-[26px] font-bold leading-tight tracking-tight text-slate-900"><ShieldCheck size={26} strokeWidth={2.2} aria-hidden /> Tasdiqlash kodi</h1>
        <p className="mt-1 text-sm text-slate-500">{recovery ? "Zaxira kodlardan birini kiriting (har biri bir marta ishlaydi)." : "Autentifikator ilovasidagi (Google Authenticator va h.k.) 6 raqamli kodni kiriting."}</p>
      </div>
      <form action={action} className="space-y-4">
        {recovery
          ? <Field label="Zaxira kod"><Input key="rc" name="code" autoComplete="off" spellCheck={false} placeholder="abcd-efgh" required autoFocus maxLength={20} /></Field>
          : <Field label="Kod"><Input key="totp" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" placeholder="123 456" required autoFocus maxLength={7} /></Field>}
        <FormError error={state?.error} />
        <Button size="lg" className="w-full" disabled={pending}><LogIn size={16} aria-hidden /> {pending ? "Tekshirilmoqda…" : "Tasdiqlash"}</Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" className="font-medium text-slate-600 underline-offset-2 hover:underline" onClick={() => setRecovery((v) => !v)}>
          {recovery ? "Ilovadagi kod bilan" : "Telefon yo'qmi? Zaxira kod bilan"}
        </button>
        <form action={cancelTwoFactorAction}>
          <button className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"><ArrowLeft size={14} aria-hidden /> Boshqa hisob</button>
        </form>
      </div>
    </div>
  );
}
