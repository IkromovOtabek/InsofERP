import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Sparkles, Zap, Info, Download, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum, isoDate } from "@/lib/format";
import { Badge, type BadgeColor } from "@/components/ui";
import { Sparkline } from "@/components/ui/charts";
import { type Range, rangeQuery, addDays } from "@/lib/bi/core";

/* ───────────── Marshrutlar (Team24 sidebar tuzilmasi) ───────────── */

export const ROUTES = {
  overview: "/bi-tahlil", sales: "/bi-tahlil/sotuvlar", returns: "/bi-tahlil/sotuvlar/bekor", agents: "/bi-tahlil/agentlar", customers: "/bi-tahlil/mijozlar",
  stock: "/bi-tahlil/ombor", products: "/bi-tahlil/mahsulotlar", operations: "/bi-tahlil/ishlab-chiqarish", marketing: "/bi-tahlil/marketing",
  marketingPlan: "/bi-tahlil/marketing/reja", marketingData: "/bi-tahlil/marketing/malumotlar", plans: "/bi-tahlil/reja", finance: "/bi-tahlil/moliya",
  forecast: "/bi-tahlil/ml", anomalies: "/bi-tahlil/ml/anomaliyalar", churn: "/bi-tahlil/ml/churn", clusters: "/bi-tahlil/ml/klasterlar", ai: "/bi-tahlil/ai", chat: "/bi-tahlil/ai/chat",
} as const;
export type TabKey = keyof typeof ROUTES;
export const routeOf = (tab: string) => (ROUTES as Record<string, string>)[tab] ?? "/bi-tahlil";

/* ───────────── Davr paneli ───────────── */

export function PeriodBar({ range, tab, keep }: { range: Range; tab: string; keep?: Record<string, string | undefined> }) {
  const path = routeOf(tab);
  const extra = Object.entries(keep ?? {}).filter((kv): kv is [string, string] => !!kv[1]);
  const q = (p: Record<string, string>) => { const u = new URLSearchParams([...extra, ...Object.entries(p)]); return `${path}?${u}`; };
  const btn = (p: "day" | "month" | "year", label: string) => (
    <Link href={q({ period: p })} className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium transition", range.period === p ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100")}>{label}</Link>
  );
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-2 shadow-(--shadow-card)">
      <div className="flex gap-1">{btn("day", "Kunlik")}{btn("month", "Oylik")}{btn("year", "Yillik")}</div>
      <form method="get" action={path} className="flex flex-wrap items-center gap-1.5 text-[13px]">
        {extra.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="date" name="from" defaultValue={isoDate(range.from)} className="h-8 rounded-lg border border-slate-200 px-2 text-[13px]" />
        <span className="text-slate-400">—</span>
        <input type="date" name="to" defaultValue={isoDate(addDays(range.to, -1))} className="h-8 rounded-lg border border-slate-200 px-2 text-[13px]" />
        <button className="h-8 rounded-lg border border-slate-200 bg-white px-3 font-medium text-slate-700 hover:bg-slate-50">Qo'llash</button>
      </form>
      <div className="ml-auto text-[13px] text-slate-500"><span className="font-medium text-slate-800">{range.label}</span> <span className="text-slate-400">· taqqoslash: {range.prevLabel}</span></div>
    </div>
  );
}

export const tabHref = (range: Range, tab: string, extra?: Record<string, string>) => `${routeOf(tab)}?${rangeQuery(range, extra)}`;

/* ───────────── KPI ───────────── */

