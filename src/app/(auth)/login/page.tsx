"use client";

import { useActionState } from "react";
import { LogIn, ShieldCheck, Truck, FlaskConical } from "lucide-react";
import { loginAction } from "./actions";
import { Button, Field, FormError, Input, PasswordInput } from "@/components/ui";
import { Logo } from "@/components/logo";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brend paneli */}
      <section className="on-dark relative hidden overflow-hidden bg-ink-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="bg-grid absolute inset-0" />
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative">
          <Logo className="h-14" />
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Zayavkadan to'lovgacha — bitta tizimda</h1>
          <p className="mt-4 text-slate-300">Sotuv, ishlab chiqarish, sklad, logistika va moliya bir-biri bilan gaplashadi. Ma'lumot bir marta kiritiladi.</p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            <li className="flex items-center gap-3"><ShieldCheck size={18} className="text-brand-400" /> Kredit limit va ruxsatlar nazorati</li>
            <li className="flex items-center gap-3"><FlaskConical size={18} className="text-brand-400" /> Retsept bo'yicha avtomatik xomashyo hisobi</li>
            <li className="flex items-center gap-3"><Truck size={18} className="text-brand-400" /> QR-nakladnoy va reyslar kuzatuvi</li>
          </ul>
        </div>
        <div className="relative text-xs text-slate-500">© {new Date().getFullYear()} Insof ERP</div>
      </section>

      {/* Forma */}
      <section className="flex items-center justify-center bg-(--background) p-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-6 lg:hidden">
            <Logo className="h-12" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Tizimga kirish</h2>
          <p className="mt-1 text-sm text-slate-500">Xodimlar uchun. Login va parolni Otdel kadr beradi.</p>
          <form action={action} className="mt-8 space-y-4">
            <FormError error={state?.error} />
            <Field label="Login"><Input name="login" autoComplete="username" autoFocus placeholder="masalan: sotuv1" /></Field>
            <Field label="Parol"><PasswordInput name="password" autoComplete="current-password" placeholder="••••••••" /></Field>
            <Button size="lg" className="w-full" disabled={pending}><LogIn size={17} /> {pending ? "Kirilmoqda…" : "Kirish"}</Button>
          </form>
        </div>
      </section>
    </main>
  );
}
