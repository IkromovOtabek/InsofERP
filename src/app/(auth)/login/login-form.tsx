"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { KeyRound, LogIn, Send, Sparkles, UserPlus, UserRound } from "lucide-react";
import { confirmLoginCodeAction, loginAction, quickLoginAction, requestLoginCodeAction, setTempPasswordAction } from "./actions";
import { Button, Callout, Field, FormError, Input, PasswordInput } from "@/components/ui";
import { Logo } from "@/components/logo";
import { BrandPanel, useArendaBrand } from "../brand-panel";
import { cn } from "@/lib/utils";
import { CODE_DELIVERY_HINT } from "@/lib/telegram/otp-text";
import { PASSWORD_HINT } from "@/lib/password-policy";

export type TestUser = { login: string; fullName: string; roleLabel: string };

type Mode = "password" | "code";

export function LoginForm({ testMode, testUsers, notice }: { testMode: boolean; testUsers: TestUser[]; notice?: string }) {
  const [mode, setMode] = useState<Mode>("password");
  // Arenda domeni: o'z kabineti, ro'yxatdan o'tish yo'q (lib/arenda-host.ts)
  const arenda = useArendaBrand();

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />

      <section className="flex items-center justify-center bg-(--background) p-6 pt-20 lg:pt-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-6 lg:hidden">
            <Logo className="h-12" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{arenda ? "Arenda kabinetiga kirish" : "Tizimga kirish"}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Login va parol bilan, yoki Telegram orqali keladigan bir martalik kod bilan kiring.
          </p>
          {notice && <div className="mt-4"><Callout tone="warning" title="Ruxsat yo'q">{notice}</Callout></div>}

          {/* Yo'l tanlovi: parol / Telegram kod */}
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1" role="tablist">
            <ModeTab active={mode === "password"} onClick={() => setMode("password")} icon={KeyRound}>Parol bilan</ModeTab>
            <ModeTab active={mode === "code"} onClick={() => setMode("code")} icon={Send}>Telegram kod</ModeTab>
          </div>

          <div className="mt-6">
            {mode === "password" ? <PasswordLogin /> : <CodeLogin />}
          </div>

          {!arenda && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-1.5 border-t border-slate-200 pt-5 text-sm text-slate-500">
              Hisobingiz yo&apos;qmi?
              <Link href="/login/register" className="inline-flex min-h-11 items-center gap-1 font-semibold text-slate-900 underline-offset-4 hover:underline">
                <UserPlus size={15} /> Ro&apos;yxatdan o&apos;tish
              </Link>
            </div>
          )}

          {testMode && <TestUsers users={testUsers} />}
        </div>
      </section>
    </main>
  );
}

function ModeTab({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof KeyRound; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition",
        active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
      )}
    >
      <Icon size={16} /> {children}
    </button>
  );
}

/* ─────────────── Login + parol ─────────────── */

function PasswordLogin() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  if (state?.tempToken) return <TempPasswordStep token={state.tempToken} />;
  return (
    <>
      <form action={action} className="space-y-4">
        <FormError error={state?.error} />
        <Field label="Login yoki telefon">
          {/* Telefon klaviaturasi loginning birinchi harfini katta qilib "tuzatib" yubormasin */}
          <Input name="login" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" autoFocus placeholder="sotuv1 yoki +998 90 123 45 67" />
        </Field>
        <Field label="Parol"><PasswordInput name="password" autoComplete="current-password" enterKeyHint="go" placeholder="••••••••" /></Field>
        <Button size="lg" className="w-full" disabled={pending}><LogIn size={17} /> {pending ? "Kirilmoqda…" : "Kirish"}</Button>
      </form>
      <Link href="/login/reset" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline-offset-4 transition hover:text-slate-900 hover:underline">
        Parolni unutdingizmi?
      </Link>
    </>
  );
}

/**
 * Vaqtinchalik parol (dispetcher bergan) bilan kirildi — o'z parolini o'rnatmaguncha sessiya yo'q.
 * Token eskirsa yoki muddat o'tsa, server tokensiz javob qaytaradi va forma 1-qadamga qaytadi.
 */
