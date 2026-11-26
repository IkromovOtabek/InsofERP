"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarRange, Check, CheckCheck, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum, numText } from "@/lib/format";
import { monthTitle, shiftMonth } from "@/lib/davomat";
import { DEDUCTION_CATS, installment, type DeductionCat } from "@/lib/hr/deduction-cats";
import type { DeductionMonth } from "@/lib/hr/deductions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import { saveDeductionsAction, saveFundAmountAction, splitLoanAction } from "./ushlanma-actions";

/**
 * Ushlanmalar jadvali — Excel C2026'ning G–K ustunlari: har xodimga oy bo'yicha aliment/ijro, qarz to'lovi, oylikdan qarz,
 * to'y puli, jarima. Ko'k — avtomatik (Kirim-Chiqimdan berilgan pul, kassadan nasiya ulushi, aliment daftari: yozilmasa ham
 * vedomost ushlaydi), kul rang — taklif (kassasiz qarz ulushi, to'y puli); ustun sarlavhasidagi ✓ — bo'sh kataklarga
 * takliflarni qo'yadi. O'zgarish o'zi saqlanadi; oy yakuni vedomosti shularni ushlaydi.
 */

const SAVE_DELAY = 700;
const k = (emp: string, cat: string) => `${emp}|${cat}`;
const toNum = (v: string) => { const t = numText(v.trim()); const n = t ? Number(t) : 0; return Number.isFinite(n) ? n : 0; };
/** Guruhlar tartibi — Tabel kabi: komandalar → brigadalar → biriktirilmagan. */
const groupRank = (k: string) => (k.startsWith("t:") ? 0 : k.startsWith("b:") ? 1 : 2);
const groupLabel = (r: { groupKey: string; group: string }) => (r.groupKey === "none" ? "Biriktirilmagan" : r.group);

