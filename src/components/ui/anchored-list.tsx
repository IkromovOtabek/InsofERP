"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Maydon ostida ochiladigan ro'yxat (mahsulot, xomashyo, ingredient tanlagichlari) — sahifa ustida (portal), shuning uchun
 * jadval/kartaning `overflow` chegarasida kesilib qolmaydi: oxirgi qatorda ham to'liq ko'rinadi. Pastda joy yetmasa —
 * maydon tepasida ochiladi; sahifa yoki jadval aylantirilsa maydonga ergashadi. Tashqariga bosish — chaqiruvchida
 * (`anchorRef` va `listRef` ikkalasidan tashqari bo'lsa yopadi).
 */
export function AnchoredList({ id, anchorRef, listRef, children, className, maxHeight = 256, minWidth = 320, watch, label }: {
  /** Maydonning `aria-controls` i shu id'ga ishora qiladi */
  id?: string;
  anchorRef: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  className?: string;
  maxHeight?: number;
  minWidth?: number;
  /** O'zgarsa joylashuv qayta hisoblanadi (masalan topilganlar soni — ro'yxat balandligi) */
  watch?: unknown;
  label?: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const place = useCallback(() => {
    const a = anchorRef.current?.getBoundingClientRect();
    if (!a) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(Math.max(a.width, minWidth), vw - 16);
    const left = Math.max(8, Math.min(a.left, vw - width - 8));
    const below = vh - a.bottom - 8, above = a.top - 8;
    const want = Math.min(maxHeight, listRef.current?.scrollHeight ?? maxHeight);
    const up = below < want && above > below;
    const maxH = Math.max(120, Math.min(maxHeight, (up ? above : below) - 4));
    const top = up ? a.top - Math.min(want, maxH) - 4 : a.bottom + 4;
    setPos((o) => (o && o.top === top && o.left === left && o.width === width && o.maxH === maxH ? o : { top, left, width, maxH }));
  }, [anchorRef, listRef, maxHeight, minWidth]);
  useLayoutEffect(place, [place, watch]);
  useEffect(() => {
    const onMove = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) place(); };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", place); };
  }, [listRef, place]);
  return createPortal(
    <div ref={listRef} id={id} role="listbox" aria-label={label}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: pos?.width, maxHeight: pos?.maxH ?? maxHeight, visibility: pos ? "visible" : "hidden" }}
      className={cn("fixed z-[60] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-(--shadow-pop)", className)}>
      {children}
    </div>,
    document.body,
  );
}
