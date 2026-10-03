"use client";

import { useYozuv } from "@/components/script-provider";
import { cn } from "@/lib/utils";

/**
 * "Lotin | Кирилл" almashtirgichi. Bosilganda darhol o'zgaradi (sahifa qayta yuklanmaydi),
 * tanlov `yozuv` cookie'sida bir yil saqlanadi. O'zi transliteratsiya qilinmaydi (data-no-translit).
 */
export function ScriptToggle({ className }: { className?: string }) {
  const { yozuv, setYozuv } = useYozuv();
  const btn = (on: boolean) =>
    cn("rounded-md px-2 py-1 text-[12px] font-medium leading-none transition-colors pointer-coarse:px-2.5 pointer-coarse:py-2",
      on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900");
  return (
    <div data-no-translit role="radiogroup" aria-label="Yozuv / Ёзув"
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5", className)}>
      <button type="button" role="radio" aria-checked={yozuv === "lotin"} className={btn(yozuv === "lotin")} onClick={() => setYozuv("lotin")}>Lotin</button>
      <button type="button" role="radio" aria-checked={yozuv === "kiril"} className={btn(yozuv === "kiril")} onClick={() => setYozuv("kiril")}>Кирилл</button>
    </div>
  );
}
