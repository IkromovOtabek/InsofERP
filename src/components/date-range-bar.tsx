import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────────────────── Hisobot davri: «Sanadan — Sanagacha» + tezkor tugmalar (barcha hisobotlarda bir xil) ─────────────────────────
 *
 * Sahifalar URL parametrlari turlicha (`dan/gacha`, `from/to`) — `names` bilan beriladi, sahifa mantig'i o'zgarmaydi.
 * Tezkor tugmalar aniq sanalar juftini yozadi (Bugun, Kecha, Shu hafta, Shu oy, O'tgan oy; ixtiyoriy — Yil boshidan, Hammasi).
 * `data-excel-period` — «Excel» tugmasi fayl nomiga va oynaga shu davrni yozadi.
 * Server komponent: JS'siz ishlaydi (havola + GET forma).
 */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dmy = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

/** Ekranda va Excel fayl nomida: «01.11.2026 — 23.11.2026» yoki bitta kun. */
export const rangeText = (from: Date, toIncl: Date) => (iso(from) === iso(toIncl) ? dmy(from) : `${dmy(from)} — ${dmy(toIncl)}`);

export function DateRangeBar({
  base, from, to, names = { from: "dan", to: "gacha" }, keep = {}, extra = {}, allFrom, yearStart, label, children, className,
}: {
  /** Sahifa yo'li (masalan "/cashflow") */
  base: string;
  from: Date;
  /** Oraliq oxiri — KIRADI (shu kun ham hisobga olinadi) */
  to: Date;
  /** URL parametr nomlari: standart `dan` / `gacha` */
  names?: { from: string; to: string };
  /** Saqlanadigan boshqa parametrlar (tab, hisob, filtr) */
  keep?: Record<string, string | undefined | null>;
  /** Davr tanlanganda qo'shiladigan parametrlar (masalan `period: "custom"`) */
  extra?: Record<string, string>;
  /** «Hammasi» tugmasi: shu sanadan boshlab (butun tarix) */
  allFrom?: string;
  /** «Yil boshidan» tugmasi */
  yearStart?: boolean;
  /** Davr yozuvi (standart — sanalar) */
  label?: string;
  /** O'ng tomondagi qo'shimcha (Excel, filtrlar) */
  children?: React.ReactNode;
  className?: string;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = (y: number, m: number, d: number) => new Date(y, m, d);
  const y = today.getFullYear(), m = today.getMonth();
  const weekStart = day(y, m, today.getDate() - ((today.getDay() + 6) % 7)); // dushanbadan
  const presets: [string, Date, Date][] = [
    ["Bugun", today, today],
    ["Kecha", day(y, m, today.getDate() - 1), day(y, m, today.getDate() - 1)],
    ["Shu hafta", weekStart, today],
    ["Shu oy", day(y, m, 1), today],
    ["O'tgan oy", day(y, m - 1, 1), day(y, m, 0)],
  ];
  if (yearStart) presets.push(["Yil boshidan", day(y, 0, 1), today]);
  if (allFrom) presets.push(["Hammasi", new Date(`${allFrom}T00:00:00`), today]);

  const kept = Object.entries(keep).filter((kv): kv is [string, string] => !!kv[1]);
  const href = (a: Date, b: Date) => `${base}?${new URLSearchParams([...kept, ...Object.entries(extra), [names.from, iso(a)], [names.to, iso(b)]])}`;
  const f = iso(from), t = iso(to);
  const text = label ?? rangeText(from, to);

  return (
    <div data-excel-period={rangeText(from, to)} className={cn("mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-(--radius-card) border border-slate-200/80 bg-white px-3 py-2.5 text-sm shadow-(--shadow-card)", className)}>
      {/* key — tezkor tugma bosilganda maydonlar yangi sanani ko'rsatsin (defaultValue faqat birinchi chizishda o'qiladi) */}
      <form key={`${f}_${t}`} action={base} method="get" className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900"><CalendarDays size={16} className="text-slate-500" /> Davr</span>
        {kept.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {Object.entries(extra).map(([k, v]) => <input key={`x-${k}`} type="hidden" name={k} value={v} />)}
        <label className="flex items-center gap-1.5 text-xs text-slate-500">Sanadan
          <input type="date" name={names.from} defaultValue={f} max={iso(today)} aria-label="Sanadan" className="h-9 w-40 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">Sanagacha
          <input type="date" name={names.to} defaultValue={t} aria-label="Sanagacha" className="h-9 w-40 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900" />
        </label>
        <button className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Ko&apos;rsatish</button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(([l, a, b]) => {
          const on = iso(a) === f && iso(b) === t;
          return (
            <Link key={l} href={href(a, b)} prefetch={false} aria-current={on ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-100")}>{l}</Link>
          );
        })}
      </div>
      <span className="text-[13px] font-medium text-slate-700">{text}</span>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Oylik hisobotlar (PNL, vedomost...) uchun: Excel davri — tanlangan oy. Sahifaning oy tanlagichi yonida turadi. */
export function ExcelPeriodMark({ text }: { text: string }) {
  return <span hidden data-excel-period={text} />;
}
