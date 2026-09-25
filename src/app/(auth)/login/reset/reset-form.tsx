"use client";

import { useActionState, useState } from "react";
import { PASSWORD_HINT } from "@/lib/password-policy";
import Link from "next/link";
import { ArrowLeft, KeyRound, MessageSquare, Send, ShieldCheck } from "lucide-react";
import { confirmResetAction, requestCodeAction } from "./actions";
import { Button, Field, FormError, Input, PasswordInput } from "@/components/ui";
import { BrandPanel } from "../../brand-panel";
import { Logo } from "@/components/logo";

/** `botUsername` — server aniqlaydi (`lib/telegram/api.ts`); bot sozlanmagan bo'lsa null. */
export function ResetForm({ botUsername }: { botUsername: string | null }) {
  // Telefon qadamlar orasida saqlanadi: 2-qadam uni yashirin maydonda qayta yuboradi
  const [phone, setPhone] = useState("");
  const [req, requestAction, requesting] = useActionState(requestCodeAction, undefined);
  const [conf, confirmAction, confirming] = useActionState(confirmResetAction, undefined);

  const step: 1 | 2 | 3 = conf?.login ? 3 : req?.sent ? 2 : 1;

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />

      <section className="flex items-center justify-center bg-(--background) p-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-6 lg:hidden">
            <Logo className="h-12" />
          </div>

          {step === 3 ? (
            <>
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <ShieldCheck size={22} className="text-emerald-600" /> Parol yangilandi
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Endi <b>{conf!.login}</b> logini va yangi parol bilan kiring.
              </p>
              <Link href="/login" className="mt-8 block">
                <Button size="lg" className="w-full">Kirish sahifasiga</Button>
              </Link>
            </>
          ) : step === 2 ? (
            <>
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                {req?.via === "telegram"
                  ? <><Send size={22} className="text-sky-500" /> Telegram kodi</>
                  : <><MessageSquare size={22} className="text-slate-400" /> SMS kodi</>}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {req?.via === "telegram"
                  ? <>6 xonali kod <b>Insof ERP botiga</b> yuborildi — Telegramni oching. Kod 5 daqiqa amal qiladi.</>
                  : <>{phone} raqamiga 6 xonali kod yuborildi. Kod 5 daqiqa amal qiladi.</>}
              </p>
              {req?.devCode && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Dev rejimi (SMS ulanmagan) — kod: <b className="tracking-widest">{req.devCode}</b>
                </p>
              )}
              <form action={confirmAction} className="mt-8 space-y-4">
                <FormError error={conf?.error} />
                <input type="hidden" name="phone" value={phone} />
                <Field label="Kod">
                  <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus placeholder="000000" className="tracking-[0.5em]" />
                </Field>
                <Field label="Yangi parol" hint={PASSWORD_HINT}>
                  <PasswordInput name="password" autoComplete="new-password" placeholder="••••••••" />
                </Field>
                <Field label="Yangi parolni takrorlang">
                  <PasswordInput name="password2" autoComplete="new-password" placeholder="••••••••" />
                </Field>
                <Button size="lg" className="w-full" disabled={confirming}>
                  <KeyRound size={17} /> {confirming ? "Saqlanmoqda…" : "Parolni o'zgartirish"}
                </Button>
              </form>
              <p className="mt-4 text-xs text-slate-500">
                Kod kelmadimi? Kiritgan raqamingiz Otdel kadrdagi raqam bilan bir xilligini tekshiring —
                boshqa raqamga kod yuborilmaydi.
                {req?.via !== "telegram" && botUsername && (
                  <> Kod Telegramga kelishini istasangiz, <BotLink username={botUsername} /> botini ochib «Telefon raqamimni yuborish» tugmasini bosing.</>
                )}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold tracking-tight">Parolni tiklash</h2>
              <p className="mt-1 text-sm text-slate-500">
                Otdel kadrdagi telefon raqamingizni kiriting — kodni Telegram botingizga yuboramiz.
                Bot ulanmagan bo'lsa kod SMS bilan keladi.
              </p>
              {botUsername && (
                <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                  Botni hali ulamagan bo'lsangiz: <BotLink username={botUsername} /> → <b>«Telefon raqamimni yuborish»</b>.
                  Buning uchun parol kerak emas.
                </p>
              )}
              <form action={requestAction} className="mt-8 space-y-4">
                <FormError error={req?.error} />
                <Field label="Telefon raqami" hint="Masalan: 90 123 45 67">
                  <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" autoFocus placeholder="90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
                <Button size="lg" className="w-full" disabled={requesting}>
                  <MessageSquare size={17} /> {requesting ? "Yuborilmoqda…" : "Kod yuborish"}
                </Button>
              </form>
            </>
          )}

          {step !== 3 && (
            <Link href="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900">
              <ArrowLeft size={15} /> Kirishga qaytish
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}

/** Botga havola — Telegram ilovasida ochiladi. */
function BotLink({ username }: { username: string }) {
  return (
    <a href={`https://t.me/${username}`} target="_blank" rel="noreferrer" className="font-medium underline">
      @{username}
    </a>
  );
}
