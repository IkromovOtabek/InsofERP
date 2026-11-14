"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Clock, Loader2, Package, UserRound, Warehouse, X } from "lucide-react";
import { Badge, FormError } from "@/components/ui";
import { cn } from "@/lib/utils";
import { dateRu, dateTime, qty } from "@/lib/format";
import { isAccessDenied } from "@/lib/access-denied";
import type { YardDir, YardMoves } from "@/lib/yard-moves";

/** Oynani ochish uchun so'rov: qaysi mahsulot, qaysi ombor (brigada id / "" umumiy / "*" butun sklad), yo'nalish, davr */
export type YardMovesQuery = { productId: string; owner: string; dir: YardDir; from?: string; to?: string };
type Load = (q: YardMovesQuery) => Promise<{ data?: YardMoves; error?: string }>;

const DIR_TITLE: Record<YardDir, string> = { in: "Kirim", out: "Chiqim", all: "Harakatlar" };
const DENIED = "Bu ma'lumotni ko'rishga ruxsatingiz yo'q — direktordan ruxsat so'rang";

/**
 * Hovli katagi (yoki zayavkadagi brigada ombori) bosilganda — kassa/bank tafsilot oynasi uslubida: har harakat qaysi kunga
 * yozilgani, kim kiritgani va soat nechada, hujjati (reys, topshiriq, qo'lda kirim, ko'chirish). Ma'lumot oyna ochilganda
 * serverdan o'qiladi (`lib/yard-moves.ts`) — sahifaga oldindan yuborilmaydi.
 */
export function YardMovesDialog({ query, load, onClose, periodLabel }: { query: YardMovesQuery; load: Load; onClose: () => void; periodLabel?: string | null }) {
  const [data, setData] = useState<YardMoves | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    load(query)
      .then((r) => { if (!alive) return; if (r.data) setData(r.data); else setError(r.error ?? "Ma'lumot o'qilmadi"); })
      .catch((e) => { if (alive) setError(isAccessDenied(e) ? DENIED : "Ma'lumot o'qilmadi — sahifani yangilab qayta urining"); });
    return () => { alive = false; };
  }, [load, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const unit = data?.product.unit ?? "";
  const title = data ? `${data.product.name} — ${data.ownerName}` : DIR_TITLE[query.dir];

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-5xl space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              <Badge color={query.dir === "in" ? "green" : query.dir === "out" ? "red" : "slate"} dot={false}>{DIR_TITLE[query.dir]}</Badge>
            </div>
            {periodLabel && <p className="mt-0.5 text-xs text-slate-500">{periodLabel}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>

        {!data && !error && <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Yuklanmoqda…</div>}
        {error && <FormError error={error} />}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {query.dir !== "out" && <Stat icon={ArrowDownToLine} k="Kirim" v={`${data.sumIn > 0 ? "+" : ""}${qty(data.sumIn)} ${unit}`} tone={data.sumIn > 0 ? "text-emerald-700" : "text-slate-900"} />}
              {query.dir !== "in" && <Stat icon={ArrowUpFromLine} k="Chiqim" v={`${data.sumOut > 0 ? "−" : ""}${qty(data.sumOut)} ${unit}`} tone={data.sumOut > 0 ? "text-red-600" : "text-slate-900"} />}
              <Stat icon={Package} k="Yozuvlar" v={`${data.count} ta`} tone="text-slate-900" />
              <Stat icon={Warehouse} k="Hozirgi qoldiq" v={`${qty(data.balance)} ${unit}`} tone={data.balance < 0 ? "text-red-600" : "text-slate-900"} />
            </div>

            {data.rows.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">Bu davrda harakat yo&apos;q</p>
            ) : (
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[760px] border-collapse text-[13px]">
                  <thead className="sticky top-0 z-[1] bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Sana</th>
                      <th className="px-3 py-2 font-medium">Amal</th>
                      <th className="px-3 py-2 text-right font-medium">Miqdor</th>
                      {query.owner === "*" && <th className="px-3 py-2 font-medium">Ombor</th>}
                      <th className="px-3 py-2 font-medium">Hujjat</th>
                      <th className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-1"><UserRound size={13} /> Kim kiritdi</span></th>
                      <th className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-1"><Clock size={13} /> Kiritilgan vaqt</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} className={cn("border-t border-slate-100 align-top", r.storno && "text-slate-400")}>
                        <td className="px-3 py-2 whitespace-nowrap tabular">{dateRu(new Date(r.date))}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{r.kind}{r.storno && <span className="ml-1.5 align-middle"><Badge dot={false}>bekor qilish</Badge></span>}</div>
                          {r.note && <div className="mt-0.5 max-w-80 text-xs text-slate-500 [overflow-wrap:anywhere]">{r.note}</div>}
                        </td>
                        <td className={cn("px-3 py-2 text-right font-semibold whitespace-nowrap tabular", r.qty > 0 ? "text-emerald-700" : "text-red-600")}>{r.qty > 0 ? "+" : "−"}{qty(Math.abs(r.qty))} <span className="font-normal text-slate-400">{unit}</span></td>
                        {query.owner === "*" && <td className="px-3 py-2 text-slate-600">{r.owner}</td>}
                        <td className="px-3 py-2 text-slate-600">
                          {r.doc ? (r.doc.href ? <Link href={r.doc.href} className="hover:underline">{r.doc.label}</Link> : r.doc.label) : "—"}
                          {r.warehouse && <div className="text-[11px] text-slate-400">{r.warehouse}</div>}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900">{r.who ?? "noma'lum"}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-600 tabular">{dateTime(new Date(r.createdAt))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.count > data.rows.length && <p className="text-xs text-slate-500">Oxirgi {data.rows.length} ta yozuv ko&apos;rsatildi (jami {data.count} ta) — davrni qisqartiring.</p>}
            <div className="flex justify-end border-t border-slate-100 pt-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Yopish</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}

function Stat({ icon: Icon, k, v, tone }: { icon: React.ComponentType<{ size?: number; className?: string }>; k: string; v: string; tone: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500"><Icon size={13} className="text-slate-400" /> {k}</div>
      <div className={cn("mt-0.5 text-lg font-bold tabular", tone)}>{v}</div>
    </div>
  );
}

/**
 * Jadvaldagi kataklar uchun bitta umumiy oyna: katak ichidagi `<button data-ym-p="<mahsulot>" data-ym-o="<ombor>" data-ym-d="in|out|all">`
 * bosilganda (hodisa delegatsiyasi) shu oyna ochiladi. Har katak alohida klient komponent emas — katta jadval yengil qoladi.
 */
export function YardMovesHost({ children, load, from, to, periodLabel }: { children: React.ReactNode; load: Load; from?: string; to?: string; periodLabel?: string | null }) {
  const [q, setQ] = useState<YardMovesQuery | null>(null);
  const close = useCallback(() => setQ(null), []);
  return (
    <div onClick={(e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-ym-p]");
      if (!el || !e.currentTarget.contains(el)) return;
      e.preventDefault();
      const d = el.dataset.ymD;
      setQ({ productId: el.dataset.ymP!, owner: el.dataset.ymO ?? "", dir: d === "in" || d === "out" ? d : "all", from, to });
    }}>
      {children}
      {q && <YardMovesDialog query={q} load={load} onClose={close} periodLabel={periodLabel} />}
    </div>
  );
}
