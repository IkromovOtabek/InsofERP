"use client";

import { useEffect } from "react";
import { encodeUiCookie, UI_PREFS_COOKIE, type ColorMode, type UiPrefs } from "@/lib/control/ui-prefs";

/**
 * Prefs'ni sahifaga qo'llash (saqlashdan oldin darhol — optimistik): `.sa[data-theme|data-mobile]`, ERP `html.dark`,
 * localStorage "insof-sa-theme" (eski kalit — moslik uchun) va cookie (login sahifasi va keyingi birinchi bo'yoq uchun).
 * Manba baribir baza: server action yozadi, layout keyingi so'rovda bazadan o'qiydi.
 */
export function applyUiPrefs(p: UiPrefs) {
  const sa = document.querySelector<HTMLElement>(".sa");
  if (sa) {
    if (p.colorMode === "system") sa.removeAttribute("data-theme"); else sa.setAttribute("data-theme", p.colorMode);
    sa.setAttribute("data-mobile", p.mobileLayout);
  }
  syncDark(p.colorMode);
  try { if (p.colorMode === "system") localStorage.removeItem("insof-sa-theme"); else localStorage.setItem("insof-sa-theme", p.colorMode); } catch { /* yashirin rejim */ }
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${UI_PREFS_COOKIE}=${encodeUiCookie(p)}; path=/superadmin; max-age=31536000; samesite=strict${secure}`;
}

function syncDark(mode: ColorMode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Panel ochilganda: cookie/localStorage bazadagi qiymatga tenglanadi (DB ustun); tizim rejimida OS o'zgarishiga ergashadi. */
export function usePrefsSync(p: UiPrefs) {
  useEffect(() => {
    const want = `${UI_PREFS_COOKIE}=${encodeUiCookie(p)}`;
    if (!document.cookie.split("; ").includes(want)) applyUiPrefs(p);
    if (p.colorMode !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => syncDark("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [p]);
}
