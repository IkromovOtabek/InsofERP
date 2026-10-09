"use client";

import { usePathname } from "next/navigation";
import { BackLink } from "@/components/ui";

/** Kirish sahifalarida yuqori chapdagi «Ortga»: login → sayt bosh sahifasi, tiklash/ro'yxat → kirish. */
export function AuthBack() {
  const path = usePathname();
  const toLogin = path.startsWith("/login/");
  return (
    <BackLink href={toLogin ? "/login" : "/"} label={toLogin ? "Kirish" : "Bosh sahifa"}
      className="fixed left-4 top-4 z-30 ml-0 bg-white/80 backdrop-blur" />
  );
}
