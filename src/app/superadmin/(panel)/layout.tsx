import Link from "next/link";
import type { Metadata } from "next";
import { LayoutDashboard, Plus, ScrollText, ShieldCheck, Users, LogOut } from "lucide-react";
import { requireAdmin } from "@/lib/control/auth";
import { adminLogoutAction } from "../login/actions";

// Rejim (INSOF_MODE) va sessiya ishga tushganda aniqlanadi — build vaqtida statik qotib qolmasin
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { default: "IT panel", template: "%s · IT panel" }, robots: { index: false, follow: false } };

const NAV = [
  { href: "/superadmin", label: "Umumiy holat", icon: LayoutDashboard },
  { href: "/superadmin/korxonalar/yangi", label: "Yangi korxona", icon: Plus },
  { href: "/superadmin/adminlar", label: "IT jamoasi", icon: Users },
  { href: "/superadmin/jurnal", label: "Jurnal", icon: ScrollText },
];

/** Markaziy panel qobig'i — faqat INSOF_MODE=control jarayonida va superadmin sessiyasi bilan. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const a = await requireAdmin();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/superadmin" className="flex items-center gap-2 font-semibold text-slate-900"><ShieldCheck size={20} className="text-violet-600" /> Insof platforma</Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"><n.icon size={15} /> {n.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span>{a.fullName} <code className="rounded bg-slate-100 px-1 text-xs">{a.login}</code></span>
            <form action={adminLogoutAction}><button className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-slate-100"><LogOut size={14} /> Chiqish</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
