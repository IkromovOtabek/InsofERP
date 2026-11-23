import { dateRu, isoDate } from "@/lib/format";
import { DateRangeBar } from "./date-range-bar";

/**
 * Sklad jadvallari (Kirim / Chiqim / Qoldiqlar) uchun davr: `?from=YYYY-MM-DD&to=YYYY-MM-DD` (ikkalasi ham kun ichida).
 * Standart — joriy oyning 1-kunidan bugungacha. Sana Toshkent mahalliy yarim tuni (`T00:00:00`) — StockMove.date
 * timestamp bo'lgani uchun `dayUtc` / `new Date("YYYY-MM-DD")` (UTC) ishlatilmaydi: kun chegarasi 05:00 ga siljirdi.
 * `to` — eksklyuziv (oxirgi kun ertasi 00:00), so'rovlarda `lt` bilan. Ko'pi bilan 400 kun — «Hammasi» (`from=ALL_FROM`) bundan mustasno.
 */
export type StockPeriod = { from: Date; to: Date; fromStr: string; toStr: string; label: string; /** «Hammasi» — butun tarix */ all: boolean };

/** «Hammasi» tugmasi: shu sanadan (tizimdagi eng eski hujjatdan ham oldin) — butun tarix. */
export const ALL_FROM = "2000-01-01";

const parse = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(new Date(`${s}T00:00:00`).getTime()) ? new Date(`${s}T00:00:00`) : null);

export function stockPeriod(sp: { from?: string; to?: string }): StockPeriod {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let from = parse(sp.from) ?? new Date(today.getFullYear(), today.getMonth(), 1);
  let toIncl = parse(sp.to) ?? today;
  if (toIncl < from) [from, toIncl] = [toIncl, from];
  const all = isoDate(from) === ALL_FROM;
  const maxFrom = new Date(toIncl); maxFrom.setDate(maxFrom.getDate() - 400);
  if (!all && from < maxFrom) from = maxFrom;
  const to = new Date(toIncl); to.setDate(to.getDate() + 1);
  return { from, to, fromStr: isoDate(from), toStr: isoDate(toIncl), label: all ? `Butun davr — ${dateRu(toIncl)} gacha` : `${dateRu(from)} — ${dateRu(toIncl)}`, all };
}

/** Tayyor davrlar + ixtiyoriy oraliq (GET forma). `hidden` — sahifaning boshqa parametrlari (tab, sklad…). Umumiy ko'rinish — `DateRangeBar`. */
export function StockPeriodBar({ base, period, hidden = {} }: { base: string; period: StockPeriod; hidden?: Record<string, string> }) {
  const toIncl = new Date(period.to); toIncl.setDate(toIncl.getDate() - 1);
  return <DateRangeBar base={base} from={period.from} to={toIncl} names={{ from: "from", to: "to" }} keep={hidden} allFrom={ALL_FROM} yearStart label={period.label} className="mb-0" />;
}
