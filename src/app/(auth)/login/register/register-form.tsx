"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, Send, UserPlus } from "lucide-react";
import { PASSWORD_HINT } from "@/lib/password-policy";
import { submitSignupAction, verifySignupAction } from "./actions";
import { Button, Field, FormError, Input, PasswordInput, Select, Textarea } from "@/components/ui";
import { BrandPanel } from "../../brand-panel";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const STEPS = ["Ma'lumot", "Telefon", "Tasdiq"];

export function RegisterForm({ positions }: { positions: string[] }) {
  // React 19 forma yuborilgach maydonlarni tozalaydi — xato bo'lsa yozilgani yo'qolmasin
  const [v, setV] = useState({ fullName: "", phone: "", position: "", login: "", note: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  const [req, submitAction, submitting] = useActionState(submitSignupAction, undefined);
  const [conf, verifyAction, verifying] = useActionState(verifySignupAction, undefined);
  const step = conf?.done ? 2 : req?.requestId ? 1 : 0;

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />

      <section className="flex items-center justify-center bg-(--background) p-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-6 lg:hidden">
            <Logo className="h-12" />
          </div>

          <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Qadamlar">
            {STEPS.map((s, i) => (
              <li key={s} className="text-xs font-medium text-slate-500" aria-current={i === step ? "step" : undefined}>
                <span className={cn("mb-1.5 block h-1 rounded-full", i <= step ? "bg-brand-500" : "bg-slate-200")} />
                {s}
              </li>
            ))}
          </ol>

          {step === 2 ? (
            <>
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Clock size={22} className="text-amber-500" /> Ariza yuborildi
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Arizangiz Otdel kadr va direktorga tushdi. Tasdiqlangach <b>{v.login.toLowerCase()}</b> logini va
                o&apos;zingiz tanlagan parol bilan kira olasiz. Tasdiqlashdan oldin kirib bo&apos;lmaydi.
              </p>
              <Link href="/login" className="mt-8 block">
                <Button size="lg" className="w-full">Kirish sahifasiga</Button>
              </Link>
            </>
          ) : step === 1 ? (
            <>
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Send size={22} className="text-sky-500" /> Telegram kodi
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {req?.devCode
                  ? <>Dev/test rejimi: Telegram sozlanmagan, kod quyida.</>
                  : <>6 xonali kod {v.phone} raqamining <b>Telegram</b> hisobiga yuborildi («Verification Codes» chati).</>}
                {" "}Kod 5 daqiqa amal qiladi.
              </p>
              {req?.devCode && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Dev/test rejimi — kod: <b className="tracking-widest">{req.devCode}</b>
                </p>
              )}
              <form action={verifyAction} className="mt-6 space-y-4">
                <FormError error={conf?.error} />
                <input type="hidden" name="requestId" value={req?.requestId ?? ""} />
                <Field label="Kod">
                  <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus placeholder="000000" className="tracking-[0.5em]" />
                </Field>
                <Button size="lg" className="w-full" disabled={verifying}>
                  <UserPlus size={17} /> {verifying ? "Yuborilmoqda…" : "Arizani yuborish"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold tracking-tight">Ro&apos;yxatdan o&apos;tish</h2>
              <p className="mt-1 text-sm text-slate-500">
                Zavod xodimlari uchun. Ariza Otdel kadr yoki direktor tasdiqlagandan keyin kira olasiz.
              </p>
              <form action={submitAction} className="mt-6 space-y-4">
                <FormError error={req?.error} />
                <Field label="F.I.O.">
                  <Input name="fullName" autoComplete="name" autoFocus placeholder="Karimov Akmal Ravshanovich" value={v.fullName} onChange={set("fullName")} />
                </Field>
                <Field label="Telefon raqami" hint="Shu raqamning Telegram hisobiga tasdiqlash kodi keladi">
                  <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="90 123 45 67" value={v.phone} onChange={set("phone")} />
                </Field>
                <Field label="Bo'lim">
                  <Select name="position" value={v.position} onChange={set("position")}>
                    <option value="">Tanlang…</option>
                    {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </Field>
                <Field label="Login" hint="Lotin harf, raqam, nuqta — masalan akmal.k">
                  <Input name="login" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="akmal.k" value={v.login} onChange={set("login")} />
                </Field>
                <Field label="Parol" hint={PASSWORD_HINT}>
                  <PasswordInput name="password" autoComplete="new-password" placeholder="••••••••" />
                </Field>
                <Field label="Parolni takrorlang">
                  <PasswordInput name="password2" autoComplete="new-password" placeholder="••••••••" />
                </Field>
                <Field label="Izoh (ixtiyoriy)">
                  <Textarea name="note" rows={2} maxLength={300} placeholder="Masalan: 1-sex, kunduzgi smena" value={v.note} onChange={set("note")} />
                </Field>
                <Button size="lg" className="w-full" disabled={submitting}>
                  <Send size={17} /> {submitting ? "Yuborilmoqda…" : "Kod olish"}
                </Button>
              </form>
            </>
          )}

          {step !== 2 && (
            <Link href="/login" className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900">
              <ArrowLeft size={15} /> Kirishga qaytish
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
