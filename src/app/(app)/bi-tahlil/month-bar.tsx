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

/* ───────────── Kunlar oralig'i: tayyor davrlar + ikki sana ───────────── */

/** Tayyor davrlar (`davr`): bugun, kecha, oxirgi 7 / 21 / 30 kun, shu oy (sukut). */
export const DAY_PRESETS = [
  { key: "bugun", label: "Bugun" }, { key: "kecha", label: "Kecha" }, { key: "hafta", label: "1 hafta" },
  { key: "3hafta", label: "3 hafta" }, { key: "oy", label: "1 oy" }, { key: "shuoy", label: "Shu oy" },
] as const;
export type DayRange = { from: Date; to: Date; preset: string | null; label: string };

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const shift = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parseDay = (v?: string) => {
  const m = v && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

/**
 * URL: `davr` (tayyor davr) yoki `dan` + `gacha` (YYYY-MM-DD, ikkalasi ham kiradi). Eski `oy` (YYYY-MM) havolalari ham ishlaydi.
 * Natija: `to` — oraliq oxiri (kirmaydi), kelajak bugun bilan cheklanadi.
 */
export function parseDayRange(sp: { davr?: string; dan?: string; gacha?: string; oy?: string }): DayRange {
  const today = dayStart(new Date()), tomorrow = shift(today, 1);
  const dan = parseDay(sp.dan), gacha = parseDay(sp.gacha);
  if (dan || gacha) {
    let a = dan ?? gacha!, b = gacha ?? dan!;
    if (a > b) [a, b] = [b, a];
    if (a > today) a = today;
    const to = b >= today ? tomorrow : shift(b, 1);
    return { from: a, to, preset: null, label: isoKey(a) === isoKey(shift(to, -1)) ? dmy(a) : `${dmy(a)} — ${dmy(shift(to, -1))}` };
  }
  if (!sp.davr && isMonthKey(sp.oy)) {
    const a = new Date(Number(sp.oy.slice(0, 4)), Number(sp.oy.slice(5)) - 1, 1);
    const b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
    if (a <= today) return { from: a, to: b > tomorrow ? tomorrow : b, preset: null, label: monthTitle(sp.oy) };
  }
  const p = DAY_PRESETS.find((x) => x.key === sp.davr)?.key ?? "shuoy";
  const from = p === "bugun" ? today : p === "kecha" ? shift(today, -1) : p === "hafta" ? shift(today, -6) : p === "3hafta" ? shift(today, -20) : p === "oy" ? shift(today, -29) : new Date(today.getFullYear(), today.getMonth(), 1);
  const to = p === "kecha" ? today : tomorrow;
  const label = DAY_PRESETS.find((x) => x.key === p)!.label;
  return { from, to, preset: p, label: p === "bugun" || p === "kecha" ? `${label}, ${dmy(from)}` : `${label}: ${dmy(from)} — ${dmy(shift(to, -1))}` };
}
const isoKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DayRangeBar({ base, range, keep = {}, children }: { base: string; range: DayRange; keep?: Record<string, string | undefined>; children?: React.ReactNode }) {
  const today = isoKey(new Date());
  const q = (o: Record<string, string>) => `${base}?${new URLSearchParams(Object.entries({ ...keep, ...o }).filter((kv): kv is [string, string] => !!kv[1]))}`;
  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {DAY_PRESETS.map((p) => (
          <Link key={p.key} href={q({ davr: p.key })}
            className={`rounded-full border px-3 py-1 text-[13px] font-medium transition ${range.preset === p.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
            {p.label}
          </Link>
        ))}
      </div>
      <form method="get" action={base} className="flex flex-wrap items-center gap-2">
        {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
        <label className="flex items-center gap-1.5 text-xs text-slate-500">Dan
          <Input type="date" name="dan" defaultValue={isoKey(range.from)} max={today} className="h-9 w-40" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">Gacha
          <Input type="date" name="gacha" defaultValue={isoKey(shift(range.to, -1))} max={today} className="h-9 w-40" />
        </label>
        <Button size="sm">Ko&apos;rsatish</Button>
        <span className="text-[13px] font-medium text-slate-700">{range.label}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      </form>
    </div>
  );
}
