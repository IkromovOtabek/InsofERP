"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Ochiq varaqlar to'plami: Esc va Tab faqat eng ustidagisiga tegishli (varaq ichidan amal dialogi ochilganda). */
const stack: string[] = [];

/**
 * Dialog: kompyuterda markazdagi oyna, telefonda (≤ 760px) pastdan chiqadigan varaq (bottom sheet).
 * Esc yopadi, fokus ichkariga o'tadi va Tab ichida aylanadi, yopilganda oldingi elementga qaytadi; orqa fon aylanmaydi.
 * Panel ildiziga (`.sa`) portal qilinadi — ota konteynerning transform/overflow'i ta'sir qilmaydi, tokenlar saqlanadi.
 * `initialFocus` — ochilganda fokus oladigan element tanlovchisi (sukut: birinchi input/textarea, keyin [data-autofocus]).
 */
export function BottomSheet({ open, onClose, title, children, wide, initialFocus }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean; initialFocus?: string;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    stack.push(titleId);
    const top = () => stack[stack.length - 1] === titleId;
    const prev = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (!top()) return;
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])")];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      const el = (initialFocus ? box.current?.querySelector<HTMLElement>(initialFocus) : null)
        ?? box.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([type=radio]),textarea,button[data-autofocus]") ?? box.current;
      el?.focus();
    }, 0);
    return () => {
      const i = stack.lastIndexOf(titleId);
      if (i >= 0) stack.splice(i, 1);
      document.removeEventListener("keydown", onKey); clearTimeout(t);
      if (stack.length === 0) html.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [open, initialFocus, titleId]);

  if (!open) return null;
  const node = (
    <div className="sa-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`sa-sheet${wide ? " wide" : ""}`}>
        <div className="grip" aria-hidden />
        <div className="sa-sheet-h">
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Yopish" className="sa-sheet-x"><X size={20} aria-hidden /></button>
        </div>
        {children}
      </div>
    </div>
  );
  const root = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".sa") : null;
  return root ? createPortal(node, root) : node;
}
