"use client";

import { useEffect, useRef } from "react";
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
 *
 * Qachon: faqat bazadagi ma'lumot o'zgarganda (`lib/data-version.ts` — versiya bildirishnomalar so'rovi bilan
 * har 20 soniyada keladi). Ilgari har 30 soniyada, hech narsa o'zgarmasa ham yangilanardi: har safar butun sahifa
 * (layout + o'nlab so'rov, og'ir sahifada 0.3–0.5 MB) qayta hisoblanib, server bekorga band bo'lardi.
 */

/** `NotificationStack` yuboradigan hodisa: `detail` — ma'lumot versiyasi. */
export const DATA_VERSION_EVENT = "insof:data-version";

/** Ikki yangilanish orasida kamida shuncha (ma'lumot tez-tez o'zgarsa ham). */
const GAP_MS = 30_000;
/**
 * Og'ir sahifalar: BI (o'nlab agregat so'rov), sklad qoldiqlari, mijozlar, sozlamalar (har biri 0.3–0.5 MB) —
 * ularni tez-tez yangilash bazani bekorga band qiladi, raqamlar bir necha daqiqada bir yangilansa ham yetarli.
 */
const SLOW_GAP_MS = 180_000;
const SLOW = ["/bi-tahlil", "/stock", "/customers", "/settings"];
/** Bosh sahifaning sukut ko'rinishi (tabsiz) ham BI tahlil — tab `?view=` bilan almashadi, yo'l o'zgarmaydi. */
const isSlow = (pathname: string) =>
  SLOW.some((p) => pathname === p || pathname.startsWith(p + "/")) || (pathname === "/dashboard" && !new URLSearchParams(window.location.search).has("view"));
/** O'zgarish bo'lmasa ham shuncha vaqtda bir — vaqtga bog'liq yozuvlar («kechikdi», «5 daqiqa oldin») eskirmasin. */
const IDLE_MS = 300_000;
/** Versiya shuncha vaqt kelmasa (bildirishnoma so'rovi ishlamayapti) — eski usulda, har `GAP_MS` da yangilanadi. */
const SIGNAL_LOST_MS = 60_000;
/** Tekshiruv qadami — tarmoqqa so'rov yo'q, faqat vaqt va versiya solishtiriladi. */
const TICK_MS = 5_000;
/** Taqdimot — statik matn, yangilanishi shart emas (va slayd holatini buzmaslik kerak). */
const SKIP = ["/taqdimot", "/qollanma"];

export function LiveRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  // Oxirgi kelgan versiya va qachon kelgani — sahifalar almashganda ham saqlanadi
  const signal = useRef<{ v: string | null; at: number }>({ v: null, at: 0 });

  useEffect(() => {
    const onVersion = (e: Event) => { signal.current = { v: (e as CustomEvent<string>).detail, at: Date.now() }; };
    window.addEventListener(DATA_VERSION_EVENT, onVersion);
    return () => window.removeEventListener(DATA_VERSION_EVENT, onVersion);
  }, []);

  useEffect(() => {
    if (SKIP.some((p) => pathname.startsWith(p))) return;
    let last = Date.now();
    // Sahifa qaysi versiyadagi ma'lumot bilan chizilgan (birinchi versiya kelganda aniqlanadi)
    let shown = signal.current.v;
    // Oynaga qaytilganda versiya so'rovi javob berguncha «signal yo'q» deb hisoblanmaydi
    let graceUntil = 0;

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
    const tick = () => {
      const { v, at } = signal.current;
      if (shown === null) shown = v;
      if (document.visibilityState !== "visible" || busy()) return;
      const now = Date.now();
      const gap = isSlow(pathname) ? SLOW_GAP_MS : GAP_MS;
      if (now - last < gap) return;
      const changed = v !== null && v !== shown;
      const blind = now - at > SIGNAL_LOST_MS && now > graceUntil;
      if (!changed && !blind && now - last < Math.max(IDLE_MS, gap)) return;
      last = now;
      shown = v;
      router.refresh();
    };
    // Boshqa oynada ishlab kelgan bo'lsa — bildirishnoma so'rovi darhol yangi versiyani olib keladi
    // va o'zgarish bo'lsa sahifa shu zahoti yangilanadi
    const onVisible = () => { if (document.visibilityState === "visible") graceUntil = Date.now() + 10_000; };

    const id = setInterval(tick, TICK_MS);
    window.addEventListener(DATA_VERSION_EVENT, tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener(DATA_VERSION_EVENT, tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, pathname]);

  return null;
}
