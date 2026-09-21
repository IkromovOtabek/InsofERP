"use client";

import { useEffect } from "react";

/** Sahifa ochilgach chop etish oynasini o'zi chiqaradi (`?print=1` bilan kelinganda). */
export function AutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    // Rasm va shrift yuklanib bo'lsin — aks holda varaqa bo'sh chiqadi
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [enabled]);
  return null;
}
