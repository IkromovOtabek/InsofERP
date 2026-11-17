"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { parseTabelValue } from "@/lib/hr/tabel-value";
import type { TabelMonth, TabelRow } from "@/lib/hr/tabel";
import { saveTabelAction } from "./tabel-actions";

/**
 * Tabel jadvali — Excel tabeli kabi: qatorda xodim, ustunda 1..31 kun, katakka soat (8, 4…) yoki H/K/T/D.
 * ↑↓←→ va Enter — kataklar orasida, Excel'dan blok nusxa olib Ctrl+V — bir nechta katak birdan.
 * O'zgarish o'zi saqlanadi (bir oz kutib, bir so'rovda). Kul rang raqam — Face ID / kelish-ketish vaqtidan, qo'lda yozilsa almashadi.
 */

const PAY_LABEL: Record<TabelRow["payType"], string> = { SALARY: "Oklad", DAILY: "Kunbay", HOURLY: "Soatbay", PIECE: "Sdelka" };
const CODE_CLS: Record<string, string> = { H: "text-red-600", K: "text-amber-600", T: "text-sky-600", D: "text-slate-400" };
const SAVE_DELAY = 700;

type Key = string; // `${employeeId}:${day}`
const k = (id: string, d: number): Key => `${id}:${d}`;

