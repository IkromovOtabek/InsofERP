"use client";

import { useActionState, useState } from "react";
import { PASSWORD_HINT } from "@/lib/password-policy";
import Link from "next/link";
import { ArrowLeft, KeyRound, Send, ShieldCheck } from "lucide-react";
import { CODE_DELIVERY_HINT } from "@/lib/telegram/otp-text";
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

      <section className="flex items-center justify-center bg-(--background) p-6 pt-20 lg:pt-6">
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
                <Send size={22} className="text-sky-500" /> Telegram kodi
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {/* Aniq kanal (bot / Gateway) ataylab aytilmaydi — raqam tizimda borligi oshkor bo'lmasin */}
                Raqam tizimda bo&apos;lsa, 6 xonali kod <b>Telegram</b> orqali yuborildi — <b>Insof ERP botiga</b> yoki {phone}
                raqamining Telegram hisobiga («Verification Codes» chati). Kod 5 daqiqa amal qiladi.
              </p>
              {req?.devCode && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Dev/test rejimi (Telegram sozlanmagan) — kod: <b className="tracking-widest">{req.devCode}</b>
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
                Kod kelmadimi? {CODE_DELIVERY_HINT} Kiritgan raqamingiz Otdel kadrdagi raqam bilan bir xilligini
                tekshiring — boshqa raqamga kod yuborilmaydi.
                {botUsername && (
                  <> Telegram botga hali ulanmagan bo&apos;lsangiz: <BotLink username={botUsername} /> botini oching → /start → «Telefon raqamimni yuborish», so&apos;ng qaytadan kod so&apos;rang.</>
                )}
                {" "}Baribir kelmasa — Otdel kadrga murojaat qiling.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold tracking-tight">Parolni tiklash</h2>
              <p className="mt-1 text-sm text-slate-500">
                Xodimlar bo'limidagi telefon raqamingizni kiriting — tiklash kodi Telegram orqali keladi
                (Insof ERP botiga yoki raqamingizning Telegram hisobiga). {CODE_DELIVERY_HINT}
              </p>
              {botUsername && (
                <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                  Avval botga ulaning: <BotLink username={botUsername} /> → <b>/start</b> → <b>«Telefon raqamimni yuborish»</b>.
                  Bot raqamingizni Xodimlar bo'limidagi raqam bilan solishtiradi — parol kerak emas.
                </p>
              )}
              <form action={requestAction} className="mt-8 space-y-4">
                <FormError error={req?.error} />
                <Field label="Telefon raqami" hint="Masalan: 90 123 45 67">
                  <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" autoFocus placeholder="90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
                <Button size="lg" className="w-full" disabled={requesting}>
                  <Send size={17} /> {requesting ? "Yuborilmoqda…" : "Kodni Telegramga yuborish"}
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
