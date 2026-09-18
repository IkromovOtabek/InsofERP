import type { LucideIcon } from "lucide-react";
import { requireSession, type Session } from "@/lib/auth";
import { parseRange, type Range } from "@/lib/bi/core";
import { PageHeader, Tabs } from "@/components/ui";
import { PeriodBar, routeOf } from "./ui";

export type SP = Record<string, string | undefined>;
export const BI_ROLES = ["DIRECTOR", "FINANCE", "ACCOUNTING"] as const;

/** Barcha BI sahifalari uchun umumiy tayyorgarlik: sessiya + davr. */
export async function biContext(searchParams: Promise<SP>): Promise<{ s: Session; sp: SP; range: Range }> {
  const s = await requireSession([...BI_ROLES]);
  const sp = await searchParams;
  return { s, sp, range: parseRange(sp) };
}

/** Sahifa qobig'i: sarlavha + davr paneli + (ixtiyoriy) ichki tablar. */
export function BiPage({ title, subtitle, eyebrow = "Tahlil", tab, range, keep, period = true, subtabs, current, children }: {
  title: string; subtitle?: string; eyebrow?: string; tab: string; range: Range; keep?: Record<string, string | undefined>; period?: boolean;
  subtabs?: { key: string; label: string; href: string; icon?: LucideIcon }[]; current?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      {period && <PeriodBar range={range} tab={tab} keep={keep} />}
      {subtabs && <Tabs current={current ?? subtabs[0].key} className="mb-6" items={subtabs} />}
      {children}
    </div>
  );
}

export { routeOf };
