"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV } from "@/lib/nav";

/* Menyu (sidebar) sahifalari — bo'limning boshi, ularda «Ortga» chiqmaydi; faqat ichkariga kirilganda chiqadi.
 * `?tab=` li bandlar yo'l bo'yicha olinadi; qobiqdagi «Mening hisobim» va «Yordam» ham menyu havolasi. */
const MENU_PATHS = new Set([
  ...NAV.filter((n) => !n.hidden && !n.menuUnless).flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]).map((h) => h.split("?")[0]),
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

/* Raqam manbasiga o'tish (`a.drill-link` — hisobotdagi bosiladigan son, manba panelidagi yozuv): qaysi sahifadan
 * (`from`) qaysi yo'lga (`path`) bosilgani; o'tish bo'lgach — ochilgan sahifa (`url`). Menyu sahifasi (Kassa, Sklad…)
 * shu yo'l bilan ochilgan bo'lsa ham «Ortga» chiqadi; o'sha sahifaga menyudan kelinsa — chiqmaydi. */
const DRILL_KEY = "insof:drill-nav";
const NAV_EVENT = "insof:nav";
type DrillNav = { path: string; from: string; url?: string };

function readDrillNav(): DrillNav | null {
  try { return JSON.parse(sessionStorage.getItem(DRILL_KEY) ?? "null") as DrillNav | null; } catch { return null; }
}
function writeDrillNav(d: DrillNav | null) {
  try { if (d) sessionStorage.setItem(DRILL_KEY, JSON.stringify(d)); else sessionStorage.removeItem(DRILL_KEY); } catch { /* private rejim */ }
}
/** Joriy sahifaga raqam manbasidan kelinganmi: stek tepasi — ochilgan sahifa, undan oldingisi — son bosilgan sahifa. */
function cameFromDrill(): boolean {
  const d = readDrillNav(), s = readStack();
  return !!d?.url && s.length >= 2 && s[s.length - 1] === d.url && s[s.length - 2] === d.from;
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
    else {
      s.push(url);
      // Yangi sahifa: son bosilishining natijasi bo'lsa — belgini shu sahifaga bog'laymiz; boshqa yo'l bilan kelinsa
      // (menyu, oddiy havola) — bosilgan, lekin bajarilmagan yoki shu sahifaga tegishli eski belgi olinadi
      const d = readDrillNav();
      if (d && !d.url && d.path === path) writeDrillNav({ ...d, url });
      else if (d && (!d.url || d.url === url)) writeDrillNav(null);
    }
    writeStack(s);
    window.dispatchEvent(new Event(NAV_EVENT));
  }, [path, sp]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a.drill-link") as HTMLAnchorElement | null;
      if (!a) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin) return;
      const s = readStack();
      writeDrillNav({ path: to.pathname, from: s[s.length - 1] ?? "" });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

/** Bir qadam orqaga qaytish tugmasi. `href` — tarix bo'lmaganda boriladigan ota sahifa; `scroll={false}` — o'sha sahifada qolinsa. */
export function BackLink({ href, label = "Ortga", className, scroll }: { href: string; label?: string; className?: string; scroll?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [viaDrill, setViaDrill] = useState(false);
  useEffect(() => {
    const check = () => setViaDrill(cameFromDrill());
    check();
    window.addEventListener(NAV_EVENT, check);
    return () => window.removeEventListener(NAV_EVENT, check);
  }, []);
  // Menyu sahifasining o'z ichidagi ko'rinishi (masalan `/trips?status=tarix` → `/trips`) bundan mustasno;
  // raqam manbasidan (son bosilib) kelingan menyu sahifasida ham chiqadi — hisobotga qaytish uchun
  if (MENU_PATHS.has(path) && href.split("?")[0] !== path && !viaDrill) return null;
  return (
    <Link href={href} scroll={scroll} title="Ortga" data-fallback={label}
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
