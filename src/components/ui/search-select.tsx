"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { toLatin } from "@/lib/translit";
import { cn } from "@/lib/utils";
import { inputCls } from "@/components/ui";

type Opt = { id: string; name: string };

/** Ro'yxatda bir vaqtda chiziladigan qatorlar — qolgani qidiruv bilan topiladi. */
const LIST_CAP = 100;

/** Qidiruv uchun: kichik harf, kirill → lotin, apostrof turlari bitta (o‘ / o` / o' bir xil topiladi), ortiqcha bo'shliqsiz. */
const norm = (s: string) => toLatin(s).toLowerCase().replace(/[‘’`ʻʼ]/g, "'").replace(/\s+/g, " ").trim();

/**
 * Yozib qidiriladigan tanlov — oddiy `<select>` o'rnida, ro'yxat uzun bo'lsa: maydonga harf yozilsa ro'yxat toraya boradi
 * (nomning istalgan joyidan, kirill yozuv lotin bilan ham topiladi). Faqat ro'yxatdagi yozuv tanlanadi: formaga `name` bilan
 * yashirin maydonda `id` ketadi; ro'yxatda yo'q matn yozib qoldirilsa tanlov o'zgarmaydi, matn bo'shatilsa — tanlov olinadi.
 * Klaviatura: ↑ / ↓ — yurish, Enter — tanlash (forma yuborilmaydi), Esc — yopish.
 */
export function SearchSelect({ name, options, value, onChange, placeholder = "Yozib qidiring…", required, disabled, className, ariaLabel }: {
  name: string;
  options: Opt[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);
  // null — foydalanuvchi hali yozmagan: maydonda tanlangan nom, ro'yxat to'liq
  const [q, setQ] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Ro'yxat maydondan kengroq bo'lishi mumkin (tor ustunda nomlar o'qilsin) — o'ng chetdan chiqsa, o'ng tomonga tekislanadi
  const [alignRight, setAlignRight] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const r = listRef.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 8) setAlignRight(true);
  }, [open]);

  const found = useMemo(() => {
    const t = q == null ? "" : norm(q);
    if (!t) return options;
    const starts: Opt[] = [], inside: Opt[] = [];
    for (const o of options) {
      const n = norm(o.name);
      if (n.startsWith(t)) starts.push(o);
      else if (n.includes(t)) inside.push(o);
    }
    return [...starts, ...inside];
  }, [options, q]);
  const shown = found.slice(0, LIST_CAP);

  const show = (start = 0) => { setOpen(true); setActive(start); };
  const close = () => { setOpen(false); setQ(null); setAlignRight(false); };
  const pick = (o: Opt | null) => { onChange(o?.id ?? ""); close(); };
  const scrollTo = (i: number) => listRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  const move = (d: number) => {
    if (!open) { show(Math.max(0, shown.findIndex((o) => o.id === value))); return; }
    const i = Math.min(Math.max(active + d, 0), shown.length - 1);
    setActive(i);
    scrollTo(i);
  };
  // Fokusdan chiqqanda: bo'sh matn — tanlov olinadi; nomi aynan mos yozuv — o'sha tanlanadi; boshqa matn — eski tanlov qoladi
  const commit = () => {
    if (q != null) {
      const t = norm(q);
      if (!t) onChange("");
      else {
        const exact = options.find((o) => norm(o.name) === t);
        if (exact) onChange(exact.id);
      }
    }
    close();
  };

  return (
    <div className={cn("relative", className)}>
      <input type="hidden" name={name} value={value} />
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        required={required && !value}
        value={q ?? selected?.name ?? ""}
        placeholder={placeholder}
        onFocus={(e) => { e.currentTarget.select(); show(Math.max(0, shown.findIndex((o) => o.id === value))); }}
        onClick={() => { if (!open) show(Math.max(0, shown.findIndex((o) => o.id === value))); }}
        onChange={(e) => { setQ(e.target.value); show(0); listRef.current?.scrollTo({ top: 0 }); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
          else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[active]) pick(shown[active]); }
          else if (e.key === "Escape" && open) { e.preventDefault(); close(); }
        }}
        className={cn(inputCls, "pl-9 pr-9")}
      />
      {value && !disabled ? (
        <button type="button" tabIndex={-1} title="Tanlovni olib tashlash" aria-label="Tanlovni olib tashlash"
          onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); pick(null); }}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={15} />
        </button>
      ) : (
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      )}
      {open && (
        <div ref={listRef} id={listId} role="listbox" className={cn("absolute z-30 mt-1 max-h-72 w-max min-w-full max-w-[min(20rem,calc(100vw-1rem))] overflow-y-auto", alignRight ? "right-0" : "left-0",
          "rounded-lg border border-slate-200 bg-white py-1 shadow-lg")}>
          {shown.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Topilmadi</div>}
          {shown.map((o, i) => (
            // Bosilganda fokus maydonda qoladi (onMouseDown), label ichida bo'lgani uchun click'ning standart amali to'xtatiladi —
            // aks holda label bosishni maydonga uzatib, ro'yxatni qayta ochib yuborardi
            <div key={o.id} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={o.id === value}
              onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer break-words px-3 py-2 text-sm leading-snug", i === active ? "bg-slate-100 text-slate-900" : "text-slate-700", o.id === value && "font-semibold")}>
              {o.name}
            </div>
          ))}
          {found.length > shown.length && <div className="px-3 py-1.5 text-xs text-slate-400">yana {found.length - shown.length} ta — qidiruvni aniqlashtiring</div>}
        </div>
      )}
    </div>
  );
}