function TempPasswordStep({ token }: { token: string }) {
  const [state, action, pending] = useActionState(setTempPasswordAction, { tempToken: token });
  if (!state?.tempToken) return <RestartLogin error={state?.error} />;
  return (
    <form action={action} className="space-y-4">
      <Callout tone="info" title="O'z parolingizni o'rnating">
        Siz vaqtinchalik parol bilan kirdingiz. Davom etish uchun faqat o&apos;zingiz biladigan yangi parol o&apos;ylab toping.
      </Callout>
      <FormError error={state.error} />
      <input type="hidden" name="token" value={state.tempToken} />
      <Field label="Yangi parol" hint={PASSWORD_HINT}><PasswordInput name="password" autoComplete="new-password" autoFocus enterKeyHint="next" /></Field>
      <Field label="Yangi parolni takrorlang"><PasswordInput name="confirm" autoComplete="new-password" enterKeyHint="go" /></Field>
      <Button size="lg" className="w-full" disabled={pending}><KeyRound size={17} /> {pending ? "Saqlanmoqda…" : "Saqlash va kirish"}</Button>
    </form>
  );
}

/** 2-qadam bekor bo'ldi — xato bilan qaytadan login formasi (yangi `useActionState`, eski token yo'q). */
function RestartLogin({ error }: { error?: string }) {
  const [shown, setShown] = useState(true);
  return (
    <>
      {shown && error && <div className="mb-4"><FormError error={error} /></div>}
      <div onInput={() => setShown(false)}><PasswordLogin /></div>
    </>
  );
}

/* ─────────────── Telefon + bir martalik kod ─────────────── */

function CodeLogin() {
  const [phone, setPhone] = useState("");
  const [req, requestAction, requesting] = useActionState(requestLoginCodeAction, undefined);
  const [conf, confirmAction, confirming] = useActionState(confirmLoginCodeAction, undefined);

  if (req?.sent) {
    return (
      <>
        <p className="mb-4 text-sm text-slate-500">
          {/* Aniq kanal (bot / Gateway) ataylab aytilmaydi — raqam tizimda borligi oshkor bo'lmasin */}
          Raqam tizimda bo&apos;lsa, 6 xonali kod <b>Telegram</b> orqali yuborildi — <b>Insof ERP botiga</b> yoki {phone} raqamining
          Telegram hisobiga («Verification Codes» chati). Kod 5 daqiqa amal qiladi.
        </p>
        <p className="mb-4 text-xs text-slate-500">
          {CODE_DELIVERY_HINT}
        </p>
        {req.devCode && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Dev/test rejimi — kod: <b className="tracking-widest">{req.devCode}</b>
          </p>
        )}
        <form action={confirmAction} className="space-y-4">
          <FormError error={conf?.error} />
          <input type="hidden" name="phone" value={phone} />
          <Field label="Kod">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus placeholder="000000" className="tracking-[0.5em]" />
          </Field>
          <Button size="lg" className="w-full" disabled={confirming}>
            <LogIn size={17} /> {confirming ? "Kirilmoqda…" : "Kirish"}
          </Button>
        </form>
        <form action={requestAction} className="mt-4">
          <input type="hidden" name="phone" value={phone} />
          <button type="submit" disabled={requesting} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-600 underline-offset-4 transition hover:text-slate-900 hover:underline disabled:opacity-50">
            <Send size={15} /> {requesting ? "Yuborilmoqda…" : "Kodni qayta yuborish"}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <p className="mb-4 text-sm text-slate-500">
        Xodimlar bo&apos;limidagi telefon raqamingizni kiriting — bir martalik kirish kodi
        Telegram orqali keladi. Parol oldindan berilmagan bo&apos;lsa ham kira olasiz.
      </p>
      <form action={requestAction} className="space-y-4">
        <FormError error={req?.error} />
        <Field label="Telefon raqami" hint="Masalan: 90 123 45 67">
          <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" autoFocus placeholder="90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Button size="lg" className="w-full" disabled={requesting}>
          <Send size={17} /> {requesting ? "Yuborilmoqda…" : "Kirish kodini yuborish"}
        </Button>
      </form>
    </>
  );
}

/* ─────────────── Test xodimlar (faqat test/dev) ─────────────── */

function TestUsers({ users }: { users: TestUser[] }) {
  if (users.length === 0) return null;
  return (
    <div className="mt-8 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-900">
        <Sparkles size={16} /> Test xodimlar
        <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px] font-medium text-amber-800">faqat test rejimi</span>
      </div>
      <p className="mb-3 text-xs text-amber-800/80">Bir bosishda kirish (parol: Test2026).</p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {users.map((u) => (
          <form key={u.login} action={quickLoginAction.bind(null, u.login)}>
            <button
              type="submit"
              className="flex w-full min-h-11 items-center gap-2.5 rounded-lg border border-amber-200 bg-white px-3 py-2 text-left transition hover:border-amber-400 hover:bg-amber-50 active:scale-[.99]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><UserRound size={15} /></span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-slate-900">{u.fullName}</span>
                <span className="block truncate text-[11px] text-slate-500">{u.roleLabel}</span>
              </span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
