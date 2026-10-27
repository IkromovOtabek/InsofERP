import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MONTHS_UZ } from "@/lib/bi/plans";
import { type MonthKey, addMonths, isMonthKey, monthKeyOf } from "@/lib/fin-report/period";
import { Button, Input } from "@/components/ui";

/**
 * Oy tanlash paneli — «Insof 2026» oylik varaqlari (Avtotransport, Xom-ashyo balansi, Tayyor mahsulot, Ish haqi vedomosti).
 * URL: `oy` (YYYY-MM, sukut — joriy oy, kelajak — joriy oyga tushadi); `keep` — sahifaning boshqa parametrlari.
 */
export function parseMonth(v?: string): MonthKey {
  const now = monthKeyOf(new Date());
  return isMonthKey(v) && v <= now ? v : now;
}
export const monthTitle = (m: MonthKey) => `${MONTHS_UZ[Number(m.slice(5)) - 1]} ${m.slice(0, 4)} y.`;

export function MonthBar({ base, month, keep = {}, children }: { base: string; month: MonthKey; keep?: Record<string, string | undefined>; children?: React.ReactNode }) {
  const now = monthKeyOf(new Date());
  const q = (m: MonthKey) => `${base}?${new URLSearchParams(Object.entries({ ...keep, oy: m }).filter((kv): kv is [string, string] => !!kv[1]))}`;
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-center gap-2">
      {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <div className="flex items-center gap-1">
        <Link href={q(addMonths(month, -1))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Oldingi oy"><ChevronLeft size={16} /></Link>
        <Input type="month" name="oy" defaultValue={month} max={now} className="h-9 w-40" aria-label="Oy" />
        {month < now && <Link href={q(addMonths(month, 1))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Keyingi oy"><ChevronRight size={16} /></Link>}
      </div>
      <Button size="sm">Ko&apos;rsatish</Button>
      {month !== now && <Link href={q(now)} className="text-[13px] font-medium text-slate-600 underline">Joriy oy</Link>}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </form>
  );
}
