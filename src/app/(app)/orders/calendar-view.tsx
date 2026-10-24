"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, Clock, FileSpreadsheet, X, Zap } from "lucide-react";
import { qty as q, fmtNum, money } from "@/lib/format";
import { cn } from "@/lib/utils";

/** m3 — beton hajmi (kunlik quvvat uchun); vol — zayavkaning to'liq hajmi birligi bilan. */
export type DayOrder = { id: string; orderNo: string; customer: string; time: string | null; m3: number; vol: string; sum: number; status: string; statusLabel: string; urgent: boolean };
export type DayCell = { key: string; label: string; weekday: string; list: DayOrder[]; m3: number; pct: number; count: number; urgent: number; state: "free" | "busy" | "full"; isToday: boolean };

/**
 * Kun kartasi: bandlik chizig'i kunlik quvvatga nisbatan. Joy ko'p — yashil, 70% dan — sariq,
 * 90% dan (to'lgan) — qizil. Chiziq, izoh nuqtasi va tepadagi foiz shu bitta jadvaldan rang oladi.
 */
const CANDLE_LEVELS = [
  { upto: 70, label: "bo'sh", bar: "bg-emerald-400", text: "text-emerald-600", dot: "bg-emerald-400" },
  { upto: 90, label: "70%+ band", bar: "bg-amber-400", text: "text-amber-600", dot: "bg-amber-400" },
  { upto: Infinity, label: "90%+ — to'lgan", bar: "bg-red-400", text: "text-red-600", dot: "bg-red-400" },
];

function candle(pct: number) {
  return CANDLE_LEVELS.find((l) => pct < l.upto) ?? CANDLE_LEVELS[CANDLE_LEVELS.length - 1];
}

/**
 * Taqvim ustunlari. Kun tanlanganda sahifa yangilanmaydi va tepaga ko'tarilmaydi —
 * o'sha kundagi zayavkalar shu yerning o'zida, taqvim ostida ochiladi (ma'lumot allaqachon serverdan kelgan).
 */
