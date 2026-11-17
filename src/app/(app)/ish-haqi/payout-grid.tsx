"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { fmtNum, numText } from "@/lib/format";
import { Input } from "@/components/ui";
import { savePayoutAmountsAction } from "./ushlanma-actions";

/**
 * Avans va plastik summalari — xodim bo'yicha, har oy bir xil (Excel «Аванс наличка» kabi): avans — qo'lda belgilangan
 * summa (bo'sh — foiz bo'yicha), plastik — oylikning kartaga o'tadigan qismi (bo'sh — hammasi naqd). O'zgarish o'zi saqlanadi.
 */
type Row = { id: string; fullName: string; position: string; advance: number | null; card: number | null };
const SAVE_DELAY = 700;

export function PayoutGrid({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const init = useCallback(() => {
    const o: Record<string, string> = {};
    for (const r of rows) { if (r.advance) o[`${r.id}|advance`] = String(r.advance); if (r.card) o[`${r.id}|card`] = String(r.card); }
    return o;
  }, [rows]);
  const [vals, setVals] = useState(init);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = useRef(new Set<string>());
  const valsRef = useRef(vals); valsRef.current = vals;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { const f = init(); setVals((p) => { const o = { ...f }; for (const k of dirty.current) if (k in p) o[k] = p[k]!; return o; }); }, [init]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const keys = [...dirty.current];
    if (!keys.length) return;
    dirty.current.clear();
    setBusy((n) => n + 1);
    let r: { error?: string };
    try { r = await savePayoutAmountsAction(keys.map((k) => { const [employeeId, field] = k.split("|"); return { employeeId: employeeId!, field: field as "advance" | "card", value: valsRef.current[k] ?? "" }; })); }
    catch { r = { error: "Saqlanmadi — internet yoki sessiyani tekshiring" }; }
    setBusy((n) => n - 1);
    if (r.error) { for (const k of keys) dirty.current.add(k); setMsg(r.error); } else setMsg(null);
  }, []);
  const schedule = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), SAVE_DELAY); }, [flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const list = useMemo(() => { const t = q.trim().toLowerCase(); return t ? rows.filter((r) => r.fullName.toLowerCase().includes(t) || r.position.toLowerCase().includes(t)) : rows; }, [rows, q]);
  const sum = (f: string) => list.reduce((s, r) => s + (Number(numText(vals[`${r.id}|${f}`] ?? "")) || 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim yoki lavozim" className="h-9 w-64 pl-8" />
        </label>
        <span className="text-xs text-slate-500">Avans jami: <b>{fmtNum(sum("advance"))}</b> · Plastik jami: <b>{fmtNum(sum("card"))}</b></span>
        <span className="ml-auto flex items-center gap-1 text-xs text-slate-500">{busy > 0 ? <><Loader2 size={13} className="animate-spin" /> Saqlanmoqda…</> : canEdit ? <><Check size={13} className="text-emerald-600" /> Saqlangan</> : "Faqat ko'rish"}</span>
      </div>
      {msg && <p className="text-xs text-red-700">{msg}</p>}
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500">
            <tr><th className="px-3 py-2 text-left">Xodim</th><th className="w-44 px-3 py-2 text-right">Avans (oyiga, qo&apos;lda)</th><th className="w-44 px-3 py-2 text-right">Plastik (oyiga)</th></tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-1"><div className="font-medium text-slate-900">{r.fullName}</div><div className="text-xs text-slate-500">{r.position}</div></td>
                {(["advance", "card"] as const).map((f) => {
                  const k = `${r.id}|${f}`;
                  return (
                    <td key={f} className="p-0">
                      <input value={vals[k] ?? ""} disabled={!canEdit} inputMode="decimal" placeholder={f === "advance" ? "foiz bo'yicha" : "hammasi naqd"} aria-label={`${r.fullName} — ${f === "advance" ? "avans" : "plastik"}`}
                        onChange={(e) => { setVals((p) => ({ ...p, [k]: e.target.value })); dirty.current.add(k); schedule(); }} onBlur={() => void flush()}
                        className="h-10 w-full bg-transparent px-3 text-right outline-none placeholder:text-slate-400 placeholder:italic focus:bg-brand-50 focus:ring-2 focus:ring-brand-500 focus:ring-inset" />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
