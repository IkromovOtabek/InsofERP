"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Davomat kadri (skaner jurnali, ro'yxatga olish namunasi): kichik rasm — bosilsa katta ko'rinishda ochiladi.
 * Kadr manbai o'sha himoyalangan yo'l (`/dashboard/davomat/kadr`) — ko'rish huquqi undagi qoida bilan bir xil.
 */
export function PhotoThumb({ src, title, sub, className, children }: {
  src: string; title: string; sub?: string; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Kadrni kattalashtirish" aria-label={`${title}: kadrni ochish`}
        className={cn("cursor-zoom-in transition hover:ring-2 hover:ring-brand-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500", className)}>
        {children}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={title} onMouseDown={() => setOpen(false)}>
          <figure className="relative flex max-h-full max-w-full flex-col items-center" onMouseDown={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={title} className="max-h-[80vh] max-w-[92vw] rounded-xl bg-slate-900 object-contain shadow-2xl sm:max-w-[70vw]" />
            <figcaption className="mt-3 text-center text-white">
              <div className="text-base font-semibold">{title}</div>
              {sub && <div className="text-xs text-white/70">{sub}</div>}
            </figcaption>
            <button type="button" onClick={() => setOpen(false)} aria-label="Yopish" className="absolute -right-2 -top-2 rounded-full bg-white p-1.5 text-slate-700 shadow-lg hover:bg-slate-100">
              <X size={18} />
            </button>
          </figure>
        </div>
      )}
    </>
  );
}
