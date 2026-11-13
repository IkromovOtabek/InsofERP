import Link from "next/link";
import { ChevronRight, Search, X } from "lucide-react";
import type { Drill } from "@/lib/drill";
import { date, fmtNum } from "@/lib/format";
import { BackLink, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Bosiladigan son ko'rinishi (nuqtali tagchiziq) — raqam manbasiga olib boradigan havolalar uchun.
 *  `drill-link` — belgi: shu yo'l bilan ochilgan menyu sahifasida ham «Ortga» chiqadi (`ui/back-link.tsx`). */
export const DRILL_LINK = "drill-link underline decoration-slate-300 decoration-dotted underline-offset-4 hover:decoration-slate-500";

/**
 * Raqam manbasi paneli (drill-down): hisobotdagi son bosilganda o'ng tomondan ochiladi — son qaysi qatorlardan
 * (jami qatorlarda) va qaysi yozuvlardan (kassa, reys, vedomost, sklad…) yig'ilgani. Holat URL'da (`?drill=…`),
 * server chizadi: yopish — `closeHref`, tarkibdagi qatorga o'tish — `partHref(kalit)`.
 */
export function DrillPanel({ drill, closeHref, partHref }: { drill: Drill; closeHref: string; partHref?: (key: string) => string | null }) {
  const fmt = (v: number) => (drill.isQty ? fmtNum(v, 3) : fmtNum(v, 0));
  const shown = drill.items.reduce((s, i) => s + i.amount, 0);
  return (
    <div className="fixed inset-0 z-50 print:hidden" role="dialog" aria-modal="true" aria-label={`${drill.title} — manbasi`}>
      <Link href={closeHref} scroll={false} aria-label="Yopish" className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <aside className="absolute inset-y-0 right-0 flex w-[min(46rem,100vw)] flex-col bg-white shadow-(--shadow-pop) animate-fade-up">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            {/* Ortga — oldingi qadam: ichki qatordan ota qatorga, birinchi qadamda hisobotga (tarix bo'lmasa — yopiladi) */}
            <BackLink href={closeHref} scroll={false} className="mb-3" />
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400"><Search size={13} /> Raqam manbasi · {drill.period}</div>
            <h2 className="mt-1 text-[17px] font-bold leading-snug text-slate-900">{drill.title}</h2>
            <div className={cn("mt-1 text-2xl font-semibold tabular", drill.value < 0 ? "text-red-600" : "text-slate-900")}>{fmt(drill.value)}{!drill.isQty && <span className="ml-1 text-base font-normal text-slate-400">so&apos;m</span>}</div>
          </div>
          <Link href={closeHref} scroll={false} aria-label="Yopish" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={20} /></Link>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {drill.note && <p className="text-[13px] text-slate-500">{drill.note}</p>}

          {drill.parts.length > 0 && (
            <div>
              <div className="mb-2 text-[13px] font-semibold text-slate-700">Tarkibi</div>
              <Table>
                <thead><tr><Th>Qator</Th><Th right>Summa</Th></tr></thead>
                <tbody>
                  {drill.parts.map((p) => {
                    const href = partHref?.(p.key);
                    return (
                      <Tr key={p.key}>
                        <Td>{href ? <Link href={href} scroll={false} className="inline-flex items-center gap-1 font-medium text-slate-900 hover:underline">{p.label} <ChevronRight size={14} className="text-slate-400" /></Link> : p.label}</Td>
                        <Td right className={cn("whitespace-nowrap font-semibold", p.value < 0 && "text-red-600")}>{p.value === 0 ? "–" : fmt(p.value)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}

          {(drill.items.length > 0 || drill.parts.length === 0) && (
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2 text-[13px]">
                <span className="font-semibold text-slate-700">Yozuvlar · {drill.items.length} ta</span>
                {drill.items.length > 0 && <span className="tabular text-slate-500">jami {fmt(shown)}</span>}
              </div>
              <Table>
                {/* Telefonda sana ustuni yo'q — manba ostida yoziladi (summa ustuni sig'sin) */}
                <thead><tr><Th className="hidden w-24 sm:table-cell">Sana</Th><Th>Manba</Th><Th right>Summa</Th></tr></thead>
                <tbody>
                  {drill.items.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">Bu katakka yozuv tushmagan.</td></tr>}
                  {drill.items.map((it, k) => (
                    <Tr key={k}>
                      <Td className="hidden whitespace-nowrap text-slate-500 sm:table-cell">{it.date ? date(it.date) : "—"}</Td>
                      <Td>
                        {it.href ? <Link href={it.href} className="drill-link font-medium text-slate-900 hover:underline">{it.title}</Link> : <span className="font-medium text-slate-900">{it.title}</span>}
                        <div className="text-[12px] text-slate-500">{it.date && <span className="sm:hidden">{date(it.date)}{it.sub ? " · " : ""}</span>}{it.sub}</div>
                      </Td>
                      <Td right className={cn("whitespace-nowrap font-semibold", it.amount < 0 && "text-red-600")}>{fmt(it.amount)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
