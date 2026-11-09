"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Javob kelmasa ham shuncha vaqtdan keyin indikator o'chadi (bosilgan havola o'tishni bekor qilgan bo'lsa). */
const GIVE_UP_MS = 15_000;
/** Fayl va API havolalari sahifa o'tishi emas — yuklab olish, eksport. */
const NOT_A_PAGE = (path: string) => path.startsWith("/api/") || path.startsWith("/uploads/") || /\.[a-z0-9]{2,5}$/i.test(path);

/**
 * Bo'limga o'tish kutilayotganini ko'rsatadi: tepada progress chiziq, kontent xiralashadi.
 *
 * Sahifalar serverda to'liq tayyorlanib keladi — havola bosilgandan javob kelguncha ekran o'zgarmay turardi va
 * tizim «qotib qolgandek» ko'rinardi. `loading.tsx` bu yerga to'g'ri kelmaydi: u sahifani oqim (streaming) bilan
 * beradi, oqim boshlangach `requirePage` dagi `redirect()`/403 holat kodini o'zgartira olmaydi (307 o'rniga 200).
 * Shuning uchun kutish faqat klientda ko'rsatiladi: ichki havola bosilganda yoqiladi, manzil o'zgarganda o'chadi.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);

  // Yangi sahifa (yoki shu sahifaning boshqa tabi) ochildi — kutish tugadi
  useEffect(() => { setPending(false); }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || NOT_A_PAGE(url.pathname)) return;
      // Faqat #yakor yoki aynan shu manzil — o'tish bo'lmaydi
      if (url.pathname === location.pathname && url.search === location.search) return;
      setPending(true);
    };
    // Orqaga qaytilganda brauzer sahifani keshdan tiklasa, eski holat qolmasin
    const onShow = () => setPending(false);
    document.addEventListener("click", onClick, true);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-nav", pending);
    if (!pending) return;
    const t = setTimeout(() => setPending(false), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [pending]);

  if (!pending) return null;
  return (
    <div role="progressbar" aria-label="Sahifa yuklanmoqda" className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden print:hidden">
      <div className="nav-progress h-full bg-brand-500" />
    </div>
  );
}
