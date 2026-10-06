"use client";

import { useActionState, useState } from "react";
import { KeyRound, LogIn, ShieldCheck, Smartphone } from "lucide-react";
import { Button, Field, FormError, Input, PasswordInput } from "@/components/ui";
import { adminEcoLoginAction, adminLoginAction } from "./actions";

/** `eco` — control.env da ECO sozlangan: "ECO ilovasi (telefon)" tabi ko'rinadi. */
export function AdminLoginForm({ eco }: { eco: boolean }) {
  const [tab, setTab] = useState<"password" | "eco">("password");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-violet-700"><ShieldCheck size={22} /><span className="text-lg font-semibold text-slate-900">Insof platforma — IT panel</span></div>
      <p className="text-sm text-slate-500">Faqat platforma administratorlari uchun. Korxona xodimlari o&apos;z manzilidan kiradi.</p>
      {eco && (
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          <TabButton active={tab === "password"} onClick={() => setTab("password")}><KeyRound size={14} /> Login/parol</TabButton>
          <TabButton active={tab === "eco"} onClick={() => setTab("eco")}><Smartphone size={14} /> ECO ilovasi (telefon)</TabButton>
        </div>
      )}
      {eco && tab === "eco" ? <EcoForm /> : <PasswordForm />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
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
      <Button className="w-full" disabled={pending}><LogIn size={16} /> Kirish</Button>
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
      <Button className="w-full" disabled={pending}><LogIn size={16} /> {pending ? "Tekshirilmoqda…" : "Kirish"}</Button>
      <p className="text-xs text-slate-500">ECO hisobi panelda oldindan ulangan bo&apos;lishi kerak (IT jamoasi → Mening hisobim).</p>
    </form>
  );
}
