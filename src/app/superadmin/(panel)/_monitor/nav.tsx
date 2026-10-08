"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity, ChevronDown, CircleHelp, Database, DatabaseBackup, FileText, Globe, HardDrive, LayoutDashboard, ListChecks, LogOut, Menu, Monitor, Moon,
  MoreHorizontal, Plus, Rocket, ScrollText, Settings, ShieldAlert, Siren, Sun, Users, type LucideIcon,
} from "lucide-react";
import type { ColorMode, MobileLayout, UiPrefs } from "@/lib/control/ui-prefs";
import { adminLogoutAction } from "../../login/actions";
import { BottomSheet } from "../../_ui/sheet";
import { applyUiPrefs, usePrefsSync } from "../../_ui/prefs-client";
import { saveUiPrefs } from "../sozlamalar/actions";
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
  { href: "/superadmin/sozlamalar", label: "Sozlamalar", icon: Settings },
  { href: "/superadmin/yordam", label: "Yordam", icon: CircleHelp },
];
/** Telefon «Vidjetlar» dock'i: 4 asosiy bo'lim + «Ko'proq» (qolganlari varaqda). */
const TABS: { href: string; label: string }[] = [
  { href: "/superadmin", label: "Holat" },
  { href: "/superadmin/hodisalar", label: "Hodisalar" },
  { href: "/superadmin/monitoring", label: "Server" },
  { href: "/superadmin/amallar", label: "Amallar" },
];
/** Telefon «Zich Pro» segmenti. */
const SEG: { href: string; label: string }[] = [
  { href: "/superadmin", label: "Holat" },
  { href: "/superadmin/hodisalar", label: "Hodisalar" },
  { href: "/superadmin/loglar", label: "Loglar" },
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

/* ─────────── Prefs va «Ko'proq» varag'i — butun qobiq uchun bitta holat ─────────── */
type Shell = { prefs: UiPrefs; setColor: (c: ColorMode) => void; openMore: () => void };
const ShellCtx = createContext<Shell | null>(null);
const useShell = () => useContext(ShellCtx)!;

export function PanelShell({ prefs: initial, children }: { prefs: UiPrefs; children: React.ReactNode }) {
  const [prefs, setPrefs] = useState(initial);
  const [more, setMore] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => { setPrefs(initial); }, [initial]);
  useEffect(() => { setMore(false); }, [path]);
  usePrefsSync(prefs);
  const setColor = (c: ColorMode) => {
    const next = { ...prefs, colorMode: c };
    setPrefs(next); applyUiPrefs(next);
    start(async () => { await saveUiPrefs({ colorMode: c }); router.refresh(); });
  };
  return (
    <ShellCtx.Provider value={{ prefs, setColor, openMore: () => setMore(true) }}>
      {children}
      <MoreSheet open={more} onClose={() => setMore(false)} layout={prefs.mobileLayout} />
    </ShellCtx.Provider>
  );
}

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

/* ─────────── Telefon: pastki dock (faqat «Vidjetlar») ─────────── */
export function PanelTabBar() {
  const path = usePathname();
  const hot = useHot();
  const { prefs, openMore } = useShell();
  if (prefs.mobileLayout !== "widgets") return null;
  const tabHrefs = new Set(TABS.map((t) => t.href));
  const moreActive = NAV.filter((n) => !tabHrefs.has(n.href)).some((n) => isActive(path, n));
  return (
    <nav className="sa-tabbar" aria-label="Asosiy bo'limlar">
      {TABS.map((t) => {
        const n = byHref.get(t.href)!;
        const active = isActive(path, n);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} aria-label={n.alerts && hot > 0 ? `${t.label} — ${hotLabel(hot)}` : undefined}>
            <span className="ti"><n.icon size={22} aria-hidden />{n.alerts && hot > 0 && <span className="sa-badge" aria-hidden>{hot > 99 ? "99+" : hot}</span>}</span>
            {t.label}
          </Link>
        );
      })}
      <button type="button" onClick={openMore} aria-haspopup="dialog" data-active={moreActive}>
        <span className="ti"><MoreHorizontal size={22} aria-hidden /></span>
        Ko&apos;proq
      </button>
    </nav>
  );
}

