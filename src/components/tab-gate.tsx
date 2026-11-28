"use client";

import { useEffect } from "react";
import { HANDOFF_KEY, TAB_KEY, TAB_LOGIN_URL, tabCheck } from "@/lib/tab-gate";

/**
 * Har brauzer tabi o'z kirishiga ega (ko'rinish darajasida).
 *
 * Sessiya cookie'da — brauzer uni barcha tablarga beradi. Shuning uchun tab `sessionStorage` da
 * o'z belgisini (foydalanuvchi id) saqlaydi: belgisi yo'q tab (manzil qo'lda yozilgan, Google'dan,
 * xatcho'pdan ochilgan) login sahifasiga yuboriladi (`/login?yangi=1` — middleware kirgan
 * foydalanuvchini ham shu sahifaga qo'yadi). Cookie o'chirilmaydi: boshqa tablar ishlashda davom etadi.
 *
 * Ilova ichidan ochilgan yangi tab (o'rta tugma, Ctrl+bosish, target=_blank, «Yangi tabda ochish»,
 * window.open) — `localStorage` dagi qisqa muddatli «uzatish» yozuvi bilan belgini oladi.
 * Yangi tabda boshqa foydalanuvchi kirsa — eski tablar (belgisi boshqa) login sahifasiga qaytadi.
 *
 * Bu xavfsizlik chegarasi emas (cookie umumiy), faqat tablar aralashmasin uchun.
 */
export function TabGate({ userId }: { userId: string }) {
  // Navigatsiyada (LiveRefresh, havola) foydalanuvchi almashgan bo'lsa ham qayta tekshiriladi
  useEffect(() => { tabCheck(userId); }, [userId]);

  useEffect(() => {
    const handoff = () => {
      try { localStorage.setItem(HANDOFF_KEY, JSON.stringify({ u: userId, t: Date.now() })); } catch { /* yo'q */ }
    };
    // Yangi tabga olib boradigan harakatlar: o'rta tugma, modifikatorli bosish, target=_blank, kontekst menyu
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (e.type !== "click" || e.ctrlKey || e.metaKey || e.shiftKey || a.target === "_blank") handoff();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    document.addEventListener("contextmenu", onClick, true);
    const open = window.open;
    window.open = function (...args: Parameters<typeof window.open>) { handoff(); return open.apply(window, args); };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(TAB_KEY);
      // Boshqa tabda boshqa foydalanuvchi kirdi — cookie endi uniki, bu tab eski hisobda qolmasin
      bc.onmessage = (e) => {
        if (typeof e.data === "string" && e.data !== userId) {
          try { sessionStorage.removeItem(TAB_KEY); } catch { /* yo'q */ }
          location.replace(TAB_LOGIN_URL);
        }
      };
    } catch { /* eski brauzer */ }

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
      document.removeEventListener("contextmenu", onClick, true);
      window.open = open;
      bc?.close();
    };
  }, [userId]);

  return null;
}
