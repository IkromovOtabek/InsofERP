"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardList, Users, Factory, FlaskConical, Truck, Warehouse, PackagePlus, Handshake, Receipt, Landmark, Contact, Car, Settings, LogOut, Menu, X, BookOpen, Boxes, Clock, BarChart3, ChevronDown, TrendingUp, UserRoundCheck, Package, Megaphone, Target, BrainCircuit, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";
import { Avatar } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoMark } from "@/components/logo";
import { AiPanel, AiTrigger } from "@/components/ai-panel";

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard, "/orders": ClipboardList, "/customers": Users, "/production": Factory, "/recipes": FlaskConical,
  "/trips": Truck, "/stock": Warehouse, "/astatka": Boxes, "/receipts": PackagePlus, "/suppliers": Handshake, "/invoices": Receipt,
  "/payments": Landmark, "/employees": Contact, "/vehicles": Car, "/bi-tahlil": BarChart3, "/settings": Settings,
  "/bi-tahlil/sotuvlar": TrendingUp, "/bi-tahlil/agentlar": UserRoundCheck, "/bi-tahlil/mijozlar": Users, "/bi-tahlil/ombor": Warehouse, "/bi-tahlil/mahsulotlar": Package, "/bi-tahlil/ishlab-chiqarish": Factory,
  "/bi-tahlil/marketing": Megaphone, "/bi-tahlil/reja": Target, "/bi-tahlil/moliya": Landmark, "/bi-tahlil/ml": BrainCircuit, "/bi-tahlil/ai": Sparkles,
};
const GROUP_ORDER = ["Asosiy", "Sotuv", "Ishlab chiqarish", "Logistika", "Sklad", "Moliya", "Tahlil", "Boshqaruv"];

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

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  const active = bestMatch(path, items);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = GROUP_ORDER.map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
      {groups.map(({ g, items }) => (
        <div key={g}>
          {g !== "Asosiy" && <div className="mb-1 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">{g}</div>}
          <div className="space-y-0.5">
            {items.map((i) => {
              const Icon = ICONS[i.href];
              const isActive = active === i.href;
              const childActive = (i.children ?? []).some((c) => active === c.href);
              const expanded = open[i.href] ?? (isActive || childActive);
              return (
                <div key={i.href}>
                  <div className="relative flex items-center">
                    <Link href={i.href} onClick={onNavigate}
                      className={cn("group relative flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
                        isActive ? "bg-slate-100 font-medium text-slate-900" : childActive ? "text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
                      {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand-500" />}
                      {Icon && <Icon size={17} className={cn("shrink-0", isActive || childActive ? "text-brand-600 dark:text-brand-400" : "text-slate-400 group-hover:text-slate-600")} />}
                      <span className="truncate">{i.label}</span>
                    </Link>
                    {i.children && (
                      <button type="button" aria-label={expanded ? "Yopish" : "Ochish"} onClick={() => setOpen((o) => ({ ...o, [i.href]: !expanded }))}
                        className="absolute right-1 flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900">
                        <ChevronDown size={15} className={cn("transition-transform", expanded ? "rotate-180" : "")} />
                      </button>
                    )}
                  </div>
                  {i.children && expanded && (
                    <div className="ml-[22px] mt-0.5 space-y-0.5 border-l border-slate-200 pl-3">
                      {i.children.map((c) => {
                        const ca = active === c.href;
                        return (
                          <Link key={c.href} href={c.href} onClick={onNavigate}
                            className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors", ca ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900")}>
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", ca ? "bg-brand-500" : "bg-slate-300")} />
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
      ))}
    </nav>
  );
}

function SidebarInner({ items, user, brand, onNavigate }: { items: NavItem[]; user: User; brand: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col border-r border-slate-200/80 bg-white text-slate-700 dark:bg-[#0b1120]">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <LogoMark className="h-9 w-9 shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-slate-900">Insof ERP</div>
          <div className="truncate text-[11px] text-slate-500">{brand}</div>
        </div>
      </div>
      <NavList items={items} onNavigate={onNavigate} />
      <div className="border-t border-slate-200/80 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={user.fullName} className="h-8 w-8 text-xs" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-slate-900">{user.fullName}</div>
            <div className="truncate text-[11px] text-slate-500">{user.roleLabel}</div>
          </div>
          <form action="/api/logout" method="post">
            <button title="Chiqish" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"><LogOut size={15} /></button>
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

export function AppShell({ items, user, brand, ai = false, children }: { items: NavItem[]; user: User; brand: string; ai?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><SidebarInner items={items} user={user} brand={brand} /></aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-(--shadow-pop) animate-fade-up">
            <SidebarInner items={items} user={user} brand={brand} onNavigate={() => setOpen(false)} />
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Menyu"><Menu size={20} /></button>
            <HeaderClock />
          </div>
          <div className="flex items-center gap-2">
            <Link href="/qollanma" className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100 sm:inline-flex"><BookOpen size={15} /> Yordam</Link>
            {ai && <AiTrigger />}
            <ThemeToggle />
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
    </div>
  );
}
