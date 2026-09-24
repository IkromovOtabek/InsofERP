"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarRange, Clock, X, Zap } from "lucide-react";
import { qty as q, fmtNum, money } from "@/lib/format";
import { cn } from "@/lib/utils";

/** m3 — beton hajmi (kunlik quvvat uchun); vol — zayavkaning to'liq hajmi birligi bilan. */
export type DayOrder = { id: string; orderNo: string; customer: string; time: string | null; m3: number; vol: string; sum: number; status: string; statusLabel: string; urgent: boolean };
export type DayCell = { key: string; label: string; weekday: string; list: DayOrder[]; m3: number; pct: number; count: number; urgent: number; state: "free" | "busy" | "full"; isToday: boolean };

/**
 * Taqvim ustunlari. Kun tanlanganda sahifa yangilanmaydi va tepaga ko'tarilmaydi —
 * o'sha kundagi zayavkalar shu yerning o'zida, taqvim ostida ochiladi (ma'lumot allaqachon serverdan kelgan).
 */
export function CalendarView({ cells, capacity }: { cells: DayCell[]; capacity: number }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = cells.find((c) => c.key === openKey) ?? null;
  const busiest = cells.reduce((m, c) => (c.m3 > m.m3 ? c : m), cells[0]);

  return (
    <div className="mb-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card)">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold text-slate-900"><CalendarRange size={16} className="text-slate-400" /> 10 kunlik ish tartibi</h2>
          <p className="text-xs text-slate-500">Kunlik quvvat {fmtNum(capacity)} m³ · ustun to&apos;lgani — shu kunga olingan hajm. Kunni bosing — zayavkalar shu yerda ochiladi (sahifa yangilanmaydi).</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Bo&apos;sh — zayavka yo&apos;q</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Zayavka bor</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-red-500" /> Joy yo&apos;q</span>
        </div>
      </div>

      <div className="flex items-end justify-center gap-1.5">
        {cells.map((c, i) => {
          const active = openKey === c.key;
          // Tooltip ustun markaziga tayanadi. Chetdagi ikki ustunda markazlash uni
          // kartadan tashqariga — chapda yon menyu ustiga, o'ngda ekrandan tashqariga —
          // chiqarib yuboradi, shuning uchun u o'z ustunining chetiga tiraladi.
          const tipAlign = i <= 1 ? "left-0 translate-x-0"
            : i >= cells.length - 2 ? "right-0 left-auto translate-x-0"
            : "left-1/2 -translate-x-1/2";
          return (
            <div key={c.key} className="group relative flex-1 basis-0">
              <button type="button" onClick={() => setOpenKey(active ? null : c.key)}
                className={cn("flex w-full flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 transition", active ? "bg-slate-900/5 ring-2 ring-slate-900" : "hover:bg-slate-50")}>
                <span className={cn("text-[10.5px] font-medium", c.isToday ? "text-slate-900" : "text-slate-400")}>{c.weekday}</span>
                {/* Ustun: cho'zinchoq va tor — pastdan to'ladi, rang yashildan qizilga ko'tariladi */}
                <div className={cn("relative flex h-40 w-full max-w-[46px] items-end overflow-hidden rounded-lg border-2 bg-slate-50",
                  c.state === "full" ? "border-red-300" : c.state === "busy" ? "border-amber-300" : "border-emerald-300")}>
                  <div className="w-full transition-[height] duration-700"
                    style={{ height: `${Math.max(c.count > 0 ? 8 : 0, c.pct)}%`, background: "linear-gradient(to top, #00cb80 0%, #9ee610 40%, #ffa800 75%, #fa1636 100%)" }} />
                  <span className="absolute inset-x-0 top-1.5 px-0.5 text-center text-[10px] leading-tight font-semibold text-slate-700">
                    {c.count > 0 ? <>{q(c.m3)}<br />m³</> : "bo'sh"}
                  </span>
                  {c.urgent > 0 && <span className="absolute top-0.5 right-0.5 rounded bg-red-600 px-1 text-[8px] font-bold text-white">!</span>}
                </div>
                <span className={cn("text-[10.5px] tabular", c.isToday ? "font-semibold text-slate-900" : "text-slate-500")}>{c.label}</span>
                <span className={cn("rounded-full px-1.5 text-[10px] font-medium tabular",
                  c.state === "full" ? "bg-red-100 text-red-700" : c.state === "busy" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700")}>
                  {c.count} ta
                </span>
              </button>

              {/* Sichqoncha olib borilganda — qisqa ro'yxat */}
              {!active && (
                <div className={cn("pointer-events-none absolute top-full z-40 mt-1 hidden w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-(--shadow-pop) md:group-hover:block", tipAlign)}>
                  <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
                    <span className="text-[13px] font-semibold text-slate-900">{c.isToday ? "Bugun" : `${c.weekday} · ${c.label}`}</span>
                    <span className={cn("text-[11px] font-medium", c.state === "full" ? "text-red-600" : c.state === "busy" ? "text-amber-700" : "text-emerald-700")}>
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
                  <p className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-400">Bosing — to&apos;liq ro&apos;yxat shu yerda ochiladi</p>
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
              {open.isToday ? "Bugun" : `${open.weekday} · ${open.label}`} — {open.count} ta zayavka · {q(open.m3)} m³
              <span className={cn("ml-2 text-xs font-medium", open.state === "full" ? "text-red-600" : open.state === "busy" ? "text-amber-700" : "text-emerald-700")}>
                quvvatning {fmtNum(open.pct, 0)}%
              </span>
            </span>
            <button type="button" onClick={() => setOpenKey(null)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
              <X size={13} /> Yopish
            </button>
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
          {cells.some((c) => c.state === "full") && " Qizil kunlarga yangi zayavka olishdan oldin ishlab chiqarish bilan kelishing."}
        </p>
      )}
    </div>
  );
}
