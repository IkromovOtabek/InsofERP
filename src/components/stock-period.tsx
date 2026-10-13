import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { dateRu, isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sklad jadvallari (Приход / Расход / Остатки) uchun davr: `?from=YYYY-MM-DD&to=YYYY-MM-DD` (ikkalasi ham kun ichida).
 * Standart — joriy oyning 1-kunidan bugungacha. Sana Toshkent mahalliy yarim tuni (`T00:00:00`) — StockMove.date
 * timestamp bo'lgani uchun `dayUtc` / `new Date("YYYY-MM-DD")` (UTC) ishlatilmaydi: kun chegarasi 05:00 ga siljirdi.
 * `to` — eksklyuziv (oxirgi kun ertasi 00:00), so'rovlarda `lt` bilan. Ko'pi bilan 400 kun.
 */
export type StockPeriod = { from: Date; to: Date; fromStr: string; toStr: string; label: string };

const parse = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(new Date(`${s}T00:00:00`).getTime()) ? new Date(`${s}T00:00:00`) : null);

export function stockPeriod(sp: { from?: string; to?: string }): StockPeriod {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let from = parse(sp.from) ?? new Date(today.getFullYear(), today.getMonth(), 1);
  let toIncl = parse(sp.to) ?? today;
  if (toIncl < from) [from, toIncl] = [toIncl, from];
  const maxFrom = new Date(toIncl); maxFrom.setDate(maxFrom.getDate() - 400);
  if (from < maxFrom) from = maxFrom;
  const to = new Date(toIncl); to.setDate(to.getDate() + 1);
  return { from, to, fromStr: isoDate(from), toStr: isoDate(toIncl), label: `${dateRu(from)} — ${dateRu(toIncl)}` };
}

/** Tayyor davrlar + ixtiyoriy oraliq (GET forma). `hidden` — sahifaning boshqa parametrlari (tab, sklad…). */
export function StockPeriodBar({ base, period, hidden = {} }: { base: string; period: StockPeriod; hidden?: Record<string, string> }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const qs = (from: Date, to: Date) => {
    const p = new URLSearchParams({ ...hidden, from: isoDate(from), to: isoDate(to) });
    return `${base}?${p.toString()}`;
  };
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const presets: [string, Date, Date][] = [
    ["Сегодня", today, today],
    ["Неделя", weekStart, today],
    ["Этот месяц", monthStart, today],
    ["Прошлый месяц", prevStart, prevEnd],
    ["С начала года", yearStart, today],
  ];
  return (
    <div lang="ru" className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1">
        {presets.map(([label, f, t]) => {
          const active = isoDate(f) === period.fromStr && isoDate(t) === period.toStr;
          return (
            <Link key={label} href={qs(f, t)} prefetch={false}
              className={cn("inline-flex h-9 items-center rounded-lg border px-3 text-sm transition", active ? "border-slate-900 bg-slate-900 font-semibold text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900")}>
              {label}
            </Link>
          );
        })}
      </div>
      <form action={base} className="flex flex-wrap items-end gap-2">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="text-xs text-slate-500">с<input type="date" name="from" defaultValue={period.fromStr} className="mt-0.5 block h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900" /></label>
        <label className="text-xs text-slate-500">по<input type="date" name="to" defaultValue={period.toStr} className="mt-0.5 block h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900" /></label>
        <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><CalendarDays size={15} /> Показать</button>
      </form>
    </div>
  );
}
