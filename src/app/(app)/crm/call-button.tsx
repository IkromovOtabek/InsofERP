"use client";

import { useState, useTransition } from "react";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { callClientAction } from "./actions";

/**
 * «Qo'ng'iroq» tugmasi. Telefoniya (onlinePBX) va xodimning ichki raqami bo'lsa — kompyuterdan ham ishlaydi: avval xodimning
 * telefoni/softfoni jiringlaydi, keyin mijozga ulanadi. Aks holda oddiy `tel:` havola (telefonning o'zidan).
 */
export function CallButton({ customerId, tel, pbx, variant, label }: {
  customerId: string; tel: string | null; pbx: boolean; variant: "big" | "round"; label: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cls = variant === "big"
    ? "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-1 text-center text-[12px] font-medium leading-tight text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 sm:text-[13px]"
    : "flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-60";
  const inner = variant === "big" ? <><Phone size={20} className={cn(pending && "animate-pulse")} />{pending ? "Ulanmoqda…" : label}</> : <Phone size={20} className={cn(pending && "animate-pulse")} />;

  if (!pbx) {
    if (!tel) return variant === "big" ? <span className={cn(cls, "border-slate-200 bg-transparent text-slate-300")}><Phone size={20} />{label}</span> : null;
    return <a href={tel} aria-label={label} className={cls}>{inner}</a>;
  }
  return (
    <div className="relative">
      <button type="button" aria-label={label} disabled={pending} className={cls}
        onClick={() => start(async () => {
          const r = await callClientAction(customerId);
          setMsg(r?.error ? { ok: false, text: r.error } : { ok: true, text: r?.note ?? "" });
          setTimeout(() => setMsg(null), 8000);
        })}>
        {inner}
      </button>
      {msg && (
        <div role="status" className={cn("absolute right-0 top-full z-30 mt-2 w-64 rounded-lg px-3 py-2 text-left text-xs shadow-lg ring-1",
          msg.ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200", variant === "big" && "left-0")}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
