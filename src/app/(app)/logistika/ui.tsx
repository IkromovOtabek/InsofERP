import Link from "next/link";
import { DateRangeBar } from "@/components/date-range-bar";
import { Badge } from "@/components/ui";
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

/** Davr: «Sanadan — Sanagacha» + tezkor tugmalar (umumiy `DateRangeBar`, `period=custom&from&to`). */
export function RangeForm({ base, from, to, hidden = {} }: { base: string; from: Date; to: Date; hidden?: Record<string, string> }) {
  const toIncl = new Date(to); toIncl.setDate(toIncl.getDate() - 1);
  return <DateRangeBar base={base} from={from} to={toIncl} names={{ from: "from", to: "to" }} keep={hidden} extra={{ period: "custom" }} yearStart />;
}

/** `plain` — reys sahifasi foydalanuvchiga yopiq (dispetcher): raqam havolasiz chiqadi. */
export function TripLink({ id, noteNo, plain }: { id: string; noteNo: string; plain?: boolean }) {
  if (plain) return <span className="font-medium tabular">{noteNo}</span>;
  return <Link href={`/trips/${id}`} className="font-medium tabular hover:underline">{noteNo}</Link>;
}

/** Hajm yozuvi: beton m³, dona mahsulot o'z birligida. */
export const unitShort = (u: string) => (u === "m3" ? "m³" : u);
