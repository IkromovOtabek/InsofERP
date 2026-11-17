"use client";

import { useState } from "react";
import { Factory, Gauge, Target, Users } from "lucide-react";
import { qty, pct } from "@/lib/format";
import type { DailyMatrix } from "@/lib/production-daily";

const th = "border border-slate-300 bg-slate-800 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-white print:bg-slate-200 print:text-black";
const td = "border border-slate-300 px-2 py-1.5";
const num = `${td} text-center tabular text-[15px] font-semibold`;
const inp = "w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-center tabular outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 print:border-0 print:p-0";

const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
const WEEK = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const unitLabel = (u: string) => (u === "m3" ? "m³" : u);

/** Bajarilish foizi rangi: ≥100 — yashil, ≥80 — sariq, qolgani — qizil. */
const tone = (p: number | null) => (p === null ? "text-slate-400" : p >= 100 ? "text-emerald-700" : p >= 80 ? "text-amber-600" : "text-red-600");
const barTone = (p: number) => (p >= 100 ? "bg-emerald-500" : p >= 80 ? "bg-amber-400" : "bg-red-500");
const ratio = (fact: number, plan: number | null) => (plan && plan > 0 ? (fact / plan) * 100 : null);
const toNum = (v: string) => { const n = Number(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };

function Bar({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 print:border print:border-slate-400">
      <div className={`h-full rounded-full transition-all ${barTone(value)}`} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
    </div>
  );
}

const key = (id: string | null) => id ?? "-";

/**
 * Kunlik hisobot — direktor varag'i: brigadalar nechta quydi (papka bo'yicha), sababi, plan bajarilishi.
 * `edit` bo'lsa sonlar, sabablar, izoh va plan shu yerda yoziladi — maydonlar «Qayd etish» formasiga (`form={formId}`)
 * qo'shiladi, jami va foizlar yozilayotganda yangilanadi. Saqlangan nusxada yozilgan qiymatlar ko'rinadi.
 */
export function DailySheet({ m, iso, ym, workDays, elapsed, company, stamp, note, edit }: {
  m: DailyMatrix | undefined;
  iso: string; ym: string; workDays: number; elapsed: number;
  company: string;
  stamp: React.ReactNode;
  note?: string | null;
  edit?: { formId: string; note: string | null };
}) {
  const cols = m?.cols ?? [];
  const rows = m?.rows ?? [];
  const [cells, setCells] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(rows.map((r) => [key(r.id), Object.fromEntries(cols.map((c) => [c.id, r.cells[c.id] ? String(r.cells[c.id]) : ""]))])));
  const [plan, setPlan] = useState<Record<string, { month: string; day: string }>>(() =>
    Object.fromEntries(cols.map((c) => [c.id, { month: m?.plan?.[c.id]?.month ? String(m.plan[c.id].month) : "", day: m?.plan?.[c.id]?.day ? String(m.plan[c.id].day) : "" }])));

  const cell = (rk: string, c: string) => toNum(cells[rk]?.[c] ?? "");
  const sameUnit = cols.length > 0 && cols.every((c) => c.unit === cols[0].unit);
  const unit = sameUnit ? unitLabel(cols[0].unit) : "";
  const rowTotal = (rk: string) => cols.reduce((s, c) => s + cell(rk, c.id), 0);
  const colTotal = (c: string) => rows.reduce((s, x) => s + cell(key(x.id), c), 0);
  const grand = cols.reduce((s, c) => s + colTotal(c.id), 0);
  const best = Math.max(0, ...rows.map((x) => rowTotal(key(x.id))));
  const worked = rows.filter((x) => rowTotal(key(x.id)) > 0).length;

  // Plan: kunlik bo'sh bo'lsa oylik ish kunlariga bo'linadi
  const pl = cols.map((c) => {
    const month = toNum(plan[c.id]?.month ?? "") || null;
    const day = toNum(plan[c.id]?.day ?? "") || (month && workDays ? month / workDays : null);
    const fDay = colTotal(c.id);
    const fMonth = (m?.before?.[c.id] ?? 0) + fDay;
    const toDate = month && day ? Math.min(month, day * elapsed) : null;
    return { c, month, day, dayAuto: !toNum(plan[c.id]?.day ?? ""), fDay, fMonth, toDate };
  });
  const planned = pl.filter((p) => p.month);
  const pSame = planned.length > 0 && planned.every((p) => p.c.unit === planned[0].c.unit);
  const dayPct = pSame ? ratio(planned.reduce((s, p) => s + p.fDay, 0), planned.reduce((s, p) => s + (p.day ?? 0), 0)) : null;
  const monthPct = pSame ? ratio(planned.reduce((s, p) => s + p.fMonth, 0), planned.reduce((s, p) => s + (p.month ?? 0), 0)) : null;
  const shownPlans = edit ? pl : planned;

  const [y, mo, d] = iso.split("-").map(Number);
  const monthName = `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
  const dayName = WEEK[new Date(y, mo - 1, d).getDay()];
  const ddmm = `${String(d).padStart(2, "0")}.${String(mo).padStart(2, "0")}`;

  return (
    <div className="space-y-5">
      {/* Sarlavha va bir qarashda */}
      <div className="overflow-hidden rounded-xl border border-slate-300 print:rounded-none">
        <div className="flex flex-wrap items-end justify-between gap-3 bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-3 text-white print:bg-none print:text-black">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300 print:text-slate-600">{company} · ishlab chiqarish</div>
            <h1 className="text-[20px] font-bold leading-tight">Kunlik hisobot</h1>
          </div>
          <div className="text-right">
            <div className="text-[18px] font-bold tabular">{ddmm}.{y}</div>
            <div className="text-[11px] text-slate-300 print:text-slate-600">{dayName} · {stamp}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 sm:divide-y-0">
          {[
            { icon: Factory, k: "Bugun quyildi", v: cols.length ? `${qty(grand)}${unit ? ` ${unit}` : ""}` : "—", c: "text-slate-900" },
            { icon: Target, k: "Kunlik plan", v: dayPct !== null ? pct(dayPct, 0) : "—", c: tone(dayPct), bar: dayPct },
            { icon: Gauge, k: `${monthName} plani`, v: monthPct !== null ? pct(monthPct, 0) : "—", c: tone(monthPct), bar: monthPct },
            { icon: Users, k: "Ishlagan brigada", v: `${worked} / ${rows.filter((x) => x.id).length}`, c: "text-slate-900" },
          ].map(({ icon: Icon, k, v, c, bar }) => (
            <div key={k} className="px-4 py-3">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500"><Icon size={13} /> {k}</div>
              <div className={`text-[22px] font-bold leading-tight tabular ${c}`}>{v}</div>
              {bar !== undefined && <Bar value={bar ?? null} />}
            </div>
          ))}
        </div>
      </div>

      {edit && (
        <p className="text-[12.5px] text-slate-600 print:hidden">
          Har brigada qatoriga shu kuni nechta quyganini yozing. Kam quygan yoki umuman quymaganiga <b>sababini</b> yozing. Jami va foizlar yozganingiz sari hisoblanadi.
        </p>
      )}

      {/* Brigada × papka */}
      {!m ? <p className="text-slate-500">Bu nusxada brigada jadvali yo&apos;q (eski hisobot).</p> : (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[640px] border-collapse text-[13px] print:min-w-0">
            <thead>
              <tr>
                <th className={`${th} w-8`}>№</th>
                <th className={`${th} min-w-[150px] text-left`}>Brigada</th>
                {cols.map((c) => <th key={c.id} className={`${th} min-w-[84px]`}>{c.name}<div className="text-[10px] font-normal normal-case opacity-70">{unitLabel(c.unit)}</div></th>)}
                {sameUnit && <th className={th}>Jami</th>}
                <th className={`${th} min-w-[180px] text-left`}>Sababi</th>
                <th className={`${th} min-w-[160px]`}>Izoh</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x, i) => {
                const rk = key(x.id);
                const t = rowTotal(rk);
                return (
                  <tr key={rk} className={t === 0 ? "bg-red-50/50 print:bg-transparent" : ""}>
                    <td className={`${td} text-center text-slate-500`}>{i + 1}</td>
                    <td className={td}>
                      <div className="font-semibold">{x.name}</div>
                      {x.leader && <div className="text-[11px] text-slate-500">{x.leader}</div>}
                      {sameUnit && best > 0 && (
                        <div className="mt-1 h-1 w-full rounded-full bg-slate-100 print:hidden">
                          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(t / best) * 100}%` }} />
                        </div>
                      )}
                    </td>
                    {cols.map((c) => (
                      <td key={c.id} className={edit ? `${td} p-1` : num}>
                        {edit
                          ? <input form={edit.formId} name={`cell:${rk}:${c.id}`} inputMode="numeric" autoComplete="off" placeholder="0"
                              value={cells[rk]?.[c.id] ?? ""} onChange={(e) => { const v = e.target.value.replace(/[^\d.,]/g, ""); setCells((s) => ({ ...s, [rk]: { ...s[rk], [c.id]: v } })); }}
                              className={`${inp} text-[15px] font-semibold`} />
                          : cell(rk, c.id) ? qty(cell(rk, c.id)) : <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                    {sameUnit && <td className={`${num} bg-slate-50 print:bg-transparent`}>{t ? qty(t) : <span className="text-red-500">0</span>}</td>}
                    <td className={`${td} text-[12.5px]`}>
                      {edit
                        ? <input form={edit.formId} name={`reason:${rk}`} defaultValue={m.reasons[rk] ?? ""} maxLength={300}
                            placeholder={t === 0 ? "Nega quyilmadi?" : "Izoh (ixtiyoriy)"}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 outline-none focus:border-brand-400 print:border-0 print:p-0" />
                        : m.reasons[rk] || ""}
                    </td>
                    {i === 0 && (
                      <td rowSpan={rows.length} className={`${td} align-middle text-center text-[13px] font-semibold`}>
                        {edit
                          ? <textarea form={edit.formId} name="note" defaultValue={edit.note ?? ""} rows={5} maxLength={500}
                              placeholder="Umumiy izoh: masalan, 190 tadan ortiq plita ortilgan"
                              className="h-full min-h-28 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1 text-center text-[12.5px] font-normal outline-none focus:border-brand-400 print:border-0" />
                          : note || ""}
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={cols.length + 5} className={`${td} text-center text-slate-500`}>Faol brigada yo&apos;q</td></tr>}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 print:bg-transparent">
                <td className={td} />
                <td className={`${td} font-bold uppercase`}>Jami</td>
                {cols.map((c) => <td key={c.id} className={`${num} text-[17px]`}>{qty(colTotal(c.id))}</td>)}
                {sameUnit && <td className={`${num} bg-brand-50 text-[19px] text-brand-800 print:bg-transparent`}>{qty(grand)}</td>}
                <td className={td} colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Plan bajarilishi — papka bo'yicha */}
      <div>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-600">Plan bajarilishi · {monthName} ({elapsed}/{workDays} ish kuni)</h2>
        {shownPlans.length === 0 ? <p className="text-slate-500">Bu oy uchun plan kiritilmagan.</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {shownPlans.map((p) => {
              const pd = ratio(p.fDay, p.day), pt = ratio(p.fMonth, p.toDate), pm = ratio(p.fMonth, p.month);
              return (
                <table key={p.c.id} className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      <th className={`${th} text-left`}>{p.c.name}</th>
                      <th className={th}>{ddmm}<div className="text-[10px] font-normal normal-case opacity-70">bir kunlik</div></th>
                      <th className={th}>Oy boshidan<div className="text-[10px] font-normal normal-case opacity-70">bugungacha</div></th>
                      <th className={th}>{MONTHS[Number(ym.slice(5)) - 1]} uchun<div className="text-[10px] font-normal normal-case opacity-70">jami</div></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={td}>Ishlab chiqarildi</td>
                      <td className={num}>{qty(p.fDay)}</td><td className={num}>{qty(p.fMonth)}</td><td className={num}>{qty(p.fMonth)}</td>
                    </tr>
                    <tr className="text-slate-600">
                      <td className={td}>Plan, {unitLabel(p.c.unit)}</td>
                      <td className={edit ? `${td} p-1` : `${num} font-normal`}>
                        {edit
                          ? <input form={edit.formId} name={`plan:${p.c.id}:day`} inputMode="numeric" autoComplete="off" value={plan[p.c.id]?.day ?? ""}
                              placeholder={p.day ? String(Math.round(p.day)) : "kunlik"} title="Bo'sh qolsa oylik plan ish kunlariga bo'linadi"
                              onChange={(e) => { const v = e.target.value.replace(/[^\d.,]/g, ""); setPlan((s) => ({ ...s, [p.c.id]: { ...s[p.c.id], day: v } })); }} className={inp} />
                          : p.day ? qty(Math.round(p.day)) : "—"}
                      </td>
                      <td className={`${num} font-normal`}>{p.toDate ? qty(Math.round(p.toDate)) : "—"}</td>
                      <td className={edit ? `${td} p-1` : `${num} font-normal`}>
                        {edit
                          ? <input form={edit.formId} name={`plan:${p.c.id}:month`} inputMode="numeric" autoComplete="off" value={plan[p.c.id]?.month ?? ""} placeholder="oylik plan"
                              onChange={(e) => { const v = e.target.value.replace(/[^\d.,]/g, ""); setPlan((s) => ({ ...s, [p.c.id]: { ...s[p.c.id], month: v } })); }} className={inp} />
                          : p.month ? qty(p.month) : "—"}
                      </td>
                    </tr>
                    <tr>
                      <td className={`${td} font-semibold`}>Bajarilish</td>
                      {[pd, pt, pm].map((v, i) => (
                        <td key={i} className={`${td} text-center`}>
                          <span className={`text-[16px] font-bold tabular ${tone(v)}`}>{v !== null ? pct(v, 0) : "—"}</span>
                          <Bar value={v} />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              );
            })}
          </div>
        )}
        {edit && <p className="mt-2 text-[11.5px] text-slate-500 print:hidden">Oylik planni bir marta yozing — oyning keyingi hisobotlariga o&apos;zi o&apos;tadi. Kunlik plan bo&apos;sh qolsa, oylik plan {workDays} ish kuniga bo&apos;linadi.</p>}
      </div>

      <div className="grid grid-cols-2 gap-4 pt-6 text-[12px] sm:gap-10">
        <div className="border-t border-black pt-1">Ishlab chiqarish boshlig&apos;i (imzo)</div>
        <div className="border-t border-black pt-1">Direktor (imzo)</div>
      </div>
    </div>
  );
}
