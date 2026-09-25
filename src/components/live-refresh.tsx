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
/** Taqdimot — statik matn, yangilanishi shart emas (va slayd holatini buzmaslik kerak). */
const SKIP = ["/taqdimot", "/qollanma"];

export function LiveRefresh() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (SKIP.some((p) => pathname.startsWith(p))) return;
    const everyMs = pathname.startsWith(SLOW.prefix) ? SLOW.everyMs : EVERY_MS;

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
      router.refresh();
    };

    const id = setInterval(refresh, everyMs);
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
