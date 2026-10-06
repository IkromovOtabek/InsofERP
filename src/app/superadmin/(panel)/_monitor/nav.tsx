"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, Database, DatabaseBackup, FileText, Globe, HardDrive, LayoutDashboard, ListChecks, LogOut, Monitor, Moon,
  MoreHorizontal, Plus, Rocket, ScrollText, ShieldAlert, Siren, Sun, Users, type LucideIcon,
} from "lucide-react";
import { adminLogoutAction } from "../../login/actions";
import { BottomSheet } from "../../_ui/sheet";
import { ConnBadge, useLiveMonitor } from "./live";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean; alerts?: boolean; sep?: boolean };
const NAV: Item[] = [
  { href: "/superadmin", label: "Umumiy holat", icon: LayoutDashboard, exact: true },
  { href: "/superadmin/monitoring", label: "Server", icon: Activity },
  { href: "/superadmin/hodisalar", label: "Hodisalar", icon: Siren, alerts: true },
  { href: "/superadmin/baza", label: "Baza", icon: Database },
  { href: "/superadmin/trafik", label: "Trafik", icon: Globe },
  { href: "/superadmin/xavfsizlik", label: "Xavfsizlik", icon: ShieldAlert },
  { href: "/superadmin/zaxira", label: "Zaxira", icon: DatabaseBackup },
  { href: "/superadmin/server", label: "Tizim", icon: HardDrive },
  { href: "/superadmin/amallar", label: "Amallar", icon: ListChecks },
  { href: "/superadmin/relizlar", label: "Relizlar", icon: Rocket },
  { href: "/superadmin/loglar", label: "Loglar", icon: FileText },
  { href: "/superadmin/korxonalar/yangi", label: "Yangi korxona", icon: Plus, sep: true },
  { href: "/superadmin/adminlar", label: "IT jamoasi", icon: Users },
  { href: "/superadmin/jurnal", label: "Jurnal", icon: ScrollText },
];
/** Telefon tab bar'i: 4 asosiy bo'lim + «Ko'proq» (qolganlari varaqda). */
const TABS: { href: string; label: string }[] = [
  { href: "/superadmin", label: "Holat" },
  { href: "/superadmin/hodisalar", label: "Hodisalar" },
  { href: "/superadmin/monitoring", label: "Server" },
  { href: "/superadmin/amallar", label: "Amallar" },
];
const byHref = new Map(NAV.map((n) => [n.href, n]));
/** Korxona sahifalari (/superadmin/korxonalar/<slug>) bosh sahifadan ochiladi — «Umumiy holat» faol turadi. */
const isActive = (path: string, n: Item) => n.exact
  ? path === n.href || (path.startsWith("/superadmin/korxonalar/") && path !== "/superadmin/korxonalar/yangi")
  : path === n.href || path.startsWith(`${n.href}/`);

/** Ochiq kritik + yuqori hodisalar soni (jonli oqimdan). */
function useHot() {
  const { data } = useLiveMonitor();
  return data ? data.counts.critical + data.counts.high : 0;
}
const hotLabel = (n: number) => `${n} ta kritik yoki yuqori hodisa`;

/* ─────────── Kompyuter: ikonli tor yon menyu ─────────── */
export function PanelNav() {
  const path = usePathname();
  const hot = useHot();
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const show = (label: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };
  const hide = () => setTip(null);
  return (
    <aside className="sa-side" onScroll={hide}>
      <Link href="/superadmin" className="sa-mark" aria-label="Insof platforma — IT panel, bosh sahifa" onMouseEnter={show("Insof platforma · IT panel")} onMouseLeave={hide} onFocus={show("Insof platforma · IT panel")} onBlur={hide}>I</Link>
      <nav aria-label="Panel bo'limlari">
        <ul className="sa-nav">
          {NAV.map((n) => {
            const active = isActive(path, n);
            const label = n.alerts && hot > 0 ? `${n.label} — ${hotLabel(hot)}` : n.label;
            return (
              [n.sep && <li key={`${n.href}-sep`} className="sep" role="presentation" />,
              <li key={n.href}>
                <Link href={n.href} aria-current={active ? "page" : undefined} aria-label={label}
                  onMouseEnter={show(n.label)} onMouseLeave={hide} onFocus={show(n.label)} onBlur={hide}>
                  <n.icon size={21} aria-hidden />
                  {n.alerts && hot > 0 && <span className="sa-badge" aria-hidden>{hot > 99 ? "99+" : hot}</span>}
                </Link>
              </li>]
            );
          })}
        </ul>
      </nav>
      <div className="sa-side-foot">
        <ThemeToggle variant="side" onTip={show} onHide={hide} />
        <form action={adminLogoutAction}>
          <button className="sa-side-btn" aria-label="Chiqish" onMouseEnter={show("Chiqish")} onMouseLeave={hide} onFocus={show("Chiqish")} onBlur={hide}><LogOut size={20} aria-hidden /></button>
        </form>
      </div>
      {tip && <span className="sa-tip" role="tooltip" style={{ top: tip.top, opacity: 1 }}>{tip.label}</span>}
    </aside>
  );
}

