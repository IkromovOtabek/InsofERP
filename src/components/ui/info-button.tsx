"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * «i» tugma — tushuntirish matni sahifada doim turmaydi, bosilganda modal oynada chiqadi.
 * Qanday hisoblanadi, nimani bildiradi, qanday ishlatiladi — shunday izohlar uchun (ma'lumot va ogohlantirish uchun emas).
 * Sarlavha, jadval ustuni yoki tugma yonida turadi; `Link`/`label` ichida bo'lsa ham bosilganda faqat oyna ochiladi.
 */
export function InfoButton({ title = "Ma'lumot", children, size = "sm", className }: {
  /** Oyna sarlavhasi — odatda izoh tegishli bo'lgan bo'lim yoki ustun nomi */
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = useCallback(() => { setOpen(false); btn.current?.focus(); }, []);

  return (
    <>
      <button ref={btn} type="button" aria-label={`Ma'lumot: ${title}`} aria-haspopup="dialog" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full align-middle font-normal normal-case tracking-normal text-slate-400 transition hover:bg-slate-100 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500",
          size === "md" ? "h-7 w-7 pointer-coarse:h-9 pointer-coarse:w-9" : "h-5 w-5 pointer-coarse:h-8 pointer-coarse:w-8",
          open && "text-brand-700",
          className,
        )}>
        <Info size={size === "md" ? 18 : 15} aria-hidden />
      </button>
      {open && <InfoDialog title={title} titleId={titleId} onClose={close}>{children}</InfoDialog>}
    </>
  );
}

function InfoDialog({ title, titleId, onClose, children }: { title: string; titleId: string; onClose: () => void; children: React.ReactNode }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Portal — jadval, havola yoki boshqa oyna ichida bo'lsa ham ota overflow/klik uni kesmaydi
  return createPortal((
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center"
      onMouseDown={(e) => { e.stopPropagation(); onClose(); }} onClick={(e) => e.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-(--radius-card) border border-slate-200 bg-white p-5 text-left shadow-(--shadow-pop)">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold tracking-tight text-slate-900">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700"><Info size={16} aria-hidden /></span>
            {title}
          </h2>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Yopish" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
        </div>
        <div className="space-y-2 whitespace-normal text-sm font-normal normal-case leading-relaxed tracking-normal text-slate-700">{children}</div>
      </div>
    </div>
  ), document.body);
}
