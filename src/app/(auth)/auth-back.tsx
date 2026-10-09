"use client";

import { usePathname } from "next/navigation";
import { BackLink } from "@/components/ui";

/**
 * Kirish sahifalarida «Ortga»: login → sayt bosh sahifasi, tiklash/ro'yxat → kirish.
 * Oq (forma) panelning yuqori chap burchagida: katta ekranda chapda BrandPanel turadi —
 * grid `lg:grid-cols-[1.1fr_1fr]`, ya'ni oq panel 1.1/2.1 = 52.381% dan boshlanadi.
 */
export function AuthBack() {
  const path = usePathname();
  const toLogin = path.startsWith("/login/");
  return (
    <BackLink href={toLogin ? "/login" : "/"} label={toLogin ? "Kirish" : "Bosh sahifa"}
      className="fixed left-4 top-4 z-30 ml-0 lg:left-[calc(52.381%+1rem)]" />
  );
}
