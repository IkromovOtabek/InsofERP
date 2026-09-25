"use client";

import { useState, type ReactNode } from "react";
import { Users, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Yangi zayavka" kimga ochilyapti: mijozgami yoki o'z skladimizgami.
 * Mijoz — odatdagi sotuv formasi; Sklad — zaxiraga ishlab chiqarish (mijozsiz, narxsiz).
 * Ikkala forma ham serverda tayyorlanadi, bu yerda faqat qaysi biri ko'rinishi hal qilinadi.
 */
export function NewOrderMode({ sale, stock, initial = "sale" }: { sale: ReactNode; stock: ReactNode; initial?: "sale" | "stock" }) {
  const [mode, setMode] = useState<"sale" | "stock">(sale ? initial : "stock");

  const tabs = [
    { key: "sale" as const, icon: Users, label: "Mijoz uchun", hint: "Sotuv: narx, to'lov, yetkazish" },
    { key: "stock" as const, icon: Boxes, label: "Sklad uchun", hint: "Zaxira: erkin mahsulot chiqarib qo'yish" },
  ].filter((t) => (t.key === "sale" ? !!sale : true));

  return (
    <div>
      {tabs.length > 1 && (
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={mode === t.key}
              onClick={() => setMode(t.key)}
              className={cn(
                "flex items-start gap-2.5 rounded-(--radius-card) border p-3 text-left transition",
                mode === t.key ? "border-slate-900 bg-slate-900 text-white shadow-(--shadow-card)" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
              )}
            >
              <t.icon size={18} className={cn("mt-0.5 shrink-0", mode === t.key ? "text-white" : "text-slate-400")} />
              <span>
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className={cn("block text-xs", mode === t.key ? "text-white/70" : "text-slate-500")}>{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {/* Ikkala forma ham DOM'da qolsa ikkita <form> bo'lib ketadi — faqat tanlangani chiziladi */}
      {mode === "sale" ? sale : stock}
    </div>
  );
}
