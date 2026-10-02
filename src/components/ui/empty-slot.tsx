"use client";

import { useLayoutEffect, useRef, useState } from "react";

const TABLE_PARENTS = new Set(["TBODY", "THEAD", "TFOOT", "TABLE"]);

/**
 * `Empty` ning qobig'i: qayerda turganini o'zi aniqlaydi.
 * Server va birinchi chizishda `<template>` qaytaradi — u HTML'da ham `<tbody>`, ham
 * `<div>` ichida ruxsat etilgan yagona "neytral" teg, shuning uchun brauzer uni
 * ko'chirmaydi va hydration mos keladi. So'ng (bo'yashdan oldin) ota-elementga qarab
 * jadval qatori yoki oddiy blok chiziladi.
 */
export function EmptySlot({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLTemplateElement>(null);
  const [mode, setMode] = useState<"row" | "block" | null>(null);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement?.tagName ?? "";
    setMode(TABLE_PARENTS.has(parent) ? "row" : "block");
  }, []);

  if (mode === "row") {
    // Keng jadval telefonda yon tomonga aylanadi — yozuv ko'rinadigan qismning o'rtasida tursin
    return <tr><td colSpan={99} className="px-4 py-12 text-center"><div className="sticky left-4 max-w-[calc(100vw-3.5rem)] lg:max-w-none">{children}</div></td></tr>;
  }
  if (mode === "block") {
    return <div className="px-4 py-12 text-center">{children}</div>;
  }
  return <template ref={ref} />;
}
