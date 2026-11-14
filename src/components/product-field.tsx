"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useId } from "react";
import { Minus } from "lucide-react";
import type { CatalogProduct } from "@/components/product-picker";
import { inputCls } from "@/components/ui";
import { AnchoredList } from "@/components/ui/anchored-list";
import { toLatin } from "@/lib/translit";
import { cn } from "@/lib/utils";

/** Qidiruv uchun: kirill → lotin, kichik harf, apostrof turlari bitta, bo'shliqlar bitta */
const norm = (s: string) => toLatin(s).toLowerCase().replace(/[ʻ‘’`ʼ]/g, "'").replace(/\s+/g, " ").trim();
/** Belgisiz ko'rinish: «PK 60-12» → «pk6012» — «pk6012», «60-12», «6012» yozilsa ham topiladi */
const compact = (s: string) => s.replace(/[^a-z0-9а-яё']+/gi, "");

/**
 * Nom yoki kod bo'yicha qidiruv: har bir so'z (bo'shliq bilan) nomda bo'lishi kerak — belgilar (tire, nuqta, bo'shliq)
 * e'tiborga olinmaydi, kirill yozilsa ham lotin nom topiladi. Nomi shu so'z bilan boshlanganlar tepada.
 */
export function matchProducts<T extends { name: string; code?: string | null }>(products: T[], q: string, limit = 50): T[] {
  const term = norm(q);
  if (!term) return products.slice(0, limit);
  const words = term.split(" ").filter(Boolean);
  const scored: { p: T; s: number; i: number }[] = [];
  products.forEach((p, i) => {
    const name = norm(p.name), code = norm(p.code ?? ""), flatName = compact(name), flatCode = compact(code);
    const ok = words.every((w) => {
      const fw = compact(w);
      return name.includes(w) || code.includes(w) || (fw.length > 0 && (flatName.includes(fw) || flatCode.includes(fw)));
    });
    if (!ok) return;
    const first = words[0]!;
    // 0 — nomi so'z bilan boshlanadi, 1 — biror so'zi shu bilan boshlanadi, 2 — kodi mos, 3 — ichida bor
    const s = name.startsWith(first) || flatName.startsWith(compact(first)) ? 0
      : name.split(/[\s\-/.,()]+/).some((x) => x.startsWith(first)) ? 1
      : code.startsWith(first) ? 2 : 3;
    scored.push({ p, s, i });
  });
  return scored.sort((a, b) => a.s - b.s || a.i - b.i).slice(0, limit).map((x) => x.p);
}

/**
 * Zayavkadagi mahsulot maydoni: yozilgan har bir harf bo'yicha ro'yxat qisqaradi
 * ("P" → ichida P bor hammasi, "Pl" → Pl bor mahsulotlar). Modal oyna faqat
 * oxiridagi "…" tugmasi bosilganda ochiladi.
 *
 * Ro'yxat sahifa ustida (portal) ochiladi — jadval/kartaning `overflow` chegarasida kesilib qolmaydi (oxirgi qatorda ham
 * ko'rinadi), pastda joy yetmasa maydon tepasida ochiladi. Sichqoncha bilan bosilganda yoki yozilganda ochiladi;
 * klaviatura bilan kelinganda yopiq turadi — ↑↓ qo'shni katakka o'tadi (umumiy strelka navigatsiyasi), Alt+↓ yoki F4 — ochadi.
 */
export function ProductField({ products, value, onPick, onOpenPicker, hint }: {
  products: CatalogProduct[];
  value: string;
  onPick: (productId: string) => void;
  onOpenPicker: () => void;
  hint?: (p: CatalogProduct) => string | null;
}) {
  const selected = products.find((p) => p.id === value) ?? null;
  const label = selected?.name ?? "";
  const [q, setQ] = useState<string | null>(null); // null — yozilmayapti, tanlangan nom ko'rinadi
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const matches = useMemo(() => matchProducts(products, q ?? ""), [q, products]);

  const close = useCallback(() => { setOpen(false); setQ(null); setCursor(0); }, []);
  const choose = (id: string) => { onPick(id); close(); };

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && (boxRef.current?.contains(t as Node) || listRef.current?.contains(t as Node));
    const onDown = (e: MouseEvent) => { if (!inside(e.target)) close(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  // Strelka bilan tanlangan qator ko'rinib tursin
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  return (
    <div ref={boxRef} className="relative flex">
      <input
        value={q ?? label}
        placeholder="Mahsulot nomi"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setCursor(0); }}
        onMouseDown={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open) {
            if ((e.key === "ArrowDown" && e.altKey) || e.key === "F4") { e.preventDefault(); setOpen(true); }
            return; // yopiq ro'yxatda ↑↓ ←→ — qo'shni katakka (umumiy navigatsiya)
          }
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && matches[cursor]) { e.preventDefault(); choose(matches[cursor].id); }
          else if (e.key === "Escape") { e.preventDefault(); close(); }
          else if (e.key === "Tab") close();
        }}
        onBlur={(e) => { if (!listRef.current?.contains(e.relatedTarget as Node)) close(); }}
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
        <AnchoredList id={listId} anchorRef={boxRef} listRef={listRef} watch={matches.length} label="Mahsulotlar">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Mos mahsulot topilmadi — «…» tugmasidan ro&apos;yxatni oching</div>}
          {matches.map((p, i) => {
            const extra = hint?.(p) ?? null;
            return (
              <button
                key={p.id}
                type="button"
                tabIndex={-1}
                data-i={i}
                role="option"
                aria-selected={i === cursor}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(p.id)}
                className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === cursor ? "bg-slate-100" : "hover:bg-slate-50")}
              >
                <Minus size={14} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {extra && <span className="shrink-0 text-xs text-slate-500">{extra}</span>}
                {/* Birlik: "Hajmi" maydoni shu birlikda to'ldiriladi */}
                <span className="shrink-0 text-xs text-slate-400">{p.unit}</span>
                {/* Kod o'rniga — 1 birligidan necha m³ chiqadi */}
                {p.m3 && p.unit !== "m³" && <span className="shrink-0 text-xs text-slate-400 tabular">{p.m3} m³</span>}
              </button>
            );
          })}
        </AnchoredList>
      )}
    </div>
  );
}
