"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Kirish sahifalarida «Ortga»: login → sayt bosh sahifasi, tiklash/ro'yxat → kirish.
 * Oq (forma) panelning yuqori chap burchagida: katta ekranda chapda BrandPanel turadi —
 * grid `lg:grid-cols-[1.1fr_1fr]`, ya'ni oq panel 1.1/2.1 = 52.381% dan boshlanadi.
 * Ichki sahifalardagi `BackLink` dan kattaroq: bu sahifada yagona navigatsiya tugmasi.
 */
export function AuthBack() {
  const path = usePathname();
  const toLogin = path.startsWith("/login/");
  const label = toLogin ? "Kirish" : "Bosh sahifa";
  return (
    <Link href={toLogin ? "/login" : "/"} title={`Ortga: ${label}`}
      className="fixed left-4 top-4 z-30 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 lg:left-[calc(52.381%+1rem)]">
      <ArrowLeft size={18} className="shrink-0" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
