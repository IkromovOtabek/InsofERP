"use client";

import { useActionState } from "react";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { loginAction } from "./actions";
import { Button, Field, FormError, Input, PasswordInput } from "@/components/ui";
import { Logo } from "@/components/logo";
import { BrandPanel } from "../brand-panel";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />

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
          <Link href="/login/reset" className="mt-5 inline-block text-sm text-slate-500 transition hover:text-slate-900">
            Parolni unutdingizmi?
          </Link>
        </div>
      </section>
    </main>
  );
}
