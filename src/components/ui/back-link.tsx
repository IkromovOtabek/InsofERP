"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV } from "@/lib/nav";

/* Menyu (sidebar) sahifalari — bo'limning boshi, ularda «Ortga» chiqmaydi; faqat ichkariga kirilganda chiqadi.
 * `?tab=` li bandlar yo'l bo'yicha olinadi; qobiqdagi «Mening hisobim» va «Yordam» ham menyu havolasi. */
const MENU_PATHS = new Set([
  ...NAV.filter((n) => !n.hidden).flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]).map((h) => h.split("?")[0]),
  "/hisobim", "/qollanma",
]);

/* Ilova ichidagi o'tishlar tarixi (shu tab, sessionStorage). «Ortga» bir qadam
 * orqaga qaytishi uchun kerak: tarixda oldingi ERP sahifasi bo'lsa — router.back(),
 * bo'lmasa (havola yangi tabda ochilgan, Telegram'dan kirilgan) — `href` ga o'tadi. */
const KEY = "insof:nav-stack";
const MAX = 50;

function readStack(): string[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as string[]; } catch { return []; }
}
function writeStack(s: string[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s.slice(-MAX))); } catch { /* private rejim */ }
}

/** Qobiqqa bir marta qo'yiladi: har sahifa o'zgarishini stekka yozadi. */
export function NavHistoryTracker() {
  const path = usePathname();
  const sp = useSearchParams();
  useEffect(() => {
    const url = sp.size ? `${path}?${sp}` : path;
    const s = readStack();
    if (s[s.length - 1] === url) return;
    if (s[s.length - 2] === url) s.pop(); // brauzer/«Ortga» bilan orqaga qaytildi
    else s.push(url);
    writeStack(s);
  }, [path, sp]);
  return null;
}

/** Bir qadam orqaga qaytish tugmasi. `href` — tarix bo'lmaganda boriladigan ota sahifa. */
export function BackLink({ href, label = "Ortga", className }: { href: string; label?: string; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  // Menyu sahifasining o'z ichidagi ko'rinishi (masalan `/trips?status=tarix` → `/trips`) bundan mustasno
  if (MENU_PATHS.has(path) && href.split("?")[0] !== path) return null;
  return (
    <Link href={href} title="Ortga" data-fallback={label}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // yangi tabda ochish
        if (readStack().length < 2) return; // tarix yo'q — href ga
        e.preventDefault();
        router.back();
      }}
      className={cn("group inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white pl-2 pr-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 pointer-coarse:h-11 print:hidden", className)}>
      <ArrowLeft size={16} className="shrink-0 text-slate-500 transition-transform group-hover:-translate-x-0.5 group-hover:text-slate-900" aria-hidden />
      <span className="truncate">Ortga</span>
    </Link>
  );
}
