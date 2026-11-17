import { Factory, Gauge, Target, Users } from "lucide-react";
import { dayTitle, monthTitle } from "@/lib/davomat";
import { qty, pct } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import type { ReportSnapshot } from "@/lib/production-report";

const th = "border border-slate-300 bg-slate-800 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-white print:bg-slate-200 print:text-black";
const td = "border border-slate-300 px-2 py-1.5";
const num = `${td} text-center tabular text-[15px] font-semibold`;

/** Bajarilish foizi rangi: ≥100 — yashil, ≥80 — sariq, qolgani — qizil. */
const tone = (p: number | null) => (p === null ? "text-slate-400" : p >= 100 ? "text-emerald-700" : p >= 80 ? "text-amber-600" : "text-red-600");
const barTone = (p: number) => (p >= 100 ? "bg-emerald-500" : p >= 80 ? "bg-amber-400" : "bg-red-500");
const ratio = (fact: number, plan: number | null) => (plan && plan > 0 ? (fact / plan) * 100 : null);

function Bar({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 print:border print:border-slate-400">
      <div className={`h-full rounded-full ${barTone(value)}`} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
    </div>
  );
}

/**
 * Kunlik hisobot — direktor varag'i (bir sahifa): brigadalar qancha quydi, sababi, plan bajarilishi.
 * Jonli ko'rinishda (`edit`) sabab va izoh maydonlari «Qayd etish» formasiga (`form={formId}`) qo'shiladi;
 * saqlangan nusxada esa yozilgan matn ko'rinadi.
 */
