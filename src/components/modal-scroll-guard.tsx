"use client";

import { useEffect } from "react";

/**
 * Oyna (modal) ochiq turganda orqadagi sahifa aylanmasin: sichqoncha g'ildiragi yoki barmoq oynaning qorong'i foni ustida
 * bo'lsa — hodisa to'xtatiladi; oyna ichidagi aylanadigan qism (jadval, uzun forma) esa odatdagidek aylanadi.
 * Loyihadagi oynalar `fixed inset-0` fon bilan yasalgan (`components/ui`, `quick-add.tsx` uslubi) — har biriga alohida
 * kod yozmaslik uchun bitta global tinglovchi (root layout'da). `body { overflow: hidden }` ishlatilmaydi — skroll
 * chizig'i yo'qolib sahifa sakramasin.
 */
const OVERLAY = ".fixed.inset-0, [aria-modal='true']";

function canScroll(el: Element, dx: number, dy: number): boolean {
  const s = getComputedStyle(el);
  const scrollable = (v: string) => v === "auto" || v === "scroll" || v === "overlay";
  if (dy && scrollable(s.overflowY) && el.scrollHeight > el.clientHeight + 1) {
    if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
  }
  if (dx && scrollable(s.overflowX) && el.scrollWidth > el.clientWidth + 1) {
    if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
  }
  return false;
}

/** Hodisa oyna ichida bo'lsa va nishondan eng tashqi oyna foniga qadar hech narsa shu yo'nalishda aylana olmasa — true */
function blocked(target: EventTarget | null, dx: number, dy: number): boolean {
  if (!(target instanceof Element)) return false;
  const chain: Element[] = [];
  let outer = -1;
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    chain.push(el);
    if (el.matches(OVERLAY)) outer = chain.length - 1;
  }
  if (outer < 0) return false;
  for (let i = 0; i <= outer; i++) if (canScroll(chain[i], dx, dy)) return false;
  return true;
}

export function ModalScrollGuard() {
  useEffect(() => {
    let lastX = 0, lastY = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // masshtab (pinch / Ctrl + g'ildirak)
      if (blocked(e.target, e.deltaX, e.deltaY)) e.preventDefault();
    };
    const onTouchStart = (e: TouchEvent) => { lastX = e.touches[0]?.clientX ?? 0; lastY = e.touches[0]?.clientY ?? 0; };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      const dx = lastX - t.clientX, dy = lastY - t.clientY;
      lastX = t.clientX; lastY = t.clientY;
      if (e.cancelable && blocked(e.target, dx, dy)) e.preventDefault();
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);
  return null;
}
