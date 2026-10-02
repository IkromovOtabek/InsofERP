"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Telefonda yig'iladigan bo'lim. Kompyuterda (md+) har doim ochiq, sarlavha qatori ko'rinmaydi;
 * telefonda yopiq boshlanadi (`openOnMobile` bo'lmasa) — uzun bosh sahifa 7000px lik "lenta" bo'lib qolmasin.
 * SSR da ochiq chiziladi (JS ishlamasa ham kontent ko'rinadi), telefonda mount bo'lganda yopiladi.
 */
export function MobileFold({ label, hint, openOnMobile = false, children }: { label: string; hint?: React.ReactNode; openOnMobile?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    if (ref.current && !mq.matches && !openOnMobile) ref.current.open = false;
    const onChange = () => { if (mq.matches && ref.current) ref.current.open = true; };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [openOnMobile]);
  return (
    <details ref={ref} open className="group min-w-0">
      <summary className="mb-2 flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 md:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">{label}{hint && <span className="ml-1 font-normal text-slate-500">· {hint}</span>}</span>
        <ChevronDown size={16} className="shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>
      {children}
    </details>
  );
}
