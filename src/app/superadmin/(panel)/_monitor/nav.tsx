"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, DatabaseBackup, HardDrive, LayoutDashboard, ListChecks, Plus, ScrollText, ShieldAlert, Siren, Users } from "lucide-react";
import { useLiveMonitor } from "./live";

const NAV = [
  { href: "/superadmin", label: "Umumiy holat", icon: LayoutDashboard, exact: true },
  { href: "/superadmin/monitoring", label: "Server", icon: Activity },
  { href: "/superadmin/hodisalar", label: "Hodisalar", icon: Siren, alerts: true },
  { href: "/superadmin/xavfsizlik", label: "Xavfsizlik", icon: ShieldAlert },
  { href: "/superadmin/zaxira", label: "Zaxira", icon: DatabaseBackup },
  { href: "/superadmin/server", label: "Tizim", icon: HardDrive },
  { href: "/superadmin/amallar", label: "Amallar", icon: ListChecks },
  { href: "/superadmin/korxonalar/yangi", label: "Yangi korxona", icon: Plus },
  { href: "/superadmin/adminlar", label: "IT jamoasi", icon: Users },
  { href: "/superadmin/jurnal", label: "Jurnal", icon: ScrollText },
];

/** Panel menyusi: joriy sahifa belgilanadi, «Hodisalar» yonida ochiq kritik/yuqori hodisalar soni (jonli). */
export function PanelNav() {
  const path = usePathname();
  const { data } = useLiveMonitor();
  const hot = data ? data.counts.critical + data.counts.high : 0;
  return (
    <nav aria-label="Panel bo'limlari" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 sm:flex-wrap">
      {NAV.map((n) => {
        const active = n.exact ? path === n.href : path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm pointer-coarse:py-2.5 ${active ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
            <n.icon size={15} aria-hidden /> {n.label}
            {n.alerts && hot > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white tabular" aria-label={`${hot} ta kritik yoki yuqori hodisa`}>{hot}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
