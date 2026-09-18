"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardList, Users, Factory, FlaskConical, Truck, Warehouse, PackagePlus, Handshake, Receipt, Landmark, Contact, Car, Settings, LogOut, Menu, X, BookOpen, Boxes, Clock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";
import { Avatar } from "@/components/ui";

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard, "/orders": ClipboardList, "/customers": Users, "/production": Factory, "/recipes": FlaskConical,
  "/trips": Truck, "/stock": Warehouse, "/astatka": Boxes, "/receipts": PackagePlus, "/suppliers": Handshake, "/invoices": Receipt,
  "/payments": Landmark, "/employees": Contact, "/vehicles": Car, "/settings": Settings,
};
const GROUP_ORDER = ["Asosiy", "Sotuv", "Ishlab chiqarish", "Logistika", "Sklad", "Moliya", "Boshqaruv"];

type User = { fullName: string; roleLabel: string };

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  const groups = GROUP_ORDER.map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
      {groups.map(({ g, items }) => (
        <div key={g}>
          {g !== "Asosiy" && <div className="mb-1 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{g}</div>}
          <div className="space-y-0.5">
            {items.map((i) => {
              const Icon = ICONS[i.href];
              const active = path.startsWith(i.href);
              return (
                <Link key={i.href} href={i.href} onClick={onNavigate}
                  className={cn("group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
                    active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white")}>
                  {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand-400" />}
                  {Icon && <Icon size={17} className={cn("shrink-0", active ? "text-brand-400" : "text-slate-400 group-hover:text-slate-200")} />}
                  {i.label}
                </Link>
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
    <div className="flex h-full flex-col bg-ink-950 text-slate-200">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-slate-950"><Factory size={18} /></div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-white">Insof ERP</div>
          <div className="truncate text-[11px] text-slate-400">{brand}</div>
        </div>
      </div>
      <NavList items={items} onNavigate={onNavigate} />
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={user.fullName} className="h-8 w-8 text-xs" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-white">{user.fullName}</div>
            <div className="truncate text-[11px] text-slate-400">{user.roleLabel}</div>
          </div>
          <form action="/api/logout" method="post">
            <button title="Chiqish" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"><LogOut size={15} /></button>
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

export function AppShell({ items, user, brand, children }: { items: NavItem[]; user: User; brand: string; children: React.ReactNode }) {
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
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-(--shadow-pop) animate-fade-up">
            <SidebarInner items={items} user={user} brand={brand} onNavigate={() => setOpen(false)} />
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10"><X size={18} /></button>
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
            <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
              <Avatar name={user.fullName} className="h-8 w-8 text-xs" />
              <div className="hidden leading-tight sm:block">
                <div className="text-[13px] font-medium text-slate-900">{user.fullName}</div>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-7">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
