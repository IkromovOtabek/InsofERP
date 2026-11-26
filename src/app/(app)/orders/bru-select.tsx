"use client";

import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";

export type BruOpt = { id: string; name: string };

/**
 * Beton qatori — qaysi BRU dan (`OrderItem.bruId`, majburiy): reysga o'zi tushadi, BRU varag'iga (Ish haqi) yetkazilgan m³ yoziladi.
 * BRU lar «Brigadalar» sahifasida (Turi: BRU) ochiladi; ro'yxat bo'sh bo'lsa so'ralmaydi.
 */
export function BruSelect({ brus, value, onChange, className }: { brus: BruOpt[]; value: string; onChange: (id: string) => void; className?: string }) {
  if (!brus.length) return null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} required aria-label="BRU" title="Beton qaysi BRU dan olinadi"
      className={cn("h-8 text-xs", !value && "border-amber-400 bg-amber-50", className)}>
      <option value="">BRU tanlang *</option>
      {brus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </Select>
  );
}