export function DailySheet({ r, company, stamp, note, edit }: {
  r: ReportSnapshot;
  company: string;
  stamp: React.ReactNode;
  note?: string | null;
  edit?: { formId: string; reasons: Record<string, string>; note: string | null };
}) {
  const m = r.daily;
  const cols = m?.cols ?? [];
  const rows = m?.rows ?? [];
  const reasons = edit?.reasons ?? m?.reasons ?? {};
  const sameUnit = cols.length > 0 && cols.every((c) => c.unit === cols[0].unit);
  const unit = sameUnit ? unitLabel(cols[0].unit) : "";
  const rowTotal = (cells: Record<string, number>) => cols.reduce((s, c) => s + (cells[c.id] ?? 0), 0);
  const colTotal = (id: string) => rows.reduce((s, x) => s + (x.cells[id] ?? 0), 0);
  const grand = cols.reduce((s, c) => s + colTotal(c.id), 0);
  const best = Math.max(0, ...rows.map((x) => rowTotal(x.cells)));
  const worked = rows.filter((x) => rowTotal(x.cells) > 0).length;

  // Plan bloki — sex mahsulotlari (beton logistikada)
  const plans = r.plan.rows.filter((p) => p.unit !== "m3" && p.monthPlan !== null);
  const sum = (f: (p: (typeof plans)[number]) => number) => plans.reduce((s, p) => s + f(p), 0);
  const planUnitSame = plans.length > 0 && plans.every((p) => p.unit === plans[0].unit);
  const toDate = (p: (typeof plans)[number]) => Math.min(p.monthPlan ?? 0, (p.dayPlan ?? 0) * r.plan.elapsed);
  const dayPct = planUnitSame ? ratio(sum((p) => p.day), sum((p) => p.dayPlan ?? 0)) : null;
  const monthPct = planUnitSame ? ratio(sum((p) => p.month), sum((p) => p.monthPlan ?? 0)) : null;
  const span = 2 + cols.length + (sameUnit ? 1 : 0) + 1; // №+brigada, mahsulotlar, jami, sababi
  const editNote = edit ? edit.note : null;

  return (
    <div className="space-y-5">
      {/* Sarlavha */}
      <div className="overflow-hidden rounded-xl border border-slate-300 print:rounded-none">
        <div className="flex flex-wrap items-end justify-between gap-3 bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-3 text-white print:bg-none print:text-black">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300 print:text-slate-600">{company} · ishlab chiqarish</div>
            <h1 className="text-[20px] font-bold leading-tight">Kunlik hisobot</h1>
          </div>
          <div className="text-right">
            <div className="text-[18px] font-bold tabular">{r.iso.split("-").reverse().join(".")}</div>
            <div className="text-[11px] text-slate-300 print:text-slate-600">{dayTitle(r.iso)} · {stamp}</div>
          </div>
        </div>

        {/* Bir qarashda */}
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 sm:divide-y-0">
          {[
            { icon: Factory, k: "Bugun quyildi", v: cols.length ? `${qty(grand)}${unit ? ` ${unit}` : ""}` : "—", c: "text-slate-900" },
            { icon: Target, k: "Kunlik plan", v: dayPct !== null ? pct(dayPct, 0) : "—", c: tone(dayPct), bar: dayPct },
            { icon: Gauge, k: `${monthTitle(r.ym)} plani`, v: monthPct !== null ? pct(monthPct, 0) : "—", c: tone(monthPct), bar: monthPct },
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

      {/* Brigada × mahsulot */}
      {!m ? <p className="text-slate-500">Bu nusxada brigada jadvali yo&apos;q (eski hisobot).</p> : (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[640px] border-collapse text-[13px] print:min-w-0">
            <thead>
              <tr>
                <th className={`${th} w-8`}>№</th>
                <th className={`${th} text-left`}>Brigada</th>
                {cols.map((c) => <th key={c.id} className={th}>{c.name}<div className="text-[10px] font-normal normal-case opacity-70">{unitLabel(c.unit)}</div></th>)}
                {sameUnit && <th className={th}>Jami</th>}
                <th className={`${th} min-w-[180px] text-left`}>Sababi</th>
                <th className={`${th} min-w-[160px]`}>Izoh</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x, i) => {
                const t = rowTotal(x.cells);
                const key = x.id ?? "-";
                return (
                  <tr key={key} className={t === 0 ? "bg-red-50/50 print:bg-transparent" : ""}>
                    <td className={`${td} text-center text-slate-500`}>{i + 1}</td>
                    <td className={td}>
                      <div className="font-semibold">{x.name}</div>
                      {x.leader && <div className="text-[11px] text-slate-500">{x.leader}</div>}
                      {sameUnit && best > 0 && (
                        <div className="mt-1 h-1 w-full rounded-full bg-slate-100 print:hidden">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${(t / best) * 100}%` }} />
                        </div>
                      )}
                    </td>
                    {cols.map((c) => <td key={c.id} className={num}>{x.cells[c.id] ? qty(x.cells[c.id]) : <span className="text-slate-300">—</span>}</td>)}
                    {sameUnit && <td className={`${num} bg-slate-50 print:bg-transparent`}>{t ? qty(t) : <span className="text-red-500">0</span>}</td>}
                    <td className={`${td} text-[12.5px]`}>
                      {edit
                        ? <input form={edit.formId} name={`reason:${key}`} defaultValue={reasons[key] ?? ""} maxLength={300}
                            placeholder={t === 0 ? "Nega quyilmadi?" : "Izoh (ixtiyoriy)"}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 outline-none focus:border-brand-400 print:border-0 print:p-0" />
                        : reasons[key] || ""}
                    </td>
                    {i === 0 && (
                      <td rowSpan={rows.length} className={`${td} align-middle text-center text-[13px] font-semibold`}>
                        {edit
                          ? <textarea form={edit.formId} name="note" defaultValue={editNote ?? ""} rows={5} maxLength={500}
                              placeholder="Umumiy izoh: masalan, 190 tadan ortiq plita ortilgan"
                              className="h-full min-h-28 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1 text-center text-[12.5px] font-normal outline-none focus:border-brand-400 print:border-0" />
                          : note || ""}
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={span + 1} className={`${td} text-center text-slate-500`}>Faol brigada yo&apos;q</td></tr>}
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

      {/* Plan bajarilishi */}
      <div>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-600">Plan bajarilishi · {monthTitle(r.ym)} ({r.plan.elapsed}/{r.plan.workDays} ish kuni)</h2>
        {plans.length === 0 ? <p className="text-slate-500">Bu oy uchun plan kiritilmagan (Bosh sahifa → Plan).</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {plans.map((p) => {
              const un = unitLabel(p.unit);
              const pd = ratio(p.day, p.dayPlan), pt = ratio(p.month, toDate(p)), pm = ratio(p.month, p.monthPlan);
              return (
                <table key={p.code} className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      <th className={`${th} text-left`}>{p.name}</th>
                      <th className={th}>{r.iso.slice(8)}.{r.iso.slice(5, 7)}<div className="text-[10px] font-normal normal-case opacity-70">bir kunlik</div></th>
                      <th className={th}>Oy boshidan<div className="text-[10px] font-normal normal-case opacity-70">bugungacha</div></th>
                      <th className={th}>Oy uchun<div className="text-[10px] font-normal normal-case opacity-70">jami</div></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={td}>Ishlab chiqarildi</td>
                      <td className={num}>{qty(p.day)}</td><td className={num}>{qty(p.month)}</td><td className={num}>{qty(p.month)}</td>
                    </tr>
                    <tr className="text-slate-600">
                      <td className={td}>Plan, {un}</td>
                      <td className={`${num} font-normal`}>{p.dayPlan !== null ? qty(Math.round(p.dayPlan)) : "—"}</td>
                      <td className={`${num} font-normal`}>{qty(Math.round(toDate(p)))}</td>
                      <td className={`${num} font-normal`}>{qty(p.monthPlan ?? 0)}</td>
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
      </div>

      <div className="grid grid-cols-2 gap-4 pt-6 text-[12px] sm:gap-10">
        <div className="border-t border-black pt-1">Ishlab chiqarish boshlig&apos;i (imzo)</div>
        <div className="border-t border-black pt-1">Direktor (imzo)</div>
      </div>
    </div>
  );
}
