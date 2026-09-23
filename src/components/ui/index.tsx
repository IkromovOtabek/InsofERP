import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Inbox, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export { PasswordInput } from "./password-input";

/* ═══════════════════════ Layout ═══════════════════════ */

export function PageHeader({ title, subtitle, eyebrow, action, back }: {
  title: React.ReactNode; subtitle?: React.ReactNode; eyebrow?: string; action?: React.ReactNode; back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div className="min-w-0">
        {back && <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">← {back.label}</Link>}
        {eyebrow && !back && <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{eyebrow}</div>}
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function Card({ children, className, padded = true }: { children: React.ReactNode; className?: string; padded?: boolean }) {
  return <div className={cn("rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)", padded && "p-5", className)}>{children}</div>;
}

export function CardHeader({ title, description, action, icon: Icon }: { title: string; description?: string; action?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        {Icon && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon size={16} /></div>}
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mt-8", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ═══════════════════════ Stat ═══════════════════════ */

const tones = {
  default: { icon: "bg-slate-100 text-slate-600", value: "text-slate-900" },
  brand: { icon: "bg-brand-100 text-brand-700", value: "text-slate-900" },
  success: { icon: "bg-emerald-50 text-emerald-700", value: "text-emerald-700" },
  warning: { icon: "bg-amber-50 text-amber-700", value: "text-amber-700" },
  danger: { icon: "bg-red-50 text-red-700", value: "text-red-600" },
  info: { icon: "bg-blue-50 text-blue-700", value: "text-slate-900" },
};
export type Tone = keyof typeof tones;

export function StatCard({ label, value, hint, icon: Icon, tone = "default", href }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon; tone?: Tone; href?: string;
}) {
  const t = tones[tone];
  const body = (
    <div className={cn("flex items-start justify-between gap-3 rounded-(--radius-card) border bg-white p-4 shadow-(--shadow-card) transition", tone === "danger" ? "border-red-200" : "border-slate-200/80", href && "hover:border-slate-300 hover:shadow-md")}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-slate-500">{label}</div>
        <div className={cn("mt-1.5 break-words text-lg leading-tight font-semibold tracking-tight tabular sm:text-[22px]", t.value)}>{value}</div>
        {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      </div>
      {Icon && <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", t.icon)}><Icon size={19} /></div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/* ═══════════════════════ Buttons ═══════════════════════ */

const btnBase = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:pointer-events-none disabled:opacity-50";
const btnSize = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-11 px-5 text-[15px]" };
const btnVariant = {
  primary: "bg-slate-900 text-white shadow-sm hover:bg-slate-800 active:bg-slate-950",
  secondary: "border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50 hover:border-slate-300",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
  success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
  brand: "bg-brand-500 text-slate-950 shadow-sm hover:bg-brand-400",
};
type Variant = keyof typeof btnVariant;
type Size = keyof typeof btnSize;

export function Button({ variant = "primary", size = "md", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={cn(btnBase, btnSize[size], btnVariant[variant], className)} {...p} />;
}

export function LinkButton({ href, variant = "primary", size = "md", className, children }: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={cn(btnBase, btnSize[size], btnVariant[variant], className)}>{children}</Link>;
}

export function IconButton({ icon: Icon, label, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return <button aria-label={label} title={label} className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900", className)} {...p}><Icon size={16} /></button>;
}

/* ═══════════════════════ Form ═══════════════════════ */

export function Field({ label, children, hint, error, className }: { label: string; children: React.ReactNode; hint?: string; error?: string; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-xs transition placeholder:text-slate-400 hover:border-slate-300 focus:border-slate-400 focus:outline-none focus:ring-3 focus:ring-slate-900/8 disabled:bg-slate-50 disabled:text-slate-500 read-only:bg-slate-50";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputCls, className)} {...p} />;
}
export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputCls, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)} {...p} />;
}
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputCls, "h-auto min-h-20 py-2", className)} {...p} />;
}
export function Checkbox({ label, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700", className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-slate-900" {...p} /> {label}
    </label>
  );
}

export function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>;
}
export function FormSuccess({ text }: { text?: string }) {
  if (!text) return null;
  return <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">{text}</div>;
}

/** Forma ostidagi tugmalar qatori */
export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">{children}</div>;
}

/* ═══════════════════════ Badge ═══════════════════════ */

const badgeColors = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
const dotColors = { slate: "bg-slate-400", blue: "bg-blue-500", amber: "bg-amber-500", red: "bg-red-500", green: "bg-emerald-500", violet: "bg-violet-500" };
export type BadgeColor = keyof typeof badgeColors;

export function Badge({ color = "slate", children, dot = true }: { color?: BadgeColor; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", badgeColors[color])}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotColors[color])} />}
      {children}
    </span>
  );
}

/* ═══════════════════════ Tabs (URL-based) ═══════════════════════ */

export function Tabs({ items, current, className }: { items: { key: string; label: React.ReactNode; href: string; count?: number; icon?: LucideIcon }[]; current: string; className?: string }) {
  return (
    <div className={cn("mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200/80 bg-white p-1 shadow-(--shadow-card)", className)}>
      {items.map((t) => {
        const active = t.key === current;
        return (
          <Link key={t.key} href={t.href} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition", active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
            {t.icon && <t.icon size={14} />}
            {t.label}
            {t.count !== undefined && <span className={cn("rounded-full px-1.5 text-[11px] tabular", active ? "bg-white/20" : "bg-slate-100 text-slate-500")}>{t.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/* ═══════════════════════ Status steps ═══════════════════════ */

export function StatusSteps({ steps, current, failed }: { steps: { key: string; label: string }[]; current: string; failed?: boolean }) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex flex-wrap items-center gap-y-2">
      {steps.map((s, i) => {
        const done = i < idx, active = i === idx;
        return (
          <li key={s.key} className="flex items-center">
            <div className="flex items-center gap-2">
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ring-white",
                failed && active ? "bg-red-600 text-white" : done ? "bg-emerald-600 text-white" : active ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500")}>
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-[13px]", active ? "font-semibold text-slate-900" : done ? "text-slate-700" : "text-slate-400")}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className={cn("mx-3 h-px w-6 sm:w-10", i < idx ? "bg-emerald-500" : "bg-slate-200")} />}
          </li>
        );
      })}
    </ol>
  );
}

/* ═══════════════════════ Table ═══════════════════════ */

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return <th className={cn("sticky top-0 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 backdrop-blur", right && "text-right", className)}>{children}</th>;
}
export function Td({ children, right, className, colSpan }: { children?: React.ReactNode; right?: boolean; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn("border-t border-slate-100 px-4 py-3 text-slate-700 first:font-medium first:text-slate-900", right && "text-right tabular", className)}>{children}</td>;
}
export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn("transition-colors hover:bg-slate-50/70", className)}>{children}</tr>;
}
export function Empty({ text, icon: Icon = Inbox }: { text: string; icon?: LucideIcon }) {
  return (
    <tr><td colSpan={99} className="px-4 py-12 text-center">
      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon size={18} /></div>
      <div className="text-sm text-slate-500">{text}</div>
    </td></tr>
  );
}

/* ═══════════════════════ Misc ═══════════════════════ */

export function EmptyState({ icon: Icon = Inbox, title, text, action }: { icon?: LucideIcon; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-(--radius-card) border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon size={22} /></div>
      <div className="font-medium text-slate-900">{title}</div>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children: React.ReactNode }) {
  const c = { info: "border-blue-200 bg-blue-50 text-blue-900", warning: "border-amber-200 bg-amber-50 text-amber-900", danger: "border-red-200 bg-red-50 text-red-900", success: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return <div className={cn("mb-4 rounded-lg border px-4 py-3 text-sm", c)}>{title && <div className="mb-0.5 font-semibold">{title}</div>}{children}</div>;
}

/** Kalit–qiymat ro'yxati (detail sahifalar) */
export function DL({ items }: { items: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {items.map((i) => (
        <div key={i.k} className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-slate-500">{i.k}</dt>
          <dd className="min-w-0 flex-1 text-right font-medium text-slate-900 [overflow-wrap:anywhere]">{i.v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Progress({ value, max, tone = "default" }: { value: number; max: number; tone?: "default" | "success" | "warning" | "danger" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const bar = { default: "bg-slate-900", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500" }[tone];
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} /></div>;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[13px] font-semibold text-slate-950", className)}>{initials}</div>;
}
