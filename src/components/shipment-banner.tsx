"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BellRing, ChevronRight, X } from "lucide-react";

export type BannerShipment = { id: string; docNo: string; by: string; supplier: string; pending: number };

const SEEN_KEY = "insof:shipment-banner";

/**
 * Sklad xodimiga tepadan tushadigan bildirishnoma: «Sizga yangi mahsulotlar keldi — qabul qiling».
 * Ma'lumot layout'dan keladi va `LiveRefresh` bilan 30 soniyada yangilanadi. Yangi jo'natma qo'shilganda banner
 * qaytadan «tushadi» (yopilgan bo'lsa ham); jo'natmalar sahifasining o'zida ko'rinmaydi.
 */
export function ShipmentBanner({ count, rows }: { count: number; rows: BannerShipment[] }) {
  const pathname = usePathname();
  const sig = rows.map((r) => r.id).join(",") + `#${count}`;
  const [hidden, setHidden] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    let prev: string | null = null;
    try { prev = sessionStorage.getItem(SEEN_KEY); } catch { /* xususiy oyna */ }
    setHidden(prev && prev.startsWith("x:") && prev.slice(2) === sig ? sig : null);
    // Yangi jo'natma — banner silkinib tushadi
    if (prev !== sig && prev !== `x:${sig}`) {
      setFresh(true);
      try { sessionStorage.setItem(SEEN_KEY, sig); } catch { /* xususiy oyna */ }
      const t = setTimeout(() => setFresh(false), 1600);
      return () => clearTimeout(t);
    }
  }, [sig]);

  if (count === 0 || hidden === sig || pathname.startsWith("/jonatma")) return null;
  const one = count === 1 ? rows[0] : null;
  const href = one ? `/jonatma/${one.id}` : "/jonatma?tab=open";

  return (
    <div role="status" className={`mb-4 overflow-hidden rounded-(--radius-card) border border-amber-300 bg-gradient-to-r from-amber-50 to-amber-100/70 shadow-(--shadow-card) ${fresh ? "animate-[shipment-drop_.6s_cubic-bezier(.2,.9,.3,1.2)]" : ""}`}>
      <style>{`@keyframes shipment-drop{0%{transform:translateY(-120%);opacity:0}70%{transform:translateY(4px);opacity:1}100%{transform:translateY(0)}}`}</style>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
          <BellRing size={20} className={fresh ? "animate-bounce" : undefined} />
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold">{count}</span>
        </span>
        <Link href={href} className="min-w-0 flex-1">
          <div className="font-semibold text-amber-950">Sizga yangi mahsulotlar keldi — qabul qiling</div>
          <div className="truncate text-sm text-amber-900/80">
            {one ? `${one.docNo} · ${one.by} · ${one.supplier} · ${one.pending} qator` : `${count} ta jo'natma qabul kutmoqda: ${rows.map((r) => r.docNo).join(", ")}`}
          </div>
        </Link>
        <Link href={href} className="hidden shrink-0 items-center gap-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 sm:inline-flex">
          Qabul qiling <ChevronRight size={16} />
        </Link>
        <button type="button" aria-label="Yopish" title="Yangi jo'natma kelguncha yashirish"
          onClick={() => { setHidden(sig); try { sessionStorage.setItem(SEEN_KEY, `x:${sig}`); } catch { /* xususiy oyna */ } }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-amber-700 hover:bg-amber-200/60"><X size={18} /></button>
      </div>
    </div>
  );
}
