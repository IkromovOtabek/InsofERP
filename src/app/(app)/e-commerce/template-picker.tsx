"use client";

import { Check, Sparkles } from "lucide-react";
import { SHOP_TEMPLATES, shopTemplateUrl } from "@/lib/shop-templates";
import { cn } from "@/lib/utils";

/**
 * Tayyor shablon suratlar galereyasi (`lib/shop-templates.ts`). `suggested` — mahsulot nomiga mos shablon: birinchi
 * turadi va «Mos» belgisi bilan. Tanlov `name` li yashirin maydonga yoziladi; `disabled` — o'z fayli tanlangan.
 */
export function TemplatePicker({ name = "template", value, onChange, suggested, disabled, hint }: {
  name?: string; value: string | null; onChange: (key: string | null) => void; suggested: string | null; disabled?: boolean; hint?: string;
}) {
  const templates = suggested ? [...SHOP_TEMPLATES].sort((a, b) => Number(b.key === suggested) - Number(a.key === suggested)) : SHOP_TEMPLATES;
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-700">Tayyor shablon surat</span>
        <span className="text-xs text-slate-500">
          {disabled ? "O'zingiz tanlagan fayl ishlatiladi" : value ? `Tanlandi: ${SHOP_TEMPLATES.find((t) => t.key === value)?.label}` : hint ?? "Shablon yoki o'z suratingizni tanlang"}
        </span>
      </div>
      <input type="hidden" name={name} value={disabled ? "" : value ?? ""} />
      <div role="radiogroup" aria-label="Tayyor shablon surat" className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-9">
        {templates.map((t) => {
          const on = !disabled && value === t.key;
          return (
            <button
              key={t.key} type="button" role="radio" aria-checked={on} title={t.label} disabled={disabled}
              onClick={() => onChange(on ? null : t.key)}
              className={cn("group relative overflow-hidden rounded-lg border bg-white text-left transition disabled:opacity-40",
                on ? "border-brand-500 ring-2 ring-brand-500/40" : "border-slate-200 hover:border-slate-400")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- statik kichik WEBP (public/), optimallashtirish shart emas */}
              <img src={shopTemplateUrl(t.key)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              <span className="block truncate px-1.5 py-1 text-[11px] text-slate-600">{t.label}</span>
              {t.key === suggested && <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-amber-400 px-1 py-0.5 text-[10px] font-semibold text-slate-950"><Sparkles size={10} /> Mos</span>}
              {on && <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-slate-950"><Check size={12} /></span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