export function TabelGrid({ data, canEdit }: { data: TabelMonth; canEdit: boolean }) {
  const editable = canEdit && !data.locked;
  const init = useCallback(() => {
    const o: Record<Key, string> = {};
    for (const r of data.rows) for (const [d, c] of Object.entries(r.cells)) o[k(r.id, Number(d))] = c.v;
    return o;
  }, [data]);
  const [vals, setVals] = useState<Record<Key, string>>(init);
  const [bad, setBad] = useState<Record<Key, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "ok" | "warn"; text: string } | null>(null);
  const dirty = useRef(new Set<Key>());
  const valsRef = useRef(vals);
  valsRef.current = vals;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  // Sahifa yangilansa (server ma'lumoti) — saqlanmagan kataklardan boshqasi serverdagidek
  useEffect(() => {
    const fresh = init();
    setVals((prev) => {
      const out = { ...fresh };
      for (const key of dirty.current) if (key in prev) out[key] = prev[key]!;
      return out;
    });
  }, [init]);

  const autoOf = useMemo(() => {
    const m = new Map<Key, { auto?: boolean; face?: boolean; orig: string }>();
    for (const r of data.rows) for (const [d, c] of Object.entries(r.cells)) m.set(k(r.id, Number(d)), { auto: c.auto, face: c.face, orig: c.v });
    return m;
  }, [data]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current.size) return;
    const keys = [...dirty.current];
    const items: { employeeId: string; day: number; value: string }[] = [];
    const errs: Record<Key, string> = {};
    for (const key of keys) {
      const v = valsRef.current[key] ?? "";
      const p = parseTabelValue(v);
      if ("error" in p) { errs[key] = p.error; continue; }
      const [employeeId, day] = key.split(":");
      items.push({ employeeId: employeeId!, day: Number(day), value: v });
    }
    setBad((b) => { const o = { ...b }; for (const key of keys) delete o[key]; return { ...o, ...errs }; });
    if (Object.keys(errs).length) setMsg({ tone: "error", text: Object.values(errs)[0]! });
    if (!items.length) return;
    for (const it of items) dirty.current.delete(k(it.employeeId, it.day));
    setBusy(true);
    let r: { error?: string; saved?: number; skipped?: string[] };
    try { r = await saveTabelAction(data.month, items); } catch { r = { error: "Saqlanmadi — internet yoki sessiyani tekshiring" }; }
    setBusy(false);
    if (r.error) {
      for (const it of items) dirty.current.add(k(it.employeeId, it.day));
      setMsg({ tone: "error", text: r.error });
    } else if (r.skipped?.length) setMsg({ tone: "warn", text: `Yozilmadi: ${r.skipped.slice(0, 3).join("; ")}${r.skipped.length > 3 ? ` va yana ${r.skipped.length - 3}` : ""}` });
    else if (!Object.keys(errs).length) setMsg(null);
  }, [data.month]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
  }, [flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Sahifadan chiqib ketishda saqlanmagan katak qolmasin
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.current.size) { void flush(); e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [flush]);

  const cellOk = (r: TabelRow, d: number) => {
    const day = data.days[d - 1];
    return editable && !!day && !day.future && d >= r.from && d <= r.to;
  };

  const setVal = (key: Key, v: string) => {
    setVals((p) => ({ ...p, [key]: v }));
    dirty.current.add(key);
    schedule();
  };

  const focusCell = (ri: number, d: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${ri}"][data-d="${d}"]`);
    if (el) { el.focus(); el.select(); }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, ri: number, d: number) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [e.shiftKey ? -1 : 1, 0] };
    const el = e.currentTarget;
    // ←→ — matn boshida/oxirida (yoki hammasi belgilangan) bo'lsa qo'shni katakka
    if (el.selectionStart === 0) moves.ArrowLeft = [0, -1];
    if (el.selectionEnd === el.value.length) moves.ArrowRight = [0, 1];
    const mv = moves[e.key];
    if (!mv) { if (e.key === "Escape") { el.blur(); } return; }
    e.preventDefault();
    focusCell(Math.min(data.rows.length - 1, Math.max(0, ri + mv[0])), Math.min(data.days.length, Math.max(1, d + mv[1])));
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, ri: number, d: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/\n$/, ""))) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const next: Record<Key, string> = {};
    lines.forEach((line, i) => {
      const r = data.rows[ri + i];
      if (!r) return;
      line.forEach((v, j) => { const dd = d + j; if (dd <= data.days.length && cellOk(r, dd)) next[k(r.id, dd)] = v.trim(); });
    });
    setVals((p) => ({ ...p, ...next }));
    for (const key of Object.keys(next)) dirty.current.add(key);
    void flush();
  };

  // Qator jami: soat; kun — qo'lda soat ÷ kunlik soat, vaqtdan/«+» — 1 kun (ish haqi hisobi kabi)
  const totals = (r: TabelRow) => {
    let hours = 0, days = 0;
    const codes: Record<string, number> = {};
    for (let d = 1; d <= data.days.length; d++) {
      const v = (vals[k(r.id, d)] ?? "").trim();
      if (!v) continue;
      const p = parseTabelValue(v);
      if ("error" in p || p.kind === "clear") continue;
      if (p.kind === "status") { const c = v.toUpperCase().replace("Н", "H").replace("К", "K").replace("Т", "T").replace("Д", "D"); codes[c] = (codes[c] ?? 0) + 1; continue; }
      const auto = autoOf.get(k(r.id, d));
      const isAuto = auto?.auto && auto.orig === v;
      const h = p.hours ?? data.hoursPerDay;
      hours += h;
      days += isAuto || p.hours == null ? 1 : h / data.hoursPerDay;
    }
    const sum = r.payType === "SALARY" ? (r.normDays > 0 ? (r.rate * days) / r.normDays : 0) : r.payType === "DAILY" ? r.rate * days : r.payType === "HOURLY" ? r.rate * hours : null;
    return { hours, days, codes, sum };
  };

  const dayTotals = data.days.map((dd) => data.rows.reduce((s, r) => {
    const p = parseTabelValue(vals[k(r.id, dd.day)] ?? "");
    return s + ("error" in p || p.kind !== "hours" ? 0 : p.hours ?? data.hoursPerDay);
  }, 0));
  const rowTotals = data.rows.map(totals);
  const grand = rowTotals.reduce((s, t) => ({ hours: s.hours + t.hours, days: s.days + t.days, sum: s.sum + (t.sum ?? 0) }), { hours: 0, days: 0, sum: 0 });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>Katakka soat yozing (8, 4, 7,5) yoki <b className="text-red-600">H</b> — kelmadi, <b className="text-amber-600">K</b> — kasal, <b className="text-sky-600">T</b> — ta&apos;til, <b className="text-slate-500">D</b> — dam olish; bo&apos;sh — tozalash.</span>
        <span className="ml-auto flex items-center gap-1">
          {busy ? <><Loader2 size={13} className="animate-spin" /> Saqlanmoqda…</> : editable ? <><Check size={13} className="text-emerald-600" /> Saqlangan</> : "Faqat ko'rish"}
        </span>
      </div>
      {msg && (
        <div className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs", msg.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : msg.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
          <span>{msg.text}</span>
          <button type="button" className="opacity-70 hover:underline" onClick={() => setMsg(null)}>Yopish</button>
        </div>
      )}
      <div className="relative max-w-full overflow-auto overscroll-contain rounded-(--radius-card) border border-slate-300/80 bg-white shadow-(--shadow-card)" style={{ maxHeight: "calc(100dvh - 300px)", minHeight: 320 }}>
        <table ref={tableRef} lang="ru" className="border-separate border-spacing-0 font-(family-name:--font-inter) text-[12px] tabular text-slate-800">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 w-8 border-r border-b border-slate-300 bg-slate-100 px-1 py-1.5 text-center font-semibold">№</th>
              <th className="sticky left-8 z-30 min-w-56 border-r border-b border-slate-300 bg-slate-100 px-2 py-1.5 text-left font-semibold">F.I.O.</th>
              {data.days.map((d) => (
                <th key={d.day} className={cn("w-9 min-w-9 border-r border-b border-slate-300 px-0 py-1.5 text-center font-semibold", d.weekend ? "bg-sky-100 text-sky-800" : "bg-slate-100", d.future && "text-slate-400")}>{d.day}</th>
              ))}
              <th className="border-r border-b border-slate-300 bg-emerald-50 px-2 py-1.5 text-right font-semibold" title="Jami soat">Soat</th>
              <th className="border-r border-b border-slate-300 bg-emerald-50 px-2 py-1.5 text-right font-semibold" title={`Kun = soat ÷ ${data.hoursPerDay}`}>Kun</th>
              <th className="border-r border-b border-slate-300 bg-slate-100 px-2 py-1.5 text-right font-semibold" title="Oy normasi (ish kunlari)">Norma</th>
              <th className="border-r border-b border-slate-300 bg-slate-100 px-2 py-1.5 text-right font-semibold">Stavka</th>
              <th className="border-b border-slate-300 bg-amber-50 px-2 py-1.5 text-right font-semibold" title="Taxminiy hisob: oklad × kun ÷ norma, kunbay × kun, soatbay × soat. Yakuniy summa — vedomostda">Hisob</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, ri) => {
              const t = rowTotals[ri]!;
              return (
                <tr key={r.id} className="group">
                  <td className="sticky left-0 z-10 border-r border-b border-slate-200 bg-white px-1 text-center text-slate-500 group-hover:bg-slate-50">{ri + 1}</td>
                  <td className="sticky left-8 z-10 border-r border-b border-slate-200 bg-white px-2 py-0.5 group-hover:bg-slate-50">
                    <div className="truncate font-medium text-slate-900" title={r.fullName}>{r.fullName}</div>
                    <div className="truncate text-[11px] text-slate-500">{r.position} · {PAY_LABEL[r.payType]}</div>
                  </td>
                  {data.days.map((d) => {
                    const key = k(r.id, d.day);
                    const v = vals[key] ?? "";
                    const ok = cellOk(r, d.day);
                    const a = autoOf.get(key);
                    const isAuto = !!a?.auto && a.orig === v;
                    const code = /^[HKTDНКТД]$/i.test(v) ? v.toUpperCase().replace("Н", "H").replace("К", "K").replace("Т", "T").replace("Д", "D") : null;
                    return (
                      <td key={d.day} className={cn("h-8 border-r border-b border-slate-200 p-0", d.weekend && "bg-sky-50/70", !ok && "bg-slate-50")}>
                        <input
                          data-r={ri} data-d={d.day} value={v} disabled={!ok} inputMode="decimal" spellCheck={false} autoComplete="off"
                          aria-label={`${r.fullName}, ${d.day}-kun`}
                          title={bad[key] ?? (a?.face ? "Face ID / o'zi belgilagan — vaqtdan" : isAuto ? "Kelish-ketish vaqtidan" : undefined)}
                          onChange={(e) => setVal(key, e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onBlur={() => { if (dirty.current.size) void flush(); }}
                          onKeyDown={(e) => onKey(e, ri, d.day)}
                          onPaste={(e) => onPaste(e, ri, d.day)}
                          className={cn("h-8 w-full min-w-9 bg-transparent px-0.5 text-center outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-500 focus:ring-inset disabled:cursor-not-allowed",
                            isAuto && "text-slate-400 italic", code && cn("font-semibold", CODE_CLS[code]), bad[key] && "bg-red-50 text-red-700 ring-1 ring-red-400 ring-inset")}
                        />
                      </td>
                    );
                  })}
                  <td className="border-r border-b border-slate-200 bg-emerald-50/50 px-2 text-right font-semibold">{t.hours ? fmtNum(t.hours, 2) : ""}</td>
                  <td className="border-r border-b border-slate-200 bg-emerald-50/50 px-2 text-right" title={Object.entries(t.codes).map(([c, n]) => `${c}: ${n}`).join(", ") || undefined}>
                    {t.days ? fmtNum(t.days, 2) : ""}
                    {Object.keys(t.codes).length > 0 && <div className="text-[10px] text-slate-500">{Object.entries(t.codes).map(([c, n]) => `${c}${n}`).join(" ")}</div>}
                  </td>
                  <td className="border-r border-b border-slate-200 px-2 text-right text-slate-500">{r.payType === "SALARY" ? r.normDays : ""}</td>
                  <td className="border-r border-b border-slate-200 px-2 text-right text-slate-600">{r.rate ? fmtNum(r.rate) : ""}</td>
                  <td className="border-b border-slate-200 bg-amber-50/40 px-2 text-right font-medium text-slate-900">{t.sum == null ? <span className="text-[11px] font-normal text-slate-400">sdelka</span> : t.sum ? fmtNum(Math.round(t.sum)) : ""}</td>
                </tr>
              );
            })}
            {data.rows.length === 0 && <tr><td colSpan={data.days.length + 7} className="px-3 py-8 text-center text-slate-500">Bu guruhda shu oyda ishlagan xodim yo&apos;q</td></tr>}
          </tbody>
          {data.rows.length > 0 && (
            <tfoot className="sticky bottom-0 z-20">
              <tr className="font-semibold text-slate-900">
                <td className="sticky left-0 z-30 border-t-2 border-r border-slate-300 bg-slate-100" />
                <td className="sticky left-8 z-30 border-t-2 border-r border-slate-300 bg-slate-100 px-2 py-1">Jami ({data.rows.length})</td>
                {dayTotals.map((h, i) => <td key={i} className="border-t-2 border-r border-slate-300 bg-slate-100 text-center text-[11px]">{h ? fmtNum(h) : ""}</td>)}
                <td className="border-t-2 border-r border-slate-300 bg-emerald-100 px-2 text-right">{fmtNum(grand.hours, 2)}</td>
                <td className="border-t-2 border-r border-slate-300 bg-emerald-100 px-2 text-right">{fmtNum(grand.days, 2)}</td>
                <td className="border-t-2 border-r border-slate-300 bg-slate-100" />
                <td className="border-t-2 border-r border-slate-300 bg-slate-100" />
                <td className="border-t-2 border-slate-300 bg-amber-100 px-2 text-right">{fmtNum(Math.round(grand.sum))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
