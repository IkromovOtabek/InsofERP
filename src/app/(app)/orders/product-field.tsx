"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus } from "lucide-react";
import type { CatalogProduct } from "./product-picker";
import { inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Zayavkadagi mahsulot maydoni: yozilgan har bir harf bo'yicha ro'yxat qisqaradi
 * ("P" → ichida P bor hammasi, "Pl" → Pl bor mahsulotlar). Modal oyna faqat
 * oxiridagi "…" tugmasi bosilganda ochiladi.
 */
export function ProductField({ products, value, onPick, onOpenPicker, hint }: {
  products: CatalogProduct[];
  value: string;
  onPick: (productId: string) => void;
  onOpenPicker: () => void;
  hint?: (p: CatalogProduct) => string | null;
}) {
  const selected = products.find((p) => p.id === value) ?? null;
  const label = selected ? `${selected.name}${selected.code ? ` (${selected.code})` : ""}` : "";
  const [q, setQ] = useState<string | null>(null); // null — yozilmayapti, tanlangan nom ko'rinadi
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const term = (q ?? "").trim().toLowerCase();
    if (!term) return products.slice(0, 50);
    return products.filter((p) => p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term)).slice(0, 50);
  }, [q, products]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  const close = () => { setOpen(false); setQ(null); setCursor(0); };
  const choose = (id: string) => { onPick(id); close(); };

  return (
    <div ref={boxRef} className="relative flex">
      <input
        value={q ?? label}
        placeholder="Mahsulot nomi yoki kodi"
        autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setCursor(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && open && matches[cursor]) { e.preventDefault(); choose(matches[cursor].id); }
          else if (e.key === "Escape") close();
        }}
        className={cn(inputCls, "rounded-r-none")}
      />
      <button
        type="button"
        onClick={() => { close(); onOpenPicker(); }}
        title="Ro'yxatdan tanlash"
        aria-label="Mahsulot tanlash"
        className="-ml-px flex h-10 w-10 shrink-0 items-center justify-center rounded-r-lg border border-slate-200 bg-slate-50 pb-1 text-base leading-none font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
      >
        …
      </button>

      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-(--shadow-pop)">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Mos mahsulot topilmadi</div>}
          {matches.map((p, i) => {
            const extra = hint?.(p) ?? null;
            return (
              <button
                key={p.id}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(p.id)}
                className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === cursor ? "bg-slate-100" : "hover:bg-slate-50")}
              >
                <Minus size={14} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {extra && <span className="shrink-0 text-xs text-slate-500">{extra}</span>}
                {/* Birlik: "Hajmi" maydoni shu birlikda to'ldiriladi */}
                <span className="shrink-0 text-xs text-slate-400">{p.unit}</span>
                <span className="shrink-0 text-xs text-slate-400 tabular">{p.code}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
