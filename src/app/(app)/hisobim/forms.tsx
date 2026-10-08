"use client";

import { useActionState, useEffect, useState } from "react";
import { KeyRound, Save, Send } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, PasswordInput } from "@/components/ui";
import { PASSWORD_HINT } from "@/lib/password-policy";
import { changeSelfCredentials, saveMyProfile, sendSelfCode } from "./actions";

/** Direktor: o'z F.I.O. si. */
export function ProfileForm({ fullName }: { fullName: string }) {
  const [state, action, pending] = useActionState(saveMyProfile, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <Field label="F.I.O."><Input name="fullName" defaultValue={fullName} required maxLength={120} /></Field>
      <Button disabled={pending}><Save size={16} /> Saqlash</Button>
      <div className="sm:col-span-2">
        <FormError error={state?.error} />
        <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
      </div>
    </form>
  );
}

/**
 * Login va parol: raqam bor bo'lsa — avval Telegram kodi, keyin yangi qiymatlar va kod.
 * Raqam yo'q bo'lsa — joriy parol bilan tasdiq.
 */
export function CredentialsForm({ login, phone }: { login: string; phone: string | null }) {
  const [codeState, sendCode, sending] = useActionState(sendSelfCode, undefined);
  const [state, action, pending] = useActionState(changeSelfCredentials, undefined);
  // Boshqariladigan maydonlar: React forma yuborilgach uni tozalaydi — xato (masalan noto'g'ri kod) bo'lsa
  // kiritilgan login va parol yo'qolmasin. Muvaffaqiyatda parollar tozalanadi, login yangi qiymatda qoladi.
  const [v, setV] = useState({ login, password: "", password2: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  useEffect(() => { if (state?.ok) setV((p) => ({ ...p, password: "", password2: "" })); }, [state]);

  return (
    <div className="space-y-4">
      {phone && (
        <form action={sendCode} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0 flex-1 text-sm text-slate-600">
            Tasdiq kodi Telegram orqali <span data-no-translit className="font-medium text-slate-900">{phone}</span> raqamiga yuboriladi.
            {codeState?.ok && <span className="mt-1 block font-medium text-emerald-700">Kod yuborildi — Telegram'ni oching (5 daqiqa amal qiladi).</span>}
            {codeState?.devCode && <span className="mt-1 block text-amber-700">Sinov rejimi: kod <b>{codeState.devCode}</b></span>}
          </div>
          <Button variant="secondary" disabled={sending}><Send size={16} /> {codeState?.ok ? "Qayta yuborish" : "Kod yuborish"}</Button>
          {codeState?.error && <div className="w-full"><FormError error={codeState.error} /></div>}
        </form>
      )}

      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <Field label="Login" hint="3–32 belgi: lotin harf, raqam, nuqta, chiziq"><Input name="login" value={v.login} onChange={set("login")} autoComplete="username" required /></Field>
        <div className="hidden sm:block" />
        <Field label="Yangi parol" hint={`${PASSWORD_HINT}. O'zgartirmasangiz — bo'sh qoldiring`}><PasswordInput name="password" value={v.password} onChange={set("password")} autoComplete="new-password" /></Field>
        <Field label="Yangi parol (takror)"><PasswordInput name="password2" value={v.password2} onChange={set("password2")} autoComplete="new-password" /></Field>
        {phone ? (
          <Field label="Telegram'ga kelgan kod"><Input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="123456" autoComplete="one-time-code" required /></Field>
        ) : (
          <Field label="Joriy parol" hint="Xodim kartangizda telefon raqami yo'q — o'zgarishni joriy parol bilan tasdiqlang"><PasswordInput name="currentPassword" autoComplete="current-password" required /></Field>
        )}
        <div className="flex items-end"><Button disabled={pending}><KeyRound size={16} /> O'zgartirish</Button></div>
        <div className="sm:col-span-2">
          <FormError error={state?.error} />
          <FormSuccess text={state?.ok ? state.note ?? "Saqlandi" : undefined} />
        </div>
      </form>
    </div>
  );
}
