"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** Jadval qobig'i — jadvalning bevosita ota bloki (`Table`, `Sheet` va xom jadval o'ramlari). */
const SELECTOR = ".app-main :is(div, section, form):has(> table)";

type Box = { left: number; width: number; inner: number };

/**
 * Keng jadvalning gorizontal scroll'i doim ko'rinsin: jadval ekranda turibdi, lekin pastki cheti (o'z scroll'i bilan)
 * ekrandan pastda bo'lsa — ekran pastida xuddi shu enlikda yopishqoq scroll chiqadi va jadval bilan birga suriladi.
 * Jadval pasti ko'ringach o'zi yo'qoladi (jadvalning o'z scroll'i bor). Scroll ko'rinishi (macOS overlay yashirmasligi) —
 * globals.css «Jadvallar: gorizontal scroll doim ko'rinsin».
 */
export function StickyHScroll() {
  const pathname = usePathname();
  const bar = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    let raf = 0;
    let list: HTMLElement[] = [];
    const collect = () => {
      list = [...document.querySelectorAll<HTMLElement>(SELECTOR)].filter((el) => {
        if (el.scrollWidth <= el.clientWidth + 1) return false;
        const ov = getComputedStyle(el).overflowX;
        return ov === "auto" || ov === "scroll";
      });
    };
    const pick = () => {
      raf = 0;
      const vh = window.innerHeight;
      let found: HTMLElement | null = null;
      for (const el of list) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        // Ko'rinadigan qismi bor (kamida 80px), pastki cheti esa ekrandan pastda
        if (r.width > 0 && r.top < vh - 80 && r.bottom > vh + 2) { found = el; break; }
      }
      target.current = found;
      if (!found) { setBox((b) => (b ? null : b)); return; }
      const r = found.getBoundingClientRect();
      const next = { left: Math.round(r.left + found.clientLeft), width: found.clientWidth, inner: found.scrollWidth };
      setBox((b) => (b && b.left === next.left && b.width === next.width && b.inner === next.inner ? b : next));
      const p = bar.current;
      if (p && Math.abs(p.scrollLeft - found.scrollLeft) > 1) p.scrollLeft = found.scrollLeft;
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(pick); };
    // Joylashuv o'zgarsa (shrift yuklandi, karta kengaydi, qator qo'shildi) — DOM o'zgarmasa ham qayta tekshiriladi
    const ro = new ResizeObserver(() => schedule());
    const refresh = () => {
      collect();
      ro.disconnect();
      const main = document.querySelector(".app-main");
      if (main) ro.observe(main);
      for (const el of list) ro.observe(el);
      schedule();
    };

    // Jadval o'zi surilsa (trackpad, o'z scroll'i) — pastdagi scroll ham ergashadi
    const onScroll = (e: Event) => {
      const t = target.current, p = bar.current;
      if (t && p && e.target === t) { if (Math.abs(p.scrollLeft - t.scrollLeft) > 1) p.scrollLeft = t.scrollLeft; return; }
      if (e.target === p) return;
      schedule();
    };
    refresh();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", refresh);
    // Sahifa ichida jadval almashsa (filtr, tab, yangi qatorlar) — ro'yxat yangilanadi
    const main = document.querySelector(".app-main");
    let mo: MutationObserver | null = null;
    if (main) {
      let t = 0;
      mo = new MutationObserver(() => { window.clearTimeout(t); t = window.setTimeout(refresh, 120); });
      mo.observe(main, { childList: true, subtree: true });
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", refresh);
      mo?.disconnect();
    };
  }, [pathname]);

  // Paydo bo'lganda jadval qayerda turgan bo'lsa — shu joydan; pastdagi scroll surilsa — jadval ham (to'g'ridan-to'g'ri tinglovchi)
  const shown = !!box;
  useEffect(() => { const t = target.current, p = bar.current; if (t && p) p.scrollLeft = t.scrollLeft; }, [box]);
  useEffect(() => {
    const p = bar.current;
    if (!shown || !p) return;
    const onBar = () => { const t = target.current; if (t && Math.abs(t.scrollLeft - p.scrollLeft) > 1) t.scrollLeft = p.scrollLeft; };
    p.addEventListener("scroll", onBar, { passive: true });
    return () => p.removeEventListener("scroll", onBar);
  }, [shown]);

  if (!box) return null;
  return (
    <div ref={bar} aria-hidden className="hscroll-bar fixed bottom-0 z-30 overflow-x-auto overflow-y-hidden rounded-t-md bg-white/90 shadow-[0_-2px_8px_rgb(0_0_0/0.08)] backdrop-blur print:hidden"
      style={{ left: box.left, width: box.width }}>
      <div style={{ width: box.inner, height: 1 }} />
    </div>
  );
}
