"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoButton } from "@/components/ui";

/**
 * Yig'iladigan bo'lim: sarlavha qatori tugma bo'lib xizmat qiladi, ichidagi uzun
 * jadval ochilib-yopiladi. Yopiq holatda ham eng kerakli raqamlar (`meta`)
 * sarlavhada ko'rinib turadi — xodim yoyishdan oldin nima borligini biladi.
 *
 * `storageKey` berilsa xodimning tanlovi shu brauzerda eslab qolinadi: har safar
 * sahifa ochilganda yana qayta yig'ish shart emas.
 */
export function Fold({ title, hint, meta, children, defaultOpen = false, storageKey, className }: {
  title: string;
  hint?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Serverdagi va birinchi render'dagi holat bir xil bo'lishi uchun eslab qolingan
  // tanlov faqat hydration'dan keyin qo'llanadi.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const v = localStorage.getItem(`fold:${storageKey}`);
      if (v === "1" || v === "0") setOpen(v === "1");
    } catch { /* localStorage yopiq bo'lsa — odatdagi holat */ }
  }, [storageKey]);

  function toggle() {
    setOpen((v) => {
      if (storageKey) { try { localStorage.setItem(`fold:${storageKey}`, v ? "0" : "1"); } catch { /* ignore */ } }
      return !v;
    });
  }

  return (
    <div className={className}>
      {/* «i» tugma sarlavha tugmasidan tashqarida: tugma ichida tugma bo'lmaydi */}
      <div className="flex items-center transition hover:bg-slate-50">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={cn("flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-5 text-left", hint ? "pr-2" : "pr-5")}
        >
          <ChevronDown size={14} className={cn("shrink-0 text-slate-400 transition-transform", !open && "-rotate-90")} />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
          </span>
          {meta && <span className="shrink-0 text-xs text-slate-500">{meta}</span>}
        </button>
        {hint && <InfoButton title={title} className="mr-4">{hint}</InfoButton>}
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}
