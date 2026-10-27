"use client";

import { useEffect } from "react";

const RING = ["ring-2", "ring-blue-500/70", "ring-offset-2", "transition-shadow"];

/**
 * URL'dagi #bo'limga tushadi va uni qisqa yoritadi (bosh sahifa kartalaridan kelganda).
 * Grafiklar kech chizilib joyni surib yuboradi — shuning uchun bir necha marta qayta tekislanadi,
 * foydalanuvchi o'zi aylantira boshlasa to'xtaydi.
 */
export function HashFocus() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    let stopped = false;
    const stop = () => { stopped = true; };
    const align = () => { if (!stopped) el.scrollIntoView({ block: "start" }); };
    const events = ["wheel", "touchmove", "keydown", "mousedown"] as const;
    events.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    align();
    el.classList.add(...RING);
    const timers = [150, 500, 1200].map((ms) => setTimeout(align, ms));
    const unring = setTimeout(() => el.classList.remove(...RING), 2500);
    return () => {
      timers.forEach(clearTimeout); clearTimeout(unring);
      el.classList.remove(...RING);
      events.forEach((e) => window.removeEventListener(e, stop));
    };
  }, []);
  return null;
}
