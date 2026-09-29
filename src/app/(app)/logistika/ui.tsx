import Link from "next/link";
import { Badge, Tabs } from "@/components/ui";
import { isoDate } from "@/lib/format";
import { minutesLabel, ORDER_LOGI, TRIP_PHASE, VEHICLE_LIVE, type Level, type OrderLogiStatus, type TripPhase, type VehicleLive } from "@/lib/logistics";

/** Logistika sahifalari uchun umumiy belgilar — rang va nom `lib/logistics.ts` dan. */

export function PhaseBadge({ phase }: { phase: TripPhase }) {
  const p = TRIP_PHASE[phase];
  return <Badge color={p.color}>{p.label}</Badge>;
}

export function OrderLogiBadge({ status, late, problem }: { status: OrderLogiStatus; late?: boolean; problem?: boolean }) {
  const s = ORDER_LOGI[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge color={s.color}>{s.label}</Badge>
      {late && <Badge color="red">Kechikmoqda</Badge>}
      {problem && <Badge color="red">Muammo mavjud</Badge>}
    </span>
  );
}

export function VehicleLiveBadge({ live, note }: { live: VehicleLive; note?: string | null }) {
  const v = VEHICLE_LIVE[live];
  return <span title={note ?? undefined}><Badge color={v.color}>{v.label}</Badge></span>;
}

const LEVEL_CLS: Record<Level, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", crit: "bg-red-500" };
export const LEVEL_TEXT: Record<Level, string> = { ok: "text-emerald-700", warn: "text-amber-700", crit: "text-red-700" };

export function LevelDot({ level, className = "" }: { level: Level; className?: string }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${LEVEL_CLS[level]} ${className}`} />;
}

/** Kechikish yozuvi: "+22 daq" (qizil/sariq) yoki "o'z vaqtida". */
export function DelayText({ min, level }: { min: number | null; level: Level }) {
  if (min == null) return <span className="text-slate-400">—</span>;
  if (min <= 0) return <span className="text-emerald-700">o'z vaqtida</span>;
  return <span className={`tabular font-medium ${level === "ok" ? "text-slate-600" : LEVEL_TEXT[level]}`}>+{minutesLabel(min)}</span>;
}

// ───────────────────────── Davr tanlash ─────────────────────────

export type Period = "day" | "week" | "month" | "custom";

/** `?period=day|week|month&from=&to=` → sana oralig'i. Standart — joriy oy. */
export function periodRange(sp: { period?: string; from?: string; to?: string }, fallback: Period = "month"): { period: Period; from: Date; to: Date; label: string } {
  const p = (["day", "week", "month", "custom"].includes(sp.period ?? "") ? sp.period : fallback) as Period;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const parse = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : null);
  if (p === "custom") {
    const from = parse(sp.from) ?? new Date(today.getFullYear(), today.getMonth(), 1);
    const toIncl = parse(sp.to) ?? today;
    const to = new Date(toIncl); to.setDate(to.getDate() + 1);
    return { period: p, from, to, label: `${isoDate(from)} — ${isoDate(toIncl)}` };
  }
  if (p === "day") { const to = new Date(today); to.setDate(to.getDate() + 1); return { period: p, from: today, to, label: "Bugun" }; }
  if (p === "week") {
    const from = new Date(today); from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); // dushanbadan
    const to = new Date(from); to.setDate(to.getDate() + 7);
    return { period: p, from, to, label: "Shu hafta" };
  }
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return { period: p, from, to, label: "Shu oy" };
}

export function PeriodTabs({ base, current, extra = "" }: { base: string; current: Period; extra?: string }) {
  const q = (p: string) => `${base}?period=${p}${extra ? `&${extra}` : ""}`;
  return (
    <Tabs current={current} items={[
      { key: "day", label: "Kunlik", href: q("day") },
      { key: "week", label: "Haftalik", href: q("week") },
      { key: "month", label: "Oylik", href: q("month") },
    ]} />
  );
}

/** Sana oralig'i formasi (GET) — "Kunlik/Haftalik/Oylik" dan tashqari ixtiyoriy davr. */
export function RangeForm({ base, from, to, hidden = {} }: { base: string; from: Date; to: Date; hidden?: Record<string, string> }) {
  const toIncl = new Date(to); toIncl.setDate(toIncl.getDate() - 1);
  return (
    <form action={base} className="mb-4 flex flex-wrap items-end gap-2 text-sm">
      <input type="hidden" name="period" value="custom" />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="text-xs text-slate-500">Dan<input type="date" name="from" defaultValue={isoDate(from)} className="mt-1 block h-9 rounded-lg border border-slate-200 px-2 text-sm" /></label>
      <label className="text-xs text-slate-500">Gacha<input type="date" name="to" defaultValue={isoDate(toIncl)} className="mt-1 block h-9 rounded-lg border border-slate-200 px-2 text-sm" /></label>
      <button className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50">Ko'rsatish</button>
    </form>
  );
}

export function TripLink({ id, noteNo }: { id: string; noteNo: string }) {
  return <Link href={`/trips/${id}`} className="font-medium tabular hover:underline">{noteNo}</Link>;
}

/** Hajm yozuvi: beton m³, dona mahsulot o'z birligida. */
export const unitShort = (u: string) => (u === "m3" ? "m³" : u);
