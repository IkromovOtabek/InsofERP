"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutDashboard, ClipboardList, Users, BriefcaseBusiness, Building2, CakeSlice, Factory, FlaskConical, Truck, Warehouse, PackagePlus, Handshake, Receipt, Landmark, Contact, Settings, LogOut, Menu, X, BookOpen, Clock, BarChart3, ChevronDown, ChevronLeft, TrendingUp, UserRoundCheck, Package, Megaphone, Target, BrainCircuit, Sparkles, ShoppingCart, HardHat, ListChecks, ArrowLeftRight, Smartphone, ShoppingBasket, ClipboardCheck, Download, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";
import { Avatar } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoMark } from "@/components/logo";
import { AiPanel, AiTrigger } from "@/components/ai-panel";
import { Tour, TourTrigger } from "@/components/tour";
import type { TourStep } from "@/lib/tour";

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard, "/orders": ClipboardList, "/sales": ShoppingCart, "/customers": Users, "/production": Factory, "/recipes": FlaskConical,
  "/trips": Truck, "/stock": Warehouse, "/snabjeniye": ShoppingBasket, "/taminot": ClipboardCheck, "/receipts": PackagePlus, "/suppliers": Handshake, "/invoices": Receipt,
  "/payments": Landmark, "/cashflow": ArrowLeftRight, "/tasks": ListChecks, "/brigades": HardHat, "/employees": Contact, "/drivers": Smartphone, "/bi-tahlil": BarChart3, "/settings": Settings,
  "/otdel-kadr": Users, "/otdel-kadr?tab=lavozimlar": BriefcaseBusiness, "/otdel-kadr?tab=bolimlar": Building2, "/otdel-kadr?tab=taqvim": CakeSlice,
  "/bi-tahlil/sotuvlar": TrendingUp, "/bi-tahlil/agentlar": UserRoundCheck, "/bi-tahlil/mijozlar": Users, "/bi-tahlil/ombor": Warehouse, "/bi-tahlil/mahsulotlar": Package, "/bi-tahlil/ishlab-chiqarish": Factory,
  "/bi-tahlil/marketing": Megaphone, "/bi-tahlil/reja": Target, "/bi-tahlil/moliya": Landmark, "/bi-tahlil/ml": BrainCircuit, "/bi-tahlil/ai": Sparkles,
};
// Tartib: Bosh sahifa → Tahlil (BI) → operatsion modullar (Sotuv … Moliya) → Otdel kadr → Boshqaruv (Xodimlar, Sozlamalar).
// Otdel kadr alohida bo'lim: kadr ishlari boshqaruv bandlari bilan aralashib ketmasin.
const GROUP_ORDER = ["Asosiy", "Tahlil", "Sotuv", "Ishlab chiqarish", "Logistika", "Sklad", "Moliya", "Otdel kadr", "Boshqaruv"];

type User = { fullName: string; roleLabel: string };

/** Eng uzun mos keladigan href — /bi-tahlil va /bi-tahlil/sotuvlar bir vaqtda faol bo'lmasligi uchun. */
function bestMatch(path: string, items: NavItem[]) {
  let best = "";
  for (const i of items) {
    for (const h of [i.href, ...(i.children ?? []).map((c) => c.href)]) {
      if ((path === h || path.startsWith(h + "/")) && h.length > best.length) best = h;
    }
  }
  return best;
}

