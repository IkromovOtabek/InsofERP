import Link from "next/link";
import { CircleAlert, CircleCheck, CircleMinus, CircleX } from "lucide-react";
import { entryStatus, type EntryState } from "@/lib/nazorat/entry-status";
import { cn } from "@/lib/utils";

// Blok har doim to'q (`on-dark`): ranglar aniq hex — tungi mavzuda och tuslar (`*-100`) shaffofga almashtiriladi
const STYLE: Record<EntryState, { cls: string; icon: typeof CircleCheck; label: string }> = {
  ok: { cls: "border-[#34d399]/30 bg-[#34d399]/10 text-[#d1fae5] hover:bg-[#34d399]/20", icon: CircleCheck, label: "kiritilgan" },
  partial: { cls: "border-[#fbbf24]/40 bg-[#fbbf24]/15 text-[#fef3c7] hover:bg-[#fbbf24]/25", icon: CircleAlert, label: "qisman" },
  missing: { cls: "border-[#f87171]/50 bg-[#ef4444]/20 text-[#fee2e2] hover:bg-[#ef4444]/30", icon: CircleX, label: "kiritilmagan" },
  none: { cls: "border-white/15 bg-white/5 text-[#cbd5e1] hover:bg-white/10", icon: CircleMinus, label: "yozuv kerak emas" },
};

/** Ism ro'yxati qisqa: ikkitasi va «+N». */
const names = (who: string[]) => (who.length > 2 ? `${who.slice(0, 2).join(", ")} +${who.length - 2}` : who.join(", "));

/**
 * Salomlashuv blokidagi «Kiritish nazorati» qatori: bugun har bo'lim (kadrlar, sklad, ishlab chiqarish, realizatsiya, kassa)
 * o'z ma'lumotini kiritganmi va kim mas'ul. Kiritilmagani qizil, qismani sariq; bosilsa — shu bo'lim sahifasi.
 * Hisob — `lib/nazorat/entry-status.ts`.
 */
export async function EntryStatusRow() {
  const rows = await entryStatus();
  const bad = rows.filter((r) => r.state === "missing" || r.state === "partial").length;
  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="mb-2 text-xs font-semibold text-[#cbd5e1]">
        Kiritish nazorati · bugun{bad ? <span className="ml-1 text-[#fde68a]">— {bad} ta bo&apos;lim to&apos;liq kiritmagan</span> : <span className="ml-1 text-[#a7f3d0]">— hammasi kiritilgan</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => {
          const st = STYLE[r.state], Icon = st.icon;
          const who = names(r.who);
          return (
            <Link key={r.key} href={r.href} title={`${r.dept}: ${st.label}${r.who.length ? ` · mas'ul: ${r.who.join(", ")}` : ""}`}
              className={cn("inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] leading-tight transition", st.cls)}>
              <Icon size={15} className="shrink-0" aria-label={st.label} />
              <span className="min-w-0">
                <b className="font-semibold text-[#fff]">{r.dept}</b> · {r.text}
                {who && (r.state === "missing" || r.state === "partial") && <span className="opacity-80"> — {who}</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
