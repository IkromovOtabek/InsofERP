"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const PALETTE_KEY = "insof-palette";
type Palette = "amber" | "safir";

/** Har bir fon: yorug' rejimdagi brend, sarlavha matni va sahifa foni — kartochkada nuqtalar bo'lib ko'rinadi. */
const PALETTES: { v: Palette; t: string; d: string; dots: [string, string, string] }[] = [
  { v: "amber", t: "Joriy", d: "Amber — sanoat signal rangi", dots: ["#ffa300", "#0f172a", "#f2f4f7"] },
  { v: "safir", t: "Safir", d: "Ko'k, klassik korporativ", dots: ["#2563eb", "#0f172a", "#e3ebfa"] },
];

function readPalette(): Palette {
  try { if (localStorage.getItem(PALETTE_KEY) === "safir") return "safir"; } catch {}
  return "amber";
}

export function applyPalette(p: Palette) {
  const d = document.documentElement;
  if (p === "amber") d.removeAttribute("data-palette"); else d.setAttribute("data-palette", p);
  try { if (p === "amber") localStorage.removeItem(PALETTE_KEY); else localStorage.setItem(PALETTE_KEY, p); } catch {}
}

/** "Mening hisobim" → Fon. Tanlov darhol qo'llanadi va shu brauzerda saqlanadi (layout'dagi skript flashsiz tiklaydi). */
export function PalettePicker() {
  const [cur, setCur] = useState<Palette | null>(null);
  useEffect(() => { setCur(readPalette()); }, []);

  return (
    <div role="radiogroup" aria-label="Fon" className="grid gap-3 sm:grid-cols-2">
      {PALETTES.map((p) => {
        const on = cur === p.v;
        return (
          <button key={p.v} type="button" role="radio" aria-checked={on} onClick={() => { applyPalette(p.v); setCur(p.v); }}
            className={cn("flex items-center gap-3 rounded-xl border bg-white p-3 text-left transition hover:border-slate-300",
              on ? "border-brand-500 ring-3 ring-brand-50" : "border-slate-200")}>
            <span className="flex shrink-0">
              {p.dots.map((c, i) => <i key={i} className={cn("h-6 w-6 rounded-full border-2 border-white shadow-sm", i && "-ml-2")} style={{ background: c }} />)}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-sm font-semibold text-slate-900">{p.t}</b>
              <small className="block text-xs text-slate-500">{p.d}</small>
            </span>
            {on && <Check size={16} className="shrink-0 text-brand-600" />}
          </button>
        );
      })}
    </div>
  );
}