export function DeductionsGrid({ data, canEdit }: { data: DeductionMonth; canEdit: boolean }) {
  const editable = canEdit && !data.locked;
  const init = useCallback(() => {
    const o: Record<string, string> = {};
    for (const r of data.rows) for (const [c, v] of Object.entries(r.values)) if (v != null) o[k(r.id, c)] = String(v);
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
  const router = useRouter();
  // «Qarz to'lovi» katagidagi summani oylarga bo'lish oynasi
  const [split, setSplit] = useState<{ employeeId: string; fullName: string; amount: number } | null>(null);

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
    // Komanda / brigada bo'yicha (sarlavha qatori bilan), guruh ichida — ism bo'yicha
    return data.rows.filter((r) => (!t || r.fullName.toLowerCase().includes(t) || r.group.toLowerCase().includes(t) || r.position.toLowerCase().includes(t))
      && (!onlyFilled || DEDUCTION_CATS.some((c) => vals[k(r.id, c.key)] || r.suggest[c.key] || r.auto[c.key])))
      .sort((a, b) => groupRank(a.groupKey) - groupRank(b.groupKey) || groupLabel(a).localeCompare(groupLabel(b)) || a.fullName.localeCompare(b.fullName));
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

  // Vedomost ushlaydigan summa: yozilgani, bo'sh bo'lsa — avtomatik
  const eff = (r: DeductionMonth["rows"][number], cat: DeductionCat) => { const v = (vals[k(r.id, cat)] ?? "").trim(); return v ? toNum(v) : r.auto[cat] ?? 0; };
  const colTotal = (cat: DeductionCat) => rows.reduce((s, r) => s + eff(r, cat), 0);
  const rowTotal = (r: DeductionMonth["rows"][number]) => DEDUCTION_CATS.reduce((s, c) => s + eff(r, c.key), 0);

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
      <p className="text-xs text-slate-500"><span className="font-medium text-sky-700">Ko&apos;k</span> — avtomatik, yozilmasa ham oy yakunida ushlanadi: Kirim-Chiqimda xodimga «Hodimlar bilan hisob-kitob» yoki «Oylik hisobidan avans/qarz» sub manbasi bilan berilgan pul (Oylikdan qarz), kassadan nasiya va oylarga bo&apos;lingan qarz ulushi (Qarz to&apos;lovi — katakdagi taqvim tugmasi bilan bo&apos;linadi), aliment daftari. Ustiga yozilsa — yozilgani; «Oylikdan qarz» ga 0 — ushlanmaydi. <i className="text-slate-400">Kul rang</i> — taklif, ✓ bilan qo&apos;yiladi.</p>
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
              <Fragment key={r.id}>
              {(ri === 0 || rows[ri - 1]!.groupKey !== r.groupKey) && (() => {
                const g = rows.filter((x) => x.groupKey === r.groupKey);
                return (
                  <tr>
                    <td className="sticky left-0 z-10 border-b border-slate-200 bg-amber-50" />
                    <td className="sticky left-10 z-10 border-r border-b border-slate-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">{groupLabel(r)} <span className="font-normal text-amber-700">· {g.length} kishi</span></td>
                    {DEDUCTION_CATS.map((c) => { const t = g.reduce((s, x) => s + eff(x, c.key), 0); return <td key={c.key} className="border-r border-b border-slate-200 bg-amber-50 px-2 text-right text-xs font-semibold text-amber-900">{t ? fmtNum(t) : ""}</td>; })}
                    <td className="border-b border-slate-200 bg-amber-100/70 px-2 text-right text-xs font-semibold text-amber-900">{fmtNum(g.reduce((s, x) => s + rowTotal(x), 0)) || ""}</td>
                  </tr>
                );
              })()}
              <tr className="group">
                <td className="sticky left-0 z-10 border-r border-b border-slate-200 bg-white px-1 text-center text-slate-500 group-hover:bg-slate-50">{ri + 1}</td>
                <td className="sticky left-10 z-10 border-r border-b border-slate-200 bg-white px-2 py-0.5 group-hover:bg-slate-50">
                  <div className="truncate font-medium text-slate-900">{r.fullName}</div>
                  <div className="truncate text-[11px] text-slate-500">{r.position}</div>
                </td>
                {DEDUCTION_CATS.map((c, ci) => {
                  const key = k(r.id, c.key);
                  const sug = r.suggest[c.key], au = r.auto[c.key];
                  const tip = [r.hints[c.key], au ? `Avtomatik ushlanadi: ${fmtNum(au)}${c.key === "SALARY_DEBT" ? " (0 yozilsa — ushlanmaydi)" : ""}` : null, sug ? `Taklif: ${fmtNum(sug)}` : null].filter(Boolean).join("\n");
                  const canSplit = editable && c.key === "LOAN" && toNum(vals[key] ?? "") > 0;
                  return (
                    <td key={c.key} className="relative border-r border-b border-slate-200 p-0" title={tip || undefined}>
                      {canSplit && (
                        <button type="button" tabIndex={-1} onClick={() => setSplit({ employeeId: r.id, fullName: r.fullName, amount: toNum(vals[key] ?? "") })}
                          title="Oylarga bo'lish — necha oyda va qaysi oydan ushlanadi" aria-label={`${r.fullName} — qarzni oylarga bo'lish`}
                          className="absolute top-1/2 left-1 z-[1] -translate-y-1/2 rounded p-1 text-brand-700 hover:bg-brand-100">
                          <CalendarRange size={14} />
                        </button>
                      )}
                      <input data-r={ri} data-c={ci} value={vals[key] ?? ""} disabled={!editable} inputMode="decimal" autoComplete="off"
                        placeholder={au ? fmtNum(au) : sug ? fmtNum(sug) : ""} aria-label={`${r.fullName} — ${c.label}`}
                        onChange={(e) => { setVals((p) => ({ ...p, [key]: e.target.value })); dirty.current.add(key); schedule(); }}
                        onFocus={(e) => e.currentTarget.select()} onBlur={() => void flush()}
                        onKeyDown={(e) => onKey(e, ri, ci)} onPaste={(e) => onPaste(e, ri, ci)}
                        className={cn("h-9 w-full bg-transparent px-2 text-right outline-none placeholder:text-slate-400 placeholder:italic focus:bg-brand-50 focus:ring-2 focus:ring-brand-500 focus:ring-inset disabled:cursor-not-allowed",
                          canSplit && "pl-8",
                          !vals[key] && (au ? "bg-sky-50/60 placeholder:font-medium placeholder:text-sky-700 placeholder:not-italic" : r.hints[c.key] && "bg-amber-50/40"))} />
                    </td>
                  );
                })}
                <td className="border-b border-slate-200 bg-red-50/40 px-2 text-right font-semibold">{rowTotal(r) ? fmtNum(rowTotal(r)) : ""}</td>
              </tr>
              </Fragment>
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
      {split && (
        <SplitDialog month={data.month} target={split} onClose={() => setSplit(null)}
          onSplit={async (months, startMonth) => {
            await flush(); // katakdagi summa avval saqlansin — bo'lish uni bekor qiladi
            const r = await splitLoanAction({ month: data.month, employeeId: split.employeeId, amount: String(split.amount), months, startMonth });
            if (r.error) return r.error;
            const key = k(split.employeeId, "LOAN");
            dirty.current.delete(key);
            setVals((p) => { const o = { ...p }; delete o[key]; return o; });
            setSplit(null);
            router.refresh();
            return null;
          }} />
      )}
    </div>
  );
}

/**
 * «Qarz to'lovi» summasini oylarga bo'lish: necha oy va qaysi oy oyligidan boshlab — jadval oldindan ko'rinadi
 * (minglikka yaxlitlangan teng ulush, oxirgisi qoldiq). Tasdiqlansa summa xodim qarziga aylanadi, har oy avtomatik ushlanadi.
 */
function SplitDialog({ month, target, onClose, onSplit }: {
  month: string; target: { fullName: string; amount: number }; onClose: () => void;
  onSplit: (months: number, startMonth: string) => Promise<string | null>;
}) {
  const [months, setMonths] = useState("3");
  const [start, setStart] = useState(month);
  const [err, setErr] = useState("");
  const [pending, run] = useTransition();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const n = Math.trunc(Number(months));
  const valid = Number.isFinite(n) && n >= 1 && n <= 60;
  const plan = valid ? Array.from({ length: n }, (_, i) => ({ m: shiftMonth(start, i), sum: installment(target.amount, n, i + 1) })) : [];
  const starts = Array.from({ length: 13 }, (_, i) => shiftMonth(month, i));
  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <form role="dialog" aria-label="Qarzni oylarga bo'lish" onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) { setErr("Oylar soni 1 dan 60 gacha"); return; }
          run(async () => { const r = await onSplit(n, start); if (r) setErr(r); });
        }}
        className="w-full max-w-md space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Qarzni oylarga bo&apos;lish</h2>
            <p className="text-sm text-slate-600">{target.fullName} · <span className="font-semibold text-slate-900">{fmtNum(target.amount)}</span></p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Necha oyga bo'linadi">
            <Input type="number" min={1} max={60} value={months} onChange={(e) => setMonths(e.target.value)} autoFocus required />
          </Field>
          <Field label="Qaysi oy oyligidan">
            <Select value={start} onChange={(e) => setStart(e.target.value)}>
              {starts.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
            </Select>
          </Field>
        </div>
        {plan.length > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm tabular">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-1.5 text-left font-medium">Oylik</th><th className="px-3 py-1.5 text-right font-medium">Ushlanadi</th></tr></thead>
              <tbody>
                {plan.map((p, i) => <tr key={p.m} className="border-t border-slate-100"><td className="px-3 py-1">{i + 1}. {monthTitle(p.m)}</td><td className="px-3 py-1 text-right font-medium">{fmtNum(p.sum)}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">Summa xodim qarziga yoziladi («Xodim qarzlari»da ko&apos;rinadi), har oy ulushi oy yakuni vedomostida avtomatik ushlanadi (jadvalda ko&apos;k). Katakdagi shu oy yozuvi o&apos;rniga jadval ishlaydi.</p>
        <FormError error={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button disabled={pending || !valid}><CalendarRange size={16} /> {pending ? "Saqlanmoqda…" : `${valid ? n : ""} oyga bo'lish`}</Button>
        </div>
      </form>
    </div>
  ), document.body);
}