export function CalendarView({ cells, capacity }: { cells: DayCell[]; capacity: number }) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = cells.find((c) => c.key === openKey) ?? null;
  const busiest = cells.reduce((m, c) => (c.m3 > m.m3 ? c : m), cells[0]);

  return (
    <div className="mb-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card)">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold text-slate-900"><CalendarRange size={16} className="text-slate-400" /> Haftalik ish tartibi</h2>
          <p className="text-xs text-slate-500">Kunlik quvvat {fmtNum(capacity)} m³. Kunni bosing — zayavkalar shu yerda ochiladi; 2 marta bosing — kunlik realizatsiya varag&apos;i (Excel ko&apos;rinishi).</p>
        </div>
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))" }}>
        {cells.map((c, i) => {
          const active = openKey === c.key;
          const lvl = candle(c.pct);
          // Tooltip karta markaziga tayanadi; chetdagi ikki kartada kartadan tashqariga chiqmasin deb chetga tiraladi
          const tipAlign = i <= 1 ? "left-0 translate-x-0"
            : i >= cells.length - 2 ? "right-0 left-auto translate-x-0"
            : "left-1/2 -translate-x-1/2";
          return (
            <div key={c.key} className="group relative min-w-0">
              <button type="button" onClick={() => setOpenKey(active ? null : c.key)} onDoubleClick={() => router.push(`/orders/kun/${c.key}`)}
                title="2 marta bosing — kunlik realizatsiya varag'i"
                className={cn("flex w-full min-w-0 flex-col items-start gap-1.5 rounded-2xl border bg-white px-3.5 py-3 text-left transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-brand-500",
                  active ? "border-slate-900 ring-2 ring-slate-900" : "border-slate-200 hover:border-slate-300")}>
                <span className="flex w-full items-center justify-between gap-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                  {c.weekday}
                  {c.urgent > 0 && <span className="rounded bg-red-600 px-1 text-[9px] font-bold text-white normal-case" title={`${c.urgent} ta zarur zayavka`}>!</span>}
                </span>
                <span className={cn("text-xl leading-none font-bold tracking-tight text-slate-900", c.isToday && "underline decoration-brand-500 decoration-2 underline-offset-4")}>{c.label}</span>
                <span className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
                  <span className={cn("block h-full rounded-full transition-[width] duration-700", lvl.bar)} style={{ width: `${Math.max(c.count > 0 ? 6 : 0, c.pct)}%` }} />
                </span>
                <span className="text-[12px] tabular text-slate-500">{q(c.m3)} / {fmtNum(capacity)} m³</span>
              </button>

              {/* Sichqoncha olib borilganda — qisqa ro'yxat */}
              {!active && (
                <div className={cn("pointer-events-none absolute top-full z-40 mt-1 hidden w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-(--shadow-pop) md:group-hover:block", tipAlign)}>
                  <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
                    <span className="text-[13px] font-semibold text-slate-900">{c.isToday ? "Bugun" : `${c.weekday} · ${c.label}`}</span>
                    <span className={cn("text-[11px] font-medium", lvl.text)}>
                      {q(c.m3)} m³ · quvvatning {fmtNum(c.pct, 0)}%
                    </span>
                  </div>
                  {c.list.length === 0 ? (
                    <p className="text-xs text-slate-500">Bu kunga zayavka yo&apos;q — bemalol qabul qilsangiz bo&apos;ladi.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {c.list.slice(0, 7).map((o) => (
                        <li key={o.id} className="flex items-start justify-between gap-2 text-xs">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">{o.urgent && <Zap size={10} className="mr-0.5 inline text-red-600" />}{o.customer}</span>
                            <span className="block text-[11px] text-slate-500">{o.orderNo}{o.time && <><Clock size={9} className="mx-1 inline" />{o.time}</>} · {o.statusLabel}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-semibold tabular text-slate-800">{o.vol}</span>
                            <span className="block text-[11px] tabular text-slate-500">{money(o.sum)}</span>
                          </span>
                        </li>
                      ))}
                      {c.list.length > 7 && <li className="text-[11px] text-slate-500">…yana {c.list.length - 7} ta zayavka</li>}
                    </ul>
                  )}
                  <p className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-400">Bosing — ro&apos;yxat shu yerda; 2 marta bosing — realizatsiya varag&apos;i</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Tanlangan kun: sahifa yangilanmasdan shu yerda ochiladi */}
      {open && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">
              {`${open.weekday} · ${open.label}`} — {open.count} ta zayavka · {q(open.m3)} m³
              <span className={cn("ml-2 text-xs font-medium", candle(open.pct).text)}>
                quvvatning {fmtNum(open.pct, 0)}%
              </span>
            </span>
            <span className="flex items-center gap-3">
              <Link href={`/orders/kun/${open.key}`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline">
                <FileSpreadsheet size={13} /> Realizatsiya varag&apos;i
              </Link>
              <button type="button" onClick={() => setOpenKey(null)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
                <X size={13} /> Yopish
              </button>
            </span>
          </div>
          {open.list.length === 0 ? (
            <p className="text-sm text-slate-500">Bu kunga zayavka yo&apos;q — bemalol qabul qilsangiz bo&apos;ladi.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] tracking-wider text-slate-500 uppercase">
                    <th className="px-2 py-1.5">№</th><th className="px-2 py-1.5">Mijoz</th><th className="px-2 py-1.5">Soat</th>
                    <th className="px-2 py-1.5 text-right">Hajm</th><th className="px-2 py-1.5 text-right">Summa</th><th className="px-2 py-1.5">Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {open.list.map((o) => (
                    <tr key={o.id} className="border-t border-slate-200/70">
                      <td className="px-2 py-1.5"><Link href={`/orders/${o.id}`} className="font-medium text-slate-900 hover:underline">{o.orderNo}</Link></td>
                      <td className="px-2 py-1.5">{o.urgent && <Zap size={11} className="mr-1 inline text-red-600" />}{o.customer}</td>
                      <td className="px-2 py-1.5 text-slate-600">{o.time ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular whitespace-nowrap">{o.vol}</td>
                      <td className="px-2 py-1.5 text-right tabular whitespace-nowrap">{money(o.sum)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{o.statusLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {busiest.count > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Eng band kun: <b className="text-slate-700">{busiest.isToday ? "bugun" : busiest.label}</b> — {q(busiest.m3)} m³ ({fmtNum(busiest.pct, 0)}%).
          {cells.some((c) => c.state === "full") && " Qizil kunlarda quvvat to'lgan — yangi zayavka olishdan oldin ishlab chiqarish bilan kelishing."}
        </p>
      )}
    </div>
  );
}
