"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, Filter, Headset, MessagesSquare, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { T } from "@/lib/crm/labels";

/** CRM bo'limlari (CRM_SPEC 5): telefonda — pastki menyu, kompyuterda — sahifa tepasida. Tayyor bo'lganlari qo'shib boriladi. */
const ITEMS: { href: string; label: string; icon: LucideIcon; ready: boolean }[] = [
  { href: "/crm", label: T.nav.today, icon: CalendarCheck, ready: true },
  { href: "/crm/mijozlar", label: T.nav.clients, icon: Users, ready: true },
  { href: "/crm/voronka", label: T.nav.funnel, icon: Filter, ready: true },
  { href: "/crm/aloqalar", label: T.nav.contacts, icon: MessagesSquare, ready: true },
  { href: "/crm/callcenter", label: T.nav.callCenter, icon: Headset, ready: true },
];

export function CrmNav({ callCenter }: { callCenter: boolean }) {
  const path = usePathname();
  const items = ITEMS.filter((i) => i.ready && (i.href !== "/crm/callcenter" || callCenter));
  const active = (href: string) => (href === "/crm" ? path === "/crm" : path === href || path.startsWith(href + "/"));
  return (
    <>
      <nav aria-label={T.module} className="mb-4 hidden gap-1 lg:flex">
        {items.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}
            className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition", active(i.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
            <i.icon size={15} /> {i.label}
          </Link>
        ))}
      </nav>
      <nav aria-label={T.module} className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {items.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}
            className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active(i.href) ? "text-slate-900" : "text-slate-500")}>
            <i.icon size={20} strokeWidth={active(i.href) ? 2.4 : 1.8} /> {i.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