export function Delta({ value, suffix = "%", invert = false, frac = 1, label }: { value: number | null | undefined; suffix?: string; invert?: boolean; frac?: number; label?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-xs text-slate-400">—</span>;
  const up = value > 0.05, down = value < -0.05, good = invert ? down : up, bad = invert ? up : down;
  return <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular", good ? "text-emerald-600" : bad ? "text-red-600" : "text-slate-500")}>{up ? "▲" : down ? "▼" : "→"} {fmtNum(Math.abs(value), frac)}{suffix}{label && <span className="ml-1 font-normal text-slate-400">{label}</span>}</span>;
}

const kpiTone = {
  default: "bg-slate-100 text-slate-600", brand: "bg-brand-100 text-brand-700", success: "bg-emerald-50 text-emerald-700", warning: "bg-amber-50 text-amber-700", danger: "bg-red-50 text-red-700", info: "bg-blue-50 text-blue-700", violet: "bg-violet-50 text-violet-700",
};
export function Kpi({ label, value, delta, deltaLabel, invert, hint, icon: Icon, tone = "default", spark, href, badge, valueClass }: {
  label: string; value: React.ReactNode; delta?: number | null; deltaLabel?: string; invert?: boolean; hint?: React.ReactNode; icon?: LucideIcon; tone?: keyof typeof kpiTone; spark?: number[]; href?: string; badge?: React.ReactNode; valueClass?: string;
}) {
  const body = (
    <div className={cn("flex h-full flex-col rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card) transition", href && "hover:border-slate-300 hover:shadow-md")}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12.5px] font-medium text-slate-500">{label}</div>
        {Icon && <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", kpiTone[tone])}><Icon size={16} /></div>}
      </div>
      <div className={cn("mt-1 break-words text-[21px] font-semibold leading-tight tracking-tight tabular text-slate-900", valueClass)}>{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {delta !== undefined && <Delta value={delta} invert={invert} label={deltaLabel} />}
        {badge}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      {spark && spark.length > 1 && <div className="mt-2 -mb-1"><Sparkline values={spark} /></div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

/* ───────────── Panel / tushuntirish ───────────── */

export function Panel({ title, info, action, children, className, padded = true, eyebrow }: { title: React.ReactNode; info?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean; eyebrow?: string }) {
  return (
    <section className={cn("rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)", className)}>
      <div className={cn("flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-3", !padded && "")}>
        <div className="min-w-0">
          {eyebrow && <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">{eyebrow}</div>}
          <h2 className="flex items-center gap-1.5 text-[14.5px] font-semibold text-slate-900">{title}{info && <span title={info} className="inline-flex cursor-help text-slate-400"><Info size={13} /></span>}</h2>
        </div>
        {action && <div className="flex items-center gap-2 text-xs text-slate-500">{action}</div>}
      </div>
      <div className={cn(padded && "p-5")}>{children}</div>
    </section>
  );
}

export function Why({ children, label = "Nega?" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="group mt-3 rounded-lg border border-slate-200 bg-slate-50/60 text-[13px]">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 font-medium text-slate-700 hover:text-slate-900"><Sparkles size={13} className="text-brand-500" /> {label}<span className="ml-auto text-xs text-slate-400 group-open:hidden">ochish</span></summary>
      <div className="space-y-2 border-t border-slate-200 px-3 py-2.5 text-slate-600">{children}</div>
    </details>
  );
}

export function Insight({ children, title = "XULOSA", tone = "brand" }: { children: React.ReactNode; title?: string; tone?: "brand" | "danger" | "success" | "info" }) {
  const c = { brand: "border-brand-200 bg-brand-50/60 text-slate-800", danger: "border-red-200 bg-red-50/70 text-red-900", success: "border-emerald-200 bg-emerald-50/70 text-emerald-900", info: "border-blue-200 bg-blue-50/70 text-blue-900" }[tone];
  return <div className={cn("rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed", c)}><span className="mr-1.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider"><Sparkles size={12} /> {title}</span>{children}</div>;
}

export function Action({ children, href }: { children: React.ReactNode; href?: string }) {
  const inner = <span className="inline-flex items-start gap-1.5 text-[13px] font-medium text-slate-800"><Zap size={14} className="mt-0.5 shrink-0 text-brand-500" /><span>{children}</span></span>;
  return href ? <Link href={href} className="hover:underline">{inner}</Link> : inner;
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-slate-500">{children}</p>;
}

/* ───────────── Ballar / teglar ───────────── */

export function ScoreRing({ score, size = 120, label }: { score: number; size?: number; label?: string }) {
  const r = 44, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, score));
  const color = p >= 75 ? "#10b981" : p >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 100" style={{ width: size, height: size }}>
        <circle cx={50} cy={50} r={r} fill="none" className="stroke-slate-200" strokeWidth={8} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
        <text x={50} y={54} textAnchor="middle" fontSize={26} fontWeight={700} className="fill-slate-900">{Math.round(p)}</text>
        <text x={50} y={68} textAnchor="middle" fontSize={9} className="fill-slate-500">/ 100</text>
      </svg>
      {label && <div className="mt-1 text-sm font-semibold" style={{ color }}>{label}</div>}
    </div>
  );
}

export const kindColor: Record<string, BadgeColor> = { ANIQ: "green", TAXMIN: "amber", QISMAN: "slate", OQIM: "blue", ZAXIRA: "violet", High: "red", Medium: "amber", Low: "slate", A: "green", B: "blue", C: "slate", X: "green", Y: "amber", Z: "red", N: "slate", TOP: "green", YAXSHI: "blue", "O'RTA": "amber", PAST: "red", Kritik: "red", Yuqori: "red", "O'rta": "amber", Past: "blue", Xavfsiz: "green", Yaxshi: "green", Xavfli: "amber", "Ma'lumot yo'q": "slate" };
export function Tag({ children }: { children: string }) { return <Badge color={kindColor[children] ?? "slate"} dot={false}>{children}</Badge>; }

/* ───────────── Jadval yordamchilari ───────────── */

export function Pager({ total, page, size, href }: { total: number; page: number; size: number; href: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
      <span>{total ? `${(page - 1) * size + 1}–${Math.min(total, page * size)} / ${total}` : "0"}</span>
      <div className="flex items-center gap-1">
        {page > 1 ? <Link href={href(page - 1)} className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50">‹</Link> : <span className="rounded-md border border-slate-100 px-2 py-1 text-slate-300">‹</span>}
        <span className="px-1">{page} / {pages}</span>
        {page < pages ? <Link href={href(page + 1)} className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50">›</Link> : <span className="rounded-md border border-slate-100 px-2 py-1 text-slate-300">›</span>}
      </div>
    </div>
  );
}

export function ExportLink({ type, range, extra }: { type: string; range: Range; extra?: Record<string, string> }) {
  return <a href={`/bi-tahlil/export?${rangeQuery(range, { type, ...extra })}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"><Download size={12} /> Excel (CSV)</a>;
}

export function More({ href, children = "Batafsil" }: { href: string; children?: React.ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">{children} <ArrowRight size={12} /></Link>;
}

export function Chip({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return <Link href={href} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{children}</Link>;
}

export function ProgressBar({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "success" | "warning" | "danger" | "info" | "slate" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const c = { brand: "bg-brand-500", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500", info: "bg-blue-500", slate: "bg-slate-700" }[tone];
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", c)} style={{ width: `${pct}%` }} /></div>;
}