function NavList({ items, onNavigate, collapsed }: { items: NavItem[]; onNavigate?: () => void; collapsed?: boolean }) {
  const path = usePathname();
  // Ba'zi bandlar bitta sahifaning tablari (`/otdel-kadr?tab=…`) — avval so'rov satri bilan qidiriladi,
  // topilmasa oddiy yo'l bo'yicha (masalan /tasks?brigade=… da "Topshiriqlar" yonib tursin).
  const search = useSearchParams().toString();
  const current = search ? `${path}?${search}` : path;
  const active = bestMatch(current, items) || bestMatch(path, items);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Guruhlar akkordeon: bir vaqtda faqat bittasi ochiq. Sarlavha bosilsa o'sha guruh ochiladi, oldingisi yopiladi.
  // Sukut bo'yicha (null) joriy sahifa turgan guruh ochiq.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const groups = GROUP_ORDER.map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);
  // Har bir yozuv (guruh sarlavhasi, band, ichki band) ketma-ket paydo bo'ladi — --i tartib raqami CSS'da kechikishga aylanadi
  let seq = 0;
  const stagger = (j: number) => ({ "--i": seq++, "--j": j } as React.CSSProperties);
  return (
    <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
      {groups.map(({ g, items }) => {
        const hasHeader = g !== "Asosiy";
        const groupActive = items.some((i) => active === i.href || (i.children ?? []).some((c) => active === c.href));
        const groupOpen = !hasHeader || (openGroup === null ? groupActive : openGroup === g);
        return (
          <div key={g}>
            {hasHeader && (
              <button type="button" style={stagger(0)} aria-expanded={groupOpen} data-tour={`group:${g}`}
                onClick={() => setOpenGroup(groupOpen ? "" : g)}
                className={cn("sb-item sb-group sb-fade sb-ghead mb-0.5 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-slate-50 hover:text-slate-700",
                  groupActive ? "text-slate-600" : "text-slate-400")}>
                <span>{g}</span>
                <ChevronDown size={13} className={cn("sb-gcaret transition-transform duration-300", groupOpen ? "rotate-180" : "")} />
              </button>
            )}
            <div className="sb-gbody" data-open={groupOpen}>
              <div className="min-h-0 overflow-hidden">
                <div className="space-y-0.5">
            {items.map((i, j) => {
              const Icon = ICONS[i.href];
              const isActive = active === i.href;
              const childActive = (i.children ?? []).some((c) => active === c.href);
              const expanded = open[i.href] ?? (isActive || childActive);
              return (
                <div key={i.href} style={stagger(j)} className="sb-item">
                  <div className="relative flex items-center">
                    {/* Yig'ilganda yozuv ko'rinmaydi, shuning uchun nomni sichqoncha ostida ko'rsatamiz */}
                    <Link href={i.href} onClick={onNavigate} title={collapsed ? i.label : undefined} data-tour={`nav:${i.href}`}
                      className={cn("sb-row sb-link group relative flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px]",
                        isActive ? "bg-slate-100 font-medium text-slate-900" : childActive ? "text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
                      {isActive && <span className="sb-active absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand-500" />}
                      {Icon && <Icon size={17} className={cn("sb-icon shrink-0", isActive || childActive ? "text-brand-600 dark:text-brand-400" : "text-slate-400 group-hover:text-slate-600")} />}
                      <span className="sb-fade truncate">{i.label}</span>
                    </Link>
                    {i.children && (
                      <button type="button" aria-label={expanded ? "Yopish" : "Ochish"} onClick={() => setOpen((o) => ({ ...o, [i.href]: !expanded }))}
                        className="sb-caret absolute right-1 flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900">
                        <ChevronDown size={15} className={cn("transition-transform", expanded ? "rotate-180" : "")} />
                      </button>
                    )}
                  </div>
                  {i.children && expanded && (
                    <div className="sb-sub animate-fade-up ml-[22px] mt-0.5 space-y-0.5 border-l border-slate-200 pl-3">
                      {i.children.map((c, ci) => {
                        const ca = active === c.href;
                        return (
                          <Link key={c.href} href={c.href} onClick={onNavigate} style={{ "--i": ci, "--j": j + ci + 1 } as React.CSSProperties}
                            className={cn("sb-item sb-link group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px]", ca ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900")}>
                            <span className={cn("sb-dot h-1.5 w-1.5 shrink-0 rounded-full", ca ? "bg-brand-500" : "bg-slate-300 group-hover:bg-brand-400")} />
                            <span className="truncate">{c.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarInner({ items, user, brand, apk, onNavigate, collapsed, onToggle }:
  { items: NavItem[]; user: User; brand: string; apk?: string | null; onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div className="relative flex h-full flex-col border-r border-slate-200/80 bg-white text-slate-700 dark:bg-[#0c1729]">
      {/* Yig'ish/yoyish strelkasi — chekkaga osilgan dumaloq tugma. Strelka yo'nalishini CSS buradi. */}
      {onToggle && (
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? "Menyuni yoyish" : "Menyuni yig'ish"}
          title={collapsed ? "Menyuni yoyish" : "Menyuni yig'ish"}
          className="sb-toggle absolute -right-3 top-7 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-(--shadow-card) transition hover:border-brand-500 hover:text-slate-900 lg:flex">
          <ChevronLeft size={14} />
        </button>
      )}
      <div className="sb-row flex items-center gap-2.5 px-5 pb-4 pt-5">
        <LogoMark className="h-9 w-9 shrink-0" />
        <div className="sb-fade min-w-0">
          <div className="truncate text-[15px] font-semibold text-slate-900">Insof ERP</div>
          <div className="truncate text-[11px] text-slate-500">{brand}</div>
        </div>
      </div>
      <NavList items={items} onNavigate={onNavigate} collapsed={collapsed} />
      <div className="border-t border-slate-200/80 p-3">
        {/* Mobil ilova — hamma rol uchun, haydovchi ham shu yerdan yuklab oladi.
            Fayl serverda bo'lmasa tugma umuman ko'rinmaydi (`lib/apk.ts`). */}
        {apk != null && (
          <a
            href="/api/app/android"
            download
            data-tour="apk"
            onClick={onNavigate}
            title={`Mobil ilova (Android, ${apk})`}
            className="mb-1 flex items-center gap-3 rounded-lg px-2 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Download size={15} /></span>
            <span className="sb-fade min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">Mobil ilova</span>
              <span className="block truncate text-[11px] text-slate-500">Android · {apk}</span>
            </span>
          </a>
        )}
        <div className="sb-user flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={user.fullName} className="h-8 w-8 shrink-0 text-xs" />
          <div className="sb-fade min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-slate-900">{user.fullName}</div>
            <div className="truncate text-[11px] text-slate-500">{user.roleLabel}</div>
          </div>
          <form action="/api/logout" method="post">
            <button title="Chiqish" data-tour="logout" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"><LogOut size={15} /></button>
          </form>
        </div>
      </div>
    </div>
  );
}

function HeaderClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const hh = now ? String(now.getHours()).padStart(2, "0") : "--";
  const mm = now ? String(now.getMinutes()).padStart(2, "0") : "--";
  const ss = now ? String(now.getSeconds()).padStart(2, "0") : "--";
  const blink = now && now.getSeconds() % 2 === 0;

  return (
    <div className="hidden items-center gap-2 rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 px-3 py-1.5 shadow-xs sm:flex">
      <Clock size={15} className="text-brand-500" />
      <div className="flex items-baseline font-semibold tabular-nums tracking-tight text-slate-900">
        <span className="text-[15px] leading-none">{hh}</span>
        <span className={cn("px-[1px] text-[15px] leading-none transition-opacity duration-200", blink ? "opacity-100" : "opacity-25")}>:</span>
        <span className="text-[15px] leading-none">{mm}</span>
        <span className="ml-1 text-[11px] font-medium leading-none text-slate-400">{ss}</span>
      </div>
    </div>
  );
}

export function AppShell({ items, user, brand, ai = false, apk = null, tour, children }:
  { items: NavItem[]; user: User; brand: string; ai?: boolean; apk?: string | null; tour?: { steps: TourStep[]; start: string | null }; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  // Holatni <html> dagi klassdan o'qiymiz — uni layout.tsx skripti sahifa chizilishidan oldin qo'ygan
  useEffect(() => { setCollapsed(document.documentElement.classList.contains("sb-collapsed")); }, []);

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.classList.toggle("sb-collapsed", next);
    try { localStorage.setItem("insof-sidebar", next ? "1" : "0"); } catch { /* shaxsiy rejimda localStorage yopiq bo'lishi mumkin */ }
  };

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside data-tour="sidebar" className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sb-w)] transition-[width] duration-200 lg:block">
        <SidebarInner items={items} user={user} brand={brand} apk={apk} collapsed={collapsed} onToggle={toggleSidebar} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-(--shadow-pop) animate-fade-up">
            <SidebarInner items={items} user={user} brand={brand} apk={apk} onNavigate={() => setOpen(false)} />
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col transition-[padding] duration-200 lg:pl-[var(--sb-w)]">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)} data-tour="menu" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Menyu"><Menu size={20} /></button>
            <HeaderClock />
          </div>
          <div className="flex items-center gap-2">
            <Link href="/qollanma" data-tour="help" className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100 sm:inline-flex"><BookOpen size={15} /> Yordam</Link>
            <TourTrigger />
            {ai && <span data-tour="ai" className="inline-flex"><AiTrigger /></span>}
            <span data-tour="theme" className="inline-flex"><ThemeToggle /></span>
            <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
            <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
              <Avatar name={user.fullName} className="h-8 w-8 text-xs" />
              <div className="hidden leading-tight sm:block">
                <div className="text-[13px] font-medium text-slate-900">{user.fullName}</div>
              </div>
            </div>
          </div>
        </header>
        {ai && <AiPanel />}
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-7">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>

      {/* Instruksiya: qobiq ichida turadi — bo'limdan bo'limga o'tganda bosqich yo'qolmaydi */}
      {tour && <Tour steps={tour.steps} start={tour.start} />}
    </div>
  );
}
