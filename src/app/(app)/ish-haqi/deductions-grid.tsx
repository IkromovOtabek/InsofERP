"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum, numText } from "@/lib/format";
import { DEDUCTION_CATS, type DeductionCat } from "@/lib/hr/deduction-cats";
import type { DeductionMonth } from "@/lib/hr/deductions";
import { Input } from "@/components/ui";
import { saveDeductionsAction, saveFundAmountAction } from "./ushlanma-actions";

/**
 * Ushlanmalar jadvali — Excel C2026'ning G–K ustunlari: har xodimga oy bo'yicha aliment/ijro, qarz to'lovi, oylikdan qarz,
 * to'y puli, jarima. Kul rang — taklif (daftar, nasiya jadvali, kassa, sozlama); ustun sarlavhasidagi ✓ — bo'sh kataklarga
 * takliflarni qo'yadi. O'zgarish o'zi saqlanadi; oy yakuni vedomosti shularni ushlaydi.
 */

const SAVE_DELAY = 700;
const k = (emp: string, cat: string) => `${emp}|${cat}`;
const toNum = (v: string) => { const t = numText(v.trim()); const n = t ? Number(t) : 0; return Number.isFinite(n) ? n : 0; };

export function DeductionsGrid({ data, canEdit }: { data: DeductionMonth; canEdit: boolean }) {
  const editable = canEdit && !data.locked;
  const init = useCallback(() => {
    const o: Record<string, string> = {};
    for (const r of data.rows) for (const [c, v] of Object.entries(r.values)) if (v) o[k(r.id, c)] = String(v);
    return o;
  }, [data]);
  const [vals, setVals] = useState(init);
  const [q, setQ] = useState("");
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [fund, setFund] = useState(data.fundAmount != null ? String(data.fundAmount) : "");
  const dirty = useRef(new Set<string>());
  const valsRef = useRef(vals); valsRef.current = vals;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const fresh = init();
    setVals((p) => { const o = { ...fresh }; for (const key of dirty.current) if (key in p) o[key] = p[key]!; return o; });
  }, [init]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const keys = [...dirty.current];
    if (!keys.length) return;
    dirty.current.clear();
    const items = keys.map((key) => { const [employeeId, category] = key.split("|"); return { employeeId: employeeId!, category: category!, value: valsRef.current[key] ?? "" }; });
    setBusy((n) => n + 1);
    let r: { error?: string; saved?: number };
    try { r = await saveDeductionsAction(data.month, items); } catch { r = { error: "Saqlanmadi — internet yoki sessiyani tekshiring" }; }
    setBusy((n) => n - 1);
    if (r.error) { for (const key of keys) dirty.current.add(key); setMsg(r.error); } else setMsg(null);
  }, [data.month]);
  const schedule = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), SAVE_DELAY); }, [flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.rows.filter((r) => (!t || r.fullName.toLowerCase().includes(t) || r.group.toLowerCase().includes(t) || r.position.toLowerCase().includes(t))
      && (!onlyFilled || DEDUCTION_CATS.some((c) => vals[k(r.id, c.key)] || r.suggest[c.key])));
  }, [data.rows, q, onlyFilled, vals]);

  const acceptColumn = (cat: DeductionCat) => {
    const next: Record<string, string> = {};
    for (const r of rows) { const s = r.suggest[cat]; if (s && !(vals[k(r.id, cat)] ?? "").trim()) next[k(r.id, cat)] = String(s); }
    if (!Object.keys(next).length) { setMsg("Bu ustunda qo'yiladigan taklif yo'q"); return; }
    setVals((p) => ({ ...p, ...next }));
    for (const key of Object.keys(next)) dirty.current.add(key);
    void flush();
  };

  const focus = (ri: number, ci: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${ri}"][data-c="${ci}"]`);
    if (el) { el.focus(); el.select(); }
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number) => {
    const el = e.currentTarget;
    const mv: [number, number] | null = e.key === "ArrowUp" ? [-1, 0] : e.key === "ArrowDown" || e.key === "Enter" ? [1, 0]
      : e.key === "ArrowLeft" && el.selectionStart === 0 ? [0, -1] : e.key === "ArrowRight" && el.selectionEnd === el.value.length ? [0, 1] : null;
    if (!mv) return;
    e.preventDefault();
    focus(Math.min(rows.length - 1, Math.max(0, ri + mv[0])), Math.min(DEDUCTION_CATS.length - 1, Math.max(0, ci + mv[1])));
  };
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, ri: number, ci: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/\n$/, ""))) return;
    e.preventDefault();
    const next: Record<string, string> = {};
    text.replace(/\r/g, "").replace(/\n$/, "").split("\n").forEach((line, i) => line.split("\t").forEach((v, j) => {
      const r = rows[ri + i], c = DEDUCTION_CATS[ci + j];
      if (r && c) next[k(r.id, c.key)] = v.trim();
    }));
    setVals((p) => ({ ...p, ...next }));
    for (const key of Object.keys(next)) dirty.current.add(key);
    void flush();
  };

  const colTotal = (cat: DeductionCat) => rows.reduce((s, r) => s + toNum(vals[k(r.id, cat)] ?? ""), 0);
  const rowTotal = (id: string) => DEDUCTION_CATS.reduce((s, c) => s + toNum(vals[k(id, c.key)] ?? ""), 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim, guruh yoki lavozim" className="h-9 w-64 pl-8" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} /> Faqat ushlanmasi yoki taklifi borlar</label>
        {canEdit && (
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            To&apos;y puli (har kishiga taklif):
            <Input value={fund} onChange={(e) => setFund(e.target.value)} inputMode="decimal" placeholder="masalan 223 000" className="h-9 w-36"
              onBlur={async () => { const cur = data.fundAmount != null ? String(data.fundAmount) : ""; if (fund.trim() !== cur) { const r = await saveFundAmountAction(fund); if (r.error) setMsg(r.error); } }} />
          </label>
        )}
        <span className="flex items-center gap-1 text-xs text-slate-500">{busy > 0 ? <><Loader2 size={13} className="animate-spin" /> Saqlanmoqda…</> : editable ? <><Check size={13} className="text-emerald-600" /> Saqlangan</> : "Faqat ko'rish"}</span>
      </div>
      {msg && <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700"><span>{msg}</span><button type="button" className="opacity-70 hover:underline" onClick={() => setMsg(null)}>Yopish</button></div>}
      <div className="relative max-w-full overflow-auto overscroll-contain rounded-(--radius-card) border border-slate-300/80 bg-white shadow-(--shadow-card)" style={{ maxHeight: "calc(100dvh - 320px)", minHeight: 300 }}>
        <table ref={tableRef} className="w-full border-separate border-spacing-0 font-(family-name:--font-inter) text-[13px] tabular text-slate-800">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 w-10 border-r border-b border-slate-300 bg-slate-100 px-1 py-2 text-center font-semibold">№</th>
              <th className="sticky left-10 z-30 min-w-60 border-r border-b border-slate-300 bg-slate-100 px-2 py-2 text-left font-semibold">F.I.O.</th>
              {DEDUCTION_CATS.map((c) => (
                <th key={c.key} className="min-w-32 border-r border-b border-slate-300 bg-red-50 px-2 py-1.5 text-right font-semibold" title={c.excel}>
                  <div className="flex items-center justify-end gap-1">
                    {c.label}
                    {editable && rows.some((r) => r.suggest[c.key] && !(vals[k(r.id, c.key)] ?? "").trim()) && (
                      <button type="button" onClick={() => acceptColumn(c.key)} title="Bo'sh kataklarga takliflarni qo'yish" className="rounded p-0.5 text-emerald-700 hover:bg-emerald-100"><CheckCheck size={14} /></button>
                    )}
                  </div>
                </th>
              ))}
              <th className="min-w-28 border-b border-slate-300 bg-red-100 px-2 py-2 text-right font-semibold">Jami</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.id} className="group">
                <td className="sticky left-0 z-10 border-r border-b border-slate-200 bg-white px-1 text-center text-slate-500 group-hover:bg-slate-50">{ri + 1}</td>
                <td className="sticky left-10 z-10 border-r border-b border-slate-200 bg-white px-2 py-0.5 group-hover:bg-slate-50">
                  <div className="truncate font-medium text-slate-900">{r.fullName}</div>
                  <div className="truncate text-[11px] text-slate-500">{r.position}{r.group ? ` · ${r.group}` : ""}</div>
                </td>
                {DEDUCTION_CATS.map((c, ci) => {
                  const key = k(r.id, c.key);
                  const sug = r.suggest[c.key];
                  return (
                    <td key={c.key} className="border-r border-b border-slate-200 p-0" title={r.hints[c.key]}>
                      <input data-r={ri} data-c={ci} value={vals[key] ?? ""} disabled={!editable} inputMode="decimal" autoComplete="off"
                        placeholder={sug ? fmtNum(sug) : ""} aria-label={`${r.fullName} — ${c.label}`}
                        onChange={(e) => { setVals((p) => ({ ...p, [key]: e.target.value })); dirty.current.add(key); schedule(); }}
                        onFocus={(e) => e.currentTarget.select()} onBlur={() => void flush()}
                        onKeyDown={(e) => onKey(e, ri, ci)} onPaste={(e) => onPaste(e, ri, ci)}
                        className={cn("h-9 w-full bg-transparent px-2 text-right outline-none placeholder:text-slate-400 placeholder:italic focus:bg-brand-50 focus:ring-2 focus:ring-brand-500 focus:ring-inset disabled:cursor-not-allowed", r.hints[c.key] && !vals[key] && "bg-amber-50/40")} />
                    </td>
                  );
                })}
                <td className="border-b border-slate-200 bg-red-50/40 px-2 text-right font-semibold">{rowTotal(r.id) ? fmtNum(rowTotal(r.id)) : ""}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={DEDUCTION_CATS.length + 3} className="px-3 py-8 text-center text-slate-500">Xodim topilmadi</td></tr>}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 font-semibold text-slate-900">
            <tr>
              <td className="sticky left-0 z-30 border-t-2 border-r border-slate-300 bg-slate-100" />
              <td className="sticky left-10 z-30 border-t-2 border-r border-slate-300 bg-slate-100 px-2 py-1.5">Jami ({rows.length})</td>
              {DEDUCTION_CATS.map((c) => <td key={c.key} className="border-t-2 border-r border-slate-300 bg-red-50 px-2 text-right">{fmtNum(colTotal(c.key))}</td>)}
              <td className="border-t-2 border-slate-300 bg-red-100 px-2 text-right">{fmtNum(DEDUCTION_CATS.reduce((s, c) => s + colTotal(c.key), 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
