import { requireSession, type Session } from "@/lib/auth";
import { AccessDenied } from "@/lib/access-denied";
import { pathAllowed } from "@/lib/nav";
import { parseRange, type Range } from "@/lib/bi/core";
import { PageHeader } from "@/components/ui";
import { PeriodBar, routeOf } from "./ui";

export type SP = Record<string, string | undefined>;
export const BI_ROLES = ["DIRECTOR", "FINANCE", "ACCOUNTING"] as const;

/** Barcha BI sahifalari uchun umumiy tayyorgarlik: sessiya + davr. */
export async function biContext(searchParams: Promise<SP>): Promise<{ s: Session; sp: SP; range: Range }> {
  const s = await requireSession();
  // Rol emas, modul ruxsati (perms) hal qiladi: direktor «BI tahlil»ni ochib bergan xodim ham kiradi, «yo'q» qilingan rol kirmaydi
  if (!pathAllowed("/bi-tahlil", s.role, s.perms)) throw new AccessDenied();
  const sp = await searchParams;
  return { s, sp, range: parseRange(sp) };
}

/** Sahifa qobig'i: sarlavha + davr paneli. Bo'lim ichidagi sahifalar — sidebar'da (`lib/nav.ts` children), sahifada tab qatori yo'q. */
export function BiPage({ title, subtitle, eyebrow = "Tahlil", tab, range, keep, period = true, children }: {
  title?: string; subtitle?: string; eyebrow?: string; tab: string; range: Range; keep?: Record<string, string | undefined>; period?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      {title && <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />}
      {period && <PeriodBar range={range} tab={tab} keep={keep} />}
      {children}
    </div>
  );
}

export { routeOf };