function MoreSheet({ open, onClose, layout }: { open: boolean; onClose: () => void; layout: MobileLayout }) {
  const path = usePathname();
  // Vidjetlar: dock'dagi 4 tasidan tashqari hammasi; Zich Pro: barcha bo'limlar (pastki panel yo'q)
  const tabHrefs = new Set(layout === "widgets" ? TABS.map((t) => t.href) : []);
  const rest = NAV.filter((n) => !tabHrefs.has(n.href));
  return (
    <BottomSheet open={open} onClose={onClose} title="Bo'limlar">
      <ul className="sa-more-grid">
        {rest.map((n) => (
          <li key={n.href}>
            <Link href={n.href} aria-current={isActive(path, n) ? "page" : undefined} onClick={onClose}>
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
  );
}

/* ─────────── Shapka ─────────── */
const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const p2 = (x: number) => String(x).padStart(2, "0");

function useClock(ms: number) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Kompyuter: katta soat + server + jonli holat + foydalanuvchi. Telefon: tanlangan ko'rinish shapkasi. */
export function PanelTop({ fullName, login, hostname }: { fullName: string; login: string; hostname: string }) {
  const { data } = useLiveMonitor();
  const { prefs, openMore } = useShell();
  const pro = prefs.mobileLayout === "pro";
  const now = useClock(pro ? 1_000 : 5_000);
  const host = data?.host?.hostname ?? hostname;
  const initials = fullName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "IT";
  const hm = now ? `${p2(now.getHours())}:${p2(now.getMinutes())}` : "--:--";
  const date = now ? `${WEEKDAYS[now.getDay()]}, ${now.getDate()}-${MONTHS[now.getMonth()]}` : " ";
  return (
    <>
      <header className="sa-top">
        <div className="sa-clock">
          <time dateTime={now?.toISOString()} aria-label={now ? `Hozir ${hm}` : undefined}>{hm}</time>
          <small>{date} · <span data-no-translit>{host}</span></small>
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
      {pro ? <ProTop host={host} now={now} openMore={openMore} /> : (
        <header className="m4-top">
          <div className="min-w-0">
            <small suppressHydrationWarning>{date} · {hm}</small>
            <b>Insof IT</b>
          </div>
          <div className="flex items-center gap-2">
            <ConnBadge compact />
            <button type="button" className="m4-ava" onClick={openMore} aria-label={`Profil va bo'limlar: ${fullName}`} aria-haspopup="dialog">{initials}</button>
          </div>
        </header>
      )}
    </>
  );
}

function ProTop({ host, now, openMore }: { host: string; now: Date | null; openMore: () => void }) {
  const path = usePathname();
  const hot = useHot();
  const { conn } = useLiveMonitor();
  return (
    <header className="m5-top">
      <div className="m5-row">
        <Link href="/superadmin/monitoring" className="m5-host" aria-label={`Server: ${host}`}><span data-no-translit>{host}</span><ChevronDown size={14} aria-hidden /></Link>
        <span className={`m5-live ${conn === "live" ? "" : "off"}`} role="status">
          <span className={`sa-dot ${conn === "live" ? "ok sa-live" : conn === "offline" || conn === "auth" ? "crit" : ""}`} aria-hidden />
          {conn === "live" ? "LIVE 3s" : conn === "polling" ? "POLL 5s" : conn === "connecting" ? "…" : "OFF"}
        </span>
        <time className="m5-clk" suppressHydrationWarning>{now ? `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}` : ""}</time>
        <button type="button" className="m5-ib" onClick={openMore} aria-label="Menyu: barcha bo'limlar" aria-haspopup="dialog"><Menu size={20} aria-hidden /></button>
      </div>
      <nav className="m5-seg" aria-label="Bo'lim">
        {SEG.map((s) => {
          const active = isActive(path, byHref.get(s.href)!);
          return (
            <Link key={s.href} href={s.href} aria-current={active ? "page" : undefined}>
              {s.label}{s.href.endsWith("hodisalar") && hot > 0 && <b aria-label={hotLabel(hot)}>{hot}</b>}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/* ─────────── Rang rejimi: Tizim → Yorug' → Qorong'i (bazaga saqlanadi) ─────────── */
function ThemeToggle({ variant, onTip, onHide }: { variant: "side" | "grid"; onTip?: (l: string) => (e: React.SyntheticEvent<HTMLElement>) => void; onHide?: () => void }) {
  const { prefs, setColor } = useShell();
  const theme = prefs.colorMode;
  const next: ColorMode = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const name = { system: "Tizim", light: "Yorug'", dark: "Qorong'i" }[theme];
  const I = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = `Rang rejimi: ${name} (bosilsa — ${({ system: "tizim", light: "yorug'", dark: "qorong'i" })[next]})`;
  const click = () => setColor(next);
  if (variant === "grid") return <button type="button" onClick={click} aria-label={label}><I size={22} aria-hidden />Rejim: {name}</button>;
  return (
    <button type="button" className="sa-side-btn" onClick={click} aria-label={label}
      onMouseEnter={onTip?.(`Rejim: ${name}`)} onMouseLeave={onHide} onFocus={onTip?.(`Rejim: ${name}`)} onBlur={onHide}>
      <I size={20} aria-hidden />
    </button>
  );
}
