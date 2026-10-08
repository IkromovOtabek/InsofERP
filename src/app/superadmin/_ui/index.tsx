import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CircleCheck, CircleHelp, CircleX, Info } from "lucide-react";

/**
 * IT panel «Status Board» komponentlari (server va klientda ishlaydi — holatsiz).
 * Ko'rinish `_ui/panel.css` dagi `.sa-*` sinflarida; rang hech qachon yolg'iz ma'no tashimaydi — doim matn/ikon bilan.
 */

export type Tone = "ok" | "warn" | "crit" | "unk";
export type TagTone = "ok" | "warn" | "high" | "crit" | "info" | "run" | "mut";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** ERP Badge rangi → Status Board teg tusi (shared.ts dagi CHECK_STATUS/SEVERITY ranglari bilan ishlaydi). */
export const tagFromColor = (c: string): TagTone =>
  ({ green: "ok", amber: "warn", red: "crit", blue: "info", violet: "run", slate: "mut" } as Record<string, TagTone>)[c] ?? "mut";

export function Tag({ tone = "mut", children, className, title }: { tone?: TagTone; children: React.ReactNode; className?: string; title?: string }) {
  return <span className={cx("sa-tag", tone !== "mut" && tone, className)} title={title}>{children}</span>;
}

export function Dot({ tone, live, label }: { tone: Tone | "high"; live?: boolean; label?: string }) {
  return <span className={cx("sa-dot", tone !== "unk" && tone, live && "sa-live")} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

const TONE_ICON: Record<Tone, LucideIcon> = { ok: CircleCheck, warn: AlertTriangle, crit: CircleX, unk: CircleHelp };

/** Sahifa sarlavhasi — `@/components/ui` PageHeader bilan bir xil imzo (sahifalar faqat importni almashtiradi). */
export function PageHeader({ title, subtitle, eyebrow, action, back }: {
  title: React.ReactNode; subtitle?: React.ReactNode; eyebrow?: string; action?: React.ReactNode; back?: { href: string; label: string };
}) {
  return (
    <div className="sa-ph">
      <div className="min-w-0">
        {back && <Link href={back.href} className="back">← {back.label}</Link>}
        {eyebrow && !back && <div className="sa-sub" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em" }}>{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="acts">{action}</div>}
    </div>
  );
}

/** Kartochka bo'lim: sarlavha (ikon), o'ng tomonda izoh yoki «Hammasi →» havolasi. */
export function Section({ title, icon: Icon, sub, more, action, children, className, id }: {
  title: React.ReactNode; icon?: LucideIcon; sub?: React.ReactNode; more?: { href: string; label: string }; action?: React.ReactNode;
  children: React.ReactNode; className?: string; id?: string;
}) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section className={cx("sa-card", className)} aria-labelledby={hid}>
      <div className="sa-ch">
        <h2 id={hid}>{Icon && <Icon size={18} aria-hidden className="sa-ico" />}<span className="min-w-0 [overflow-wrap:anywhere]">{title}</span></h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {sub && <span className="sub">{sub}</span>}
          {action}
          {more && <Link href={more.href} className="sa-more">{more.label}</Link>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Svetofor plitkasi: holat yozuvi (OK/Ogohlantirish/Nosoz) + katta qiymat + izoh. */
export function StatusTile({ tone, label, icon: Icon, state, value, unit, sub, href }: {
  tone: Tone; label: string; icon: LucideIcon; state: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; href?: string;
}) {
  const body = (
    <>
      <div className="tk"><span>{label}</span><Icon size={22} strokeWidth={2.2} aria-hidden className="sa-ico" /></div>
      <div className="state">{state}</div>
      <div className="tv">{value}{unit && <small>{unit}</small>}</div>
      {sub && <div className="ts">{sub}</div>}
    </>
  );
  const cls = cx("sa-tile", tone);
  return href
    ? <Link href={href} className={cls} aria-label={`${label}: ${state}`}>{body}</Link>
    : <div className={cls} role="group" aria-label={`${label}: ${state}`}>{body}</div>;
}

/** Xizmat qatori (ro'yxat elementi): nuqta + nom + qiymat (kechikish yoki «Nosoz · sabab»). */
export function ServiceRow({ tone, name, value, href, title }: { tone: Tone; name: string; value: React.ReactNode; href: string; title?: string }) {
  const word = { ok: "ishlayapti", warn: "ogohlantirish", crit: "nosoz", unk: "noma'lum" }[tone];
  return (
    <li className={tone}>
      <Link href={href} title={title}>
        <Dot tone={tone} />
        <b data-no-translit>{name}</b>
        <span className="v">{value}</span>
        <span className="sa-sr">— {word}</span>
      </Link>
    </li>
  );
}

/** Banner — kritik yoki ochiq muammo; sahifa aylantirilsa ham tepada yopishib turadi. */
export function Banner({ tone, title, children, action }: { tone: Exclude<Tone, "ok">; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) {
  const I = tone === "unk" ? Info : TONE_ICON[tone];
  return (
    <div className={cx("sa-banner", tone)} role={tone === "crit" ? "alert" : "status"}>
      <div className="big"><I size={28} strokeWidth={2.2} aria-hidden className="sa-ico" />{title}</div>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
