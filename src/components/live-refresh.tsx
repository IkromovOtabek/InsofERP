"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Sahifa o'zi yangilanib turadi — F5 bosish shart emas.
 *
 * Sahifalar server komponentlari, ya'ni ma'lumot serverda o'qiladi. `router.refresh()`
 * o'sha serverdagi qismni qayta so'raydi va yangi natijani joyiga qo'yadi: sahifa qayta
 * yuklanmaydi, ochiq oynalar yopilmaydi, aylantirilgan joy saqlanadi.
 *
 * Nega kerak: zayavka, reys, to'lov holati boshqa xodim tomonidan o'zgaradi. Ilgari buni
 * ko'rish uchun sahifani qo'lda yangilash kerak edi va eskirgan raqamga qarab qaror
 * qabul qilish xavfi bor edi.
 */

/** Sukut bo'yicha necha soniyada bir. */
const EVERY_MS = 30_000;
/**
 * BI sahifalari og'ir (o'nlab agregat so'rov) — ularni tez-tez yangilash bazani bekorga
 * band qiladi, tahlil raqamlari esa daqiqada bir marta o'zgarsa ham yetarli.
 */
const SLOW = { prefix: "/bi-tahlil", everyMs: 180_000 };
/** Bosh sahifaning sukut ko'rinishi (tabsiz) ham BI tahlil — tab `?view=` bilan almashadi, yo'l o'zgarmaydi. */
const isSlow = (pathname: string) => pathname.startsWith(SLOW.prefix) || (pathname === "/dashboard" && !new URLSearchParams(window.location.search).has("view"));
/** Taqdimot — statik matn, yangilanishi shart emas (va slayd holatini buzmaslik kerak). */
const SKIP = ["/taqdimot", "/qollanma"];

export function LiveRefresh() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (SKIP.some((p) => pathname.startsWith(p))) return;
    let last = Date.now();

    /**
     * Foydalanuvchi yozayotgan bo'lsa tegmaymiz. `router.refresh()` klient holatini
     * saqlaydi, lekin uzun formani to'ldirayotgan odamning tagidan ma'lumot almashishi
     * baribir chalg'itadi — keyingi urinishda yangilanadi.
     */
    const busy = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
    };
    const refresh = () => {
      if (document.visibilityState !== "visible" || busy()) return;
      last = Date.now();
      router.refresh();
    };

    const id = setInterval(() => { if (!isSlow(pathname) || Date.now() - last >= SLOW.everyMs) refresh(); }, EVERY_MS);
    // Boshqa oynada ishlab kelgan bo'lsa — qaytishi bilan darhol yangilansin
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [router, pathname]);

  return null;
}