/* ─────────── Telefon: pastki tab bar + «Ko'proq» varag'i ─────────── */
export function PanelTabBar() {
  const path = usePathname();
  const hot = useHot();
  const [more, setMore] = useState(false);
  // Sahifa almashsa varaq yopiladi
  useEffect(() => { setMore(false); }, [path]);
  const tabHrefs = new Set(TABS.map((t) => t.href));
  const rest = NAV.filter((n) => !tabHrefs.has(n.href));
  const moreActive = rest.some((n) => isActive(path, n));
  return (
    <>
      <nav className="sa-tabbar" aria-label="Asosiy bo'limlar">
        {TABS.map((t) => {
          const n = byHref.get(t.href)!;
          const active = isActive(path, n);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} aria-label={n.alerts && hot > 0 ? `${t.label} — ${hotLabel(hot)}` : undefined}>
              <span className="ti"><n.icon size={20} aria-hidden />{n.alerts && hot > 0 && <span className="sa-badge" aria-hidden>{hot > 99 ? "99+" : hot}</span>}</span>
              {t.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more} data-active={moreActive}>
          <span className="ti"><MoreHorizontal size={20} aria-hidden /></span>
          Ko&apos;proq
        </button>
      </nav>
      <BottomSheet open={more} onClose={() => setMore(false)} title="Bo'limlar">
        <ul className="sa-more-grid">
          {rest.map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={isActive(path, n) ? "page" : undefined} onClick={() => setMore(false)}>
                <n.icon size={22} aria-hidden />{n.label}
              </Link>
            </li>
          ))}
          <li><ThemeToggle variant="grid" /></li>
          <li>
            <form action={adminLogoutAction} style={{ height: "100%" }}>
              <button style={{ height: "100%" }}><LogOut size={22} aria-hidden />Chiqish</button>
            </form>
          </li>
        </ul>
      </BottomSheet>
    </>
  );
}

/* ─────────── Shapka: katta soat, server nomi, jonli holat, foydalanuvchi ─────────── */
const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

export function PanelTop({ fullName, login, hostname }: { fullName: string; login: string; hostname: string }) {
  const { data } = useLiveMonitor();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 5_000);
    return () => clearInterval(t);
  }, []);
  const host = data?.host?.hostname ?? hostname;
  const p = (x: number) => String(x).padStart(2, "0");
  const initials = fullName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "IT";
  return (
    <header className="sa-top">
      <div className="sa-clock">
        <time dateTime={now?.toISOString()} aria-label={now ? `Hozir ${p(now.getHours())}:${p(now.getMinutes())}` : undefined}>{now ? `${p(now.getHours())}:${p(now.getMinutes())}` : "--:--"}</time>
        <small>{now ? `${WEEKDAYS[now.getDay()]}, ${now.getDate()}-${MONTHS[now.getMonth()]}` : " "} · <span data-no-translit>{host}</span></small>
      </div>
      <div className="sa-top-right">
        <ConnBadge compact />
        <div className="sa-user">
          <span className="sa-ava" aria-hidden>{initials}</span>
          <span className="who"><b>{fullName}</b><small data-no-translit>{login}</small></span>
          <span className="sa-sr">Kirgan: {fullName} ({login})</span>
        </div>
        <form action={adminLogoutAction} className="sa-logout">
          <button className="sa-iconbtn" aria-label="Chiqish" title="Chiqish"><LogOut size={18} aria-hidden /></button>
        </form>
      </div>
    </header>
  );
}

/* ─────────── Rang rejimi: Tizim → Yorug' → Qorong'i ─────────── */
type Theme = "system" | "light" | "dark";
const THEME_KEY = "insof-sa-theme";
function applyTheme(t: Theme) {
  const d = document.documentElement;
  if (t === "system") d.removeAttribute("data-theme"); else d.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  d.classList.toggle("dark", dark);
}

function ThemeToggle({ variant, onTip, onHide }: { variant: "side" | "grid"; onTip?: (l: string) => (e: React.SyntheticEvent<HTMLElement>) => void; onHide?: () => void }) {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    let t: Theme = "system";
    try { const v = localStorage.getItem(THEME_KEY); if (v === "light" || v === "dark") t = v; } catch { /* yashirin rejim */ }
    setTheme(t);
    // Tizim rejimida OS sozlamasi o'zgarsa — ERP `.dark` sinfi ham ergashsin
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => { let cur: Theme = "system"; try { const v = localStorage.getItem(THEME_KEY); if (v === "light" || v === "dark") cur = v; } catch { /* */ } if (cur === "system") applyTheme("system"); };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const name = { system: "Tizim", light: "Yorug'", dark: "Qorong'i" }[theme];
  const I = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = `Rang rejimi: ${name} (bosilsa — ${({ system: "tizim", light: "yorug'", dark: "qorong'i" })[next]})`;
  const click = () => {
    try { if (next === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* */ }
    applyTheme(next);
    setTheme(next);
  };
  if (variant === "grid") return <button type="button" onClick={click} aria-label={label}><I size={22} aria-hidden />Rejim: {name}</button>;
  return (
    <button type="button" className="sa-side-btn" onClick={click} aria-label={label}
      onMouseEnter={onTip?.(`Rejim: ${name}`)} onMouseLeave={onHide} onFocus={onTip?.(`Rejim: ${name}`)} onBlur={onHide}>
      <I size={20} aria-hidden />
    </button>
  );
}
