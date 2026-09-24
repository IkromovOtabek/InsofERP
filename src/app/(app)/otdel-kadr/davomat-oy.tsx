import Link from "next/link";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { ATTENDANCE_MARKS, hoursShort, hoursText, markOf, monthDays, monthTitle, shiftMonth, today } from "@/lib/davomat";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/generated/prisma";

export type OyCell = { status: AttendanceStatus; min: number | null; note: string | null };
export type OyRow = { id: string; fullName: string; position: string; cells: Record<string, OyCell> };

const monthHref = (ym: string) => `/otdel-kadr?tab=davomat&oy=${ym}`;
const dayHref = (iso: string) => `/otdel-kadr?tab=davomat&kun=${iso}`;

/**
 * Oylik tabel: qator — xodim, ustun — oy kunlari. Katakda ishlagan soat (yoki belgi harfi)
 * turadi, bosilsa o'sha kunning belgilash oynasi ochiladi. Faqat ko'rish uchun.
 */
export function DavomatOy({ ym, rows }: { ym: string; rows: OyRow[] }) {
  const days = monthDays(ym);
  const now = today();

  const totals = rows.map((r) => {
    const cells = Object.values(r.cells);
    return {
      days: cells.filter((c) => markOf(c.status).worked).length,
      absent: cells.filter((c) => c.status === "ABSENT").length,
      min: cells.reduce((n, c) => n + (c.min ?? 0), 0),
    };
  });
  const grand = {
    days: totals.reduce((n, t) => n + t.days, 0),
    absent: totals.reduce((n, t) => n + t.absent, 0),
    min: totals.reduce((n, t) => n + t.min, 0),
  };

  return (
    <div className="space-y-3">
      {/* ── Oy tanlash ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-slate-200/80 bg-white px-3 py-2.5 shadow-(--shadow-card)">
        <Link href={monthHref(shiftMonth(ym, -1))} aria-label="Oldingi oy" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronLeft size={16} /></Link>
        <span className="min-w-[130px] text-center text-sm font-semibold text-slate-900">{monthTitle(ym)}</span>
        <Link href={monthHref(shiftMonth(ym, 1))} aria-label="Keyingi oy" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronRight size={16} /></Link>
        <span className="ml-2 text-xs text-slate-500">
          Jami <span className="font-semibold text-slate-900 tabular">{grand.days}</span> ish kuni · <span className="font-semibold text-slate-900 tabular">{hoursText(grand.min)}</span>
          {grand.absent > 0 && <> · <span className="font-semibold text-red-600 tabular">{grand.absent}</span> kelmagan kun</>}
        </span>
        <Link href={dayHref(now.startsWith(ym) ? now : `${ym}-01`)} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <CalendarCheck size={14} /> Kunlik belgilash
        </Link>
      </div>

      <div className="overflow-x-auto rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50/95 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 backdrop-blur">Xodim</th>
              {days.map((d) => (
                <th key={d.iso} className={cn("w-9 border-b border-slate-200 px-0 py-2 text-center text-[11px] font-semibold tabular",
                  d.iso === now ? "bg-brand-500/15 text-slate-900" : d.weekend ? "bg-slate-100 text-slate-400" : "bg-slate-50/80 text-slate-500")}>
                  <Link href={dayHref(d.iso)} className="block hover:underline">{d.day}</Link>
                </th>
              ))}
              <th className="border-b border-l border-slate-200 bg-slate-50/80 px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Kun</th>
              <th className="border-b border-slate-200 bg-slate-50/80 px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Soat</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={days.length + 3} className="px-4 py-12 text-center text-sm text-slate-500">Bu oyda xodim yo&apos;q</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className="group">
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-1.5 text-left font-normal group-hover:bg-slate-50">
                  <Link href={`/employees/${r.id}`} className="block max-w-[220px] truncate text-[13px] font-medium text-slate-900 hover:underline">{r.fullName}</Link>
                  <span className="block max-w-[220px] truncate text-[11px] text-slate-400">{r.position}</span>
                </th>
                {days.map((d) => {
                  const c = r.cells[d.iso];
                  if (!c) {
                    return <td key={d.iso} className={cn("border-b border-slate-100 p-0.5 text-center", d.weekend && "bg-slate-50/70")}>
                      <Link href={dayHref(d.iso)} className="block h-7 rounded text-slate-200 hover:bg-slate-100">·</Link>
                    </td>;
                  }
                  const m = markOf(c.status);
                  return (
                    <td key={d.iso} className={cn("border-b border-slate-100 p-0.5 text-center", d.weekend && "bg-slate-50/70")}>
                      <Link
                        href={dayHref(d.iso)}
                        title={`${d.day}-kun · ${m.label}${c.min !== null ? ` · ${hoursText(c.min)}` : ""}${c.note ? ` · ${c.note}` : ""}`}
                        className={cn("flex h-7 items-center justify-center rounded text-[11px] font-semibold ring-1 ring-inset tabular", m.cell)}
                      >
                        {c.min !== null ? hoursShort(c.min) : m.short}
                      </Link>
                    </td>
                  );
                })}
                <td className="border-b border-l border-slate-100 px-2 text-right text-[13px] font-semibold text-slate-900 tabular">{totals[i].days}</td>
                <td className="border-b border-slate-100 px-2 text-right text-[13px] font-semibold text-slate-900 tabular">{totals[i].min ? hoursShort(totals[i].min) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Belgilar izohi ── */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs text-slate-500">Belgilar:</span>
        {ATTENDANCE_MARKS.map((m) => (
          <span key={m.value} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className={cn("flex h-5 w-5 items-center justify-center rounded text-[11px] font-semibold ring-1 ring-inset", m.cell)}>{m.short}</span>
            {m.label}
          </span>
        ))}
        <span className="text-xs text-slate-400">· ishga chiqqan kunda harf o&apos;rniga ishlagan soat turadi</span>
      </div>
    </div>
  );
}
