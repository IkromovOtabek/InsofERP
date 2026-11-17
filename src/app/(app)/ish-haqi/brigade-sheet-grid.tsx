"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum, numText } from "@/lib/format";
import { calcBrigadeSheet, type SheetLine } from "@/lib/hr/brigade-calc";
import type { BrigadeSheetData } from "@/lib/hr/brigade-sheet";
import { Button, Input, Select } from "@/components/ui";
import { saveBrigadeHoursAction, saveBrigadeMonthAction, saveBrigadeOutputAction } from "./tabel-actions";

/**
 * Brigada varag'i — Excel'dagi brigada varag'i kabi:
 *   tepada a'zolar × kun (shu brigadadagi soat) va har birining puli; pastda mahsulot qatorlari × kun (soni) va narx.
 * Kunlik fond = Σ soni × narx, shu kungi soatga qarab bo'linadi; oy jami 10 000 ga yaxlitlanadi; brak soatga qarab.
 * Hisob jonli (`lib/hr/brigade-calc.ts` — vedomost ham shu bilan hisoblaydi). O'zgarish o'zi saqlanadi.
 */

const SAVE_DELAY = 700;
const SEP = "\u0001";
type Msg = { tone: "error" | "warn"; text: string } | null;

const toNum = (v: string) => { const t = numText(v.trim()); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n > 0 ? n : null; };

export function BrigadeSheetGrid({ data, canEdit }: { data: BrigadeSheetData; canEdit: boolean }) {
  const editable = canEdit && !data.locked;
  const nDays = data.days.length;
  const initH = useCallback(() => {
    const o: Record<string, string> = {};
    for (const [emp, m] of Object.entries(data.hours)) for (const [d, h] of Object.entries(m)) o[`${emp}:${d}`] = String(h);
    return o;
  }, [data]);
  const initQ = useCallback(() => {
    const o: Record<string, string> = {};
    for (const [line, m] of Object.entries(data.qty)) for (const [d, q] of Object.entries(m)) o[`${line}${SEP}${d}`] = String(q);
    return o;
  }, [data]);
  const [hv, setHv] = useState(initH);
  const [qv, setQv] = useState(initQ);
  const [lines, setLines] = useState<(SheetLine & { was?: string })[]>(data.lines);
  const [brakTxt, setBrakTxt] = useState(data.brakManual != null ? String(data.brakManual) : "");
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState<Msg>(null);
  const dirtyH = useRef(new Set<string>());
  const dirtyQ = useRef(new Set<string>());
  const hvRef = useRef(hv); hvRef.current = hv;
  const qvRef = useRef(qv); qvRef.current = qv;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Server yangilasa — saqlanmaganlardan boshqasi serverdagidek
  useEffect(() => {
    const h = initH(), q = initQ();
    setHv((p) => { const o = { ...h }; for (const k of dirtyH.current) if (k in p) o[k] = p[k]!; return o; });
    setQv((p) => { const o = { ...q }; for (const k of dirtyQ.current) if (k in p) o[k] = p[k]!; return o; });
    setLines(data.lines);
    setBrakTxt(data.brakManual != null ? String(data.brakManual) : "");
  }, [data, initH, initQ]);

  const run = useCallback(async <T extends { error?: string; skipped?: string[] }>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy((n) => n + 1);
    let r: T | null = null;
    try { r = await fn(); } catch { setMsg({ tone: "error", text: "Saqlanmadi — internet yoki sessiyani tekshiring" }); }
    setBusy((n) => n - 1);
    if (r?.error) setMsg({ tone: "error", text: r.error });
    else if (r?.skipped?.length) setMsg({ tone: "warn", text: `Yozilmadi: ${r.skipped.slice(0, 3).join("; ")}` });
    return r;
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const hk = [...dirtyH.current], qk = [...dirtyQ.current];
    dirtyH.current.clear(); dirtyQ.current.clear();
    if (hk.length) {
      const items = hk.map((k) => { const [employeeId, d] = k.split(":"); return { employeeId: employeeId!, day: Number(d), value: hvRef.current[k] ?? "" }; });
      const r = await run(() => saveBrigadeHoursAction(data.month, data.brigade.id, items));
      if (!r || r.error) for (const k of hk) dirtyH.current.add(k);
    }
    if (qk.length) {
      const items = qk.map((k) => { const [line, d] = k.split(SEP); return { line: line!, day: Number(d), value: qvRef.current[k] ?? "" }; });
      const r = await run(() => saveBrigadeOutputAction(data.month, data.brigade.id, items));
      if (!r || r.error) for (const k of qk) dirtyQ.current.add(k);
    }
  }, [data.month, data.brigade.id, run]);
  const schedule = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), SAVE_DELAY); }, [flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const saveMonth = async (next: (SheetLine & { was?: string })[], brak: string) => {
    const b = brak.trim() ? Number(numText(brak)) : null;
    if (b != null && !Number.isFinite(b)) { setMsg({ tone: "error", text: "Brak summasi noto'g'ri" }); return; }
    const r = await run(() => saveBrigadeMonthAction(data.month, data.brigade.id, { lines: next.map((l) => ({ name: l.name, rate: l.rate, productId: l.productId ?? null, was: l.was })), brak: b }));
    if (r && !r.error) { setLines(next.map((l) => ({ name: l.name, rate: l.rate, productId: l.productId ?? null }))); setMsg(null); }
  };

  const members = useMemo(() => {
    const add = extra.map((id) => data.addable.find((a) => a.id === id)).filter((x): x is NonNullable<typeof x> => !!x)
      .map((a) => ({ id: a.id, fullName: a.fullName, position: a.position, payType: "", guest: true, from: 1, to: nDays }));
    return [...data.members, ...add];
  }, [data, extra, nDays]);

  const calc = useMemo(() => {
    const hours: Record<string, (number | null)[]> = {};
    for (const m of members) hours[m.id] = Array.from({ length: nDays }, (_, i) => toNum(hv[`${m.id}:${i + 1}`] ?? ""));
    const brak = brakTxt.trim() ? Number(numText(brakTxt)) || 0 : data.brakAuto;
    return calcBrigadeSheet({
      days: nDays, hours, brak,
      lines: lines.map((l) => ({ ...l, qty: Array.from({ length: nDays }, (_, i) => toNum(qv[`${l.name}${SEP}${i + 1}`] ?? "")) })),
    });
  }, [members, hv, qv, lines, brakTxt, data.brakAuto, nDays]);

  const dayOk = (d: number, from = 1, to = nDays) => editable && !data.days[d - 1]?.future && d >= from && d <= to;

  // Klaviatura: ↑↓ — qator, ←→ — kun (matn chetida), Enter — pastga; Excel'dan blok joylash
  const focus = (g: string, r: number, d: number) => {
    const el = rootRef.current?.querySelector<HTMLInputElement>(`input[data-g="${g}"][data-r="${r}"][data-d="${d}"]`);
    if (el) { el.focus(); el.select(); }
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, g: string, r: number, d: number, rows: number) => {
    const el = e.currentTarget;
    const mv: [number, number] | null = e.key === "ArrowUp" ? [-1, 0] : e.key === "ArrowDown" || e.key === "Enter" ? [1, 0]
      : e.key === "ArrowLeft" && el.selectionStart === 0 ? [0, -1] : e.key === "ArrowRight" && el.selectionEnd === el.value.length ? [0, 1] : null;
    if (!mv) return;
    e.preventDefault();
    focus(g, Math.min(rows - 1, Math.max(0, r + mv[0])), Math.min(nDays, Math.max(1, d + mv[1])));
  };
  const paste = (e: React.ClipboardEvent<HTMLInputElement>, keyOf: (r: number, d: number) => string | null, r0: number, d0: number, setter: typeof setHv, dirty: Set<string>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/\n$/, ""))) return;
    e.preventDefault();
    const next: Record<string, string> = {};
    text.replace(/\r/g, "").replace(/\n$/, "").split("\n").forEach((line, i) => line.split("\t").forEach((v, j) => {
      const k = keyOf(r0 + i, d0 + j);
      if (k) next[k] = v.trim();
    }));
    setter((p) => ({ ...p, ...next }));
    for (const k of Object.keys(next)) dirty.add(k);
    void flush();
  };

  const [newLine, setNewLine] = useState({ name: "", rate: "" });
  const [addEmp, setAddEmp] = useState("");
  const brakUsed = brakTxt.trim() ? Number(numText(brakTxt)) || 0 : data.brakAuto;

  const cellCls = "h-8 w-full min-w-9 bg-transparent px-0.5 text-center outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-500 focus:ring-inset disabled:cursor-not-allowed";
  const th = "border-r border-b border-slate-300 bg-slate-100 px-1 py-1.5 text-center font-semibold";
  const dayTh = (d: BrigadeSheetData["days"][number]) => cn(th, "w-9 min-w-9 px-0", d.weekend && "bg-sky-100 text-sky-800", d.future && "text-slate-400");

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
        <span>Kunlik fond = Σ soni × narx → shu kungi soatga bo&apos;linadi; oy jami 10 000 ga yaxlitlanadi; brak soatga qarab.</span>
        {data.inherited && <span className="text-amber-700">Qatorlar va narxlar o&apos;tgan oydan — o&apos;zgartirsangiz shu oy uchun saqlanadi.</span>}
        <span className="ml-auto flex items-center gap-1">{busy > 0 ? <><Loader2 size={13} className="animate-spin" /> Saqlanmoqda…</> : editable ? <><Check size={13} className="text-emerald-600" /> Saqlangan</> : "Faqat ko'rish"}</span>
      </div>
      {msg && (
        <div className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs", msg.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800")}>
          <span>{msg.text}</span><button type="button" className="opacity-70 hover:underline" onClick={() => setMsg(null)}>Yopish</button>
        </div>
      )}
      {calc.lost > 0 && <p className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={13} /> {fmtNum(Math.round(calc.lost))} so&apos;m fond soat yozilmagan kunlarda — hech kimga tushmadi.</p>}

      {/* A'zolar × kun — soat */}
      <div className="relative max-w-full overflow-auto overscroll-contain rounded-(--radius-card) border border-slate-300/80 bg-white shadow-(--shadow-card)" style={{ maxHeight: "calc(100dvh - 340px)", minHeight: 260 }}>
        <table lang="ru" className="border-separate border-spacing-0 font-(family-name:--font-inter) text-[12px] tabular text-slate-800">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className={cn(th, "sticky left-0 z-30 w-8")}>№</th>
              <th className={cn(th, "sticky left-8 z-30 min-w-52 text-left")}>F.I.O. — soat</th>
              {data.days.map((d) => <th key={d.day} className={dayTh(d)}>{d.day}</th>)}
              <th className={cn(th, "bg-emerald-50 px-2 text-right")}>Soat</th>
              <th className={cn(th, "bg-emerald-50 px-2 text-right")}>Kun</th>
              <th className={cn(th, "px-2 text-right")} title="Σ kunlik ulush (yaxlitlanmagan)">Ulush</th>
              <th className={cn(th, "bg-amber-50 px-2 text-right")} title="10 000 ga yaxlitlangan">Hisoblandi</th>
              <th className={cn(th, "bg-red-50 px-2 text-right")}>Brak</th>
              <th className="border-b border-slate-300 bg-emerald-100 px-2 py-1.5 text-right font-semibold">Summa</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m, ri) => {
              const c = calc.emp[m.id];
              return (
                <tr key={m.id}>
                  <td className="sticky left-0 z-10 border-r border-b border-slate-200 bg-white px-1 text-center text-slate-500">{ri + 1}</td>
                  <td className="sticky left-8 z-10 border-r border-b border-slate-200 bg-white px-2 py-0.5">
                    <div className="truncate font-medium text-slate-900" title={m.fullName}>{m.fullName}</div>
                    <div className="truncate text-[11px] text-slate-500">{m.position}{m.guest ? " · boshqa brigadadan" : ""}</div>
                  </td>
                  {data.days.map((d) => {
                    const k = `${m.id}:${d.day}`;
                    return (
                      <td key={d.day} className={cn("border-r border-b border-slate-200 p-0", d.weekend && "bg-sky-50/70", !dayOk(d.day, m.from, m.to) && "bg-slate-50")}>
                        <input data-g="h" data-r={ri} data-d={d.day} value={hv[k] ?? ""} disabled={!dayOk(d.day, m.from, m.to)} inputMode="decimal" autoComplete="off" aria-label={`${m.fullName}, ${d.day}-kun soati`}
                          onChange={(e) => { setHv((p) => ({ ...p, [k]: e.target.value })); dirtyH.current.add(k); schedule(); }}
                          onFocus={(e) => e.currentTarget.select()} onBlur={() => void flush()}
                          onKeyDown={(e) => onKey(e, "h", ri, d.day, members.length)}
                          onPaste={(e) => paste(e, (r, dd) => { const mm = members[r]; return mm && dd <= nDays && dayOk(dd, mm.from, mm.to) ? `${mm.id}:${dd}` : null; }, ri, d.day, setHv, dirtyH.current)}
                          className={cellCls} />
                      </td>
                    );
                  })}
                  <td className="border-r border-b border-slate-200 bg-emerald-50/50 px-2 text-right font-semibold">{c?.hours ? fmtNum(c.hours, 2) : ""}</td>
                  <td className="border-r border-b border-slate-200 bg-emerald-50/50 px-2 text-right">{c?.hours ? fmtNum(c.hours / 8, 2) : ""}</td>
                  <td className="border-r border-b border-slate-200 px-2 text-right text-slate-500">{c?.raw ? fmtNum(Math.round(c.raw)) : ""}</td>
                  <td className="border-r border-b border-slate-200 bg-amber-50/40 px-2 text-right">{c?.amount ? fmtNum(c.amount) : ""}</td>
                  <td className="border-r border-b border-slate-200 bg-red-50/40 px-2 text-right text-red-700">{c?.brak ? fmtNum(c.brak) : ""}</td>
                  <td className="border-b border-slate-200 bg-emerald-50 px-2 text-right font-semibold text-slate-900">{c && (c.amount || c.brak) ? fmtNum(c.net) : ""}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 font-semibold text-slate-900">
            <tr>
              <td className="sticky left-0 z-30 border-t-2 border-r border-slate-300 bg-slate-100" />
              <td className="sticky left-8 z-30 border-t-2 border-r border-slate-300 bg-slate-100 px-2 py-1">Jami soat</td>
              {calc.dayHours.map((h, i) => <td key={i} className="border-t-2 border-r border-slate-300 bg-slate-100 text-center text-[11px]">{h ? fmtNum(h) : ""}</td>)}
              <td className="border-t-2 border-r border-slate-300 bg-emerald-100 px-2 text-right">{fmtNum(calc.total.hours, 2)}</td>
              <td className="border-t-2 border-r border-slate-300 bg-emerald-100 px-2 text-right">{fmtNum(calc.total.hours / 8, 2)}</td>
              <td className="border-t-2 border-r border-slate-300 bg-slate-100 px-2 text-right">{fmtNum(Math.round(calc.total.raw))}</td>
              <td className="border-t-2 border-r border-slate-300 bg-amber-100 px-2 text-right">{fmtNum(calc.total.amount)}</td>
              <td className="border-t-2 border-r border-slate-300 bg-red-50 px-2 text-right text-red-700">{fmtNum(calc.total.brak)}</td>
              <td className="border-t-2 border-slate-300 bg-emerald-100 px-2 text-right">{fmtNum(calc.total.net)}</td>
            </tr>
            <tr>
              <td className="sticky left-0 z-30 border-r border-slate-300 bg-amber-50" />
              <td className="sticky left-8 z-30 border-r border-slate-300 bg-amber-50 px-2 py-1">Kunlik fond</td>
              {calc.pool.map((p, i) => <td key={i} className={cn("border-r border-slate-300 bg-amber-50 text-center text-[10px] font-normal", p > 0 && !calc.dayHours[i] && "bg-red-100 text-red-700")} title={p ? fmtNum(Math.round(p)) : undefined}>{p ? fmtNum(Math.round(p / 1000)) : ""}</td>)}
              <td colSpan={6} className="bg-amber-50 px-2 text-right">fond {fmtNum(Math.round(calc.total.pool))} <span className="font-normal text-slate-500">(kunlikda — ming so&apos;m)</span></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {editable && data.addable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={addEmp} onChange={(e) => setAddEmp(e.target.value)} className="h-9 w-auto min-w-64" aria-label="Boshqa brigadadan xodim">
            <option value="">— boshqa brigadadan xodim (shu oyda ishlagan) —</option>
            {data.addable.filter((a) => !extra.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.fullName} · {a.position}</option>)}
          </Select>
          <Button type="button" variant="secondary" size="sm" disabled={!addEmp} onClick={() => { setExtra((x) => [...x, addEmp]); setAddEmp(""); }}><Plus size={14} /> Qatorga qo&apos;shish</Button>
          <span className="text-xs text-slate-500">Soati yozilgach saqlanadi.</span>
        </div>
      )}

      {/* Mahsulot qatorlari × kun — soni */}
      <div className="relative max-w-full overflow-auto rounded-(--radius-card) border border-slate-300/80 bg-white shadow-(--shadow-card)">
        <table lang="ru" className="border-separate border-spacing-0 font-(family-name:--font-inter) text-[12px] tabular text-slate-800">
          <thead>
            <tr>
              <th className={cn(th, "sticky left-0 z-20 min-w-60 text-left")}>Mahsulot — soni (dona / m³)</th>
              <th className={cn(th, "min-w-24 text-right")}>Narx</th>
              {data.days.map((d) => <th key={d.day} className={dayTh(d)}>{d.day}</th>)}
              <th className={cn(th, "bg-emerald-50 px-2 text-right")}>Soni</th>
              <th className="border-b border-slate-300 bg-amber-50 px-2 py-1.5 text-right font-semibold">Summa</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, li) => {
              const total = Array.from({ length: nDays }, (_, i) => toNum(qv[`${l.name}${SEP}${i + 1}`] ?? "") ?? 0).reduce((s, x) => s + x, 0);
              return (
                <tr key={l.name}>
                  <td className="sticky left-0 z-10 border-r border-b border-slate-200 bg-white px-1">
                    <input defaultValue={l.name} disabled={!editable} aria-label="Qator nomi" className="h-8 w-full bg-transparent px-1 font-medium text-slate-900 outline-none focus:bg-brand-50"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) void saveMonth(lines.map((x, i) => (i === li ? { ...x, name: v, was: x.name } : x)), brakTxt); else e.target.value = l.name; }} />
                  </td>
                  <td className="border-r border-b border-slate-200 p-0">
                    <input defaultValue={l.rate ? String(l.rate) : ""} disabled={!editable} inputMode="decimal" aria-label={`${l.name} narxi`} className="h-8 w-full bg-transparent px-1 text-right outline-none focus:bg-brand-50"
                      onBlur={(e) => { const r = Number(numText(e.target.value)) || 0; if (r !== l.rate) void saveMonth(lines.map((x, i) => (i === li ? { ...x, rate: r } : x)), brakTxt); }} />
                  </td>
                  {data.days.map((d) => {
                    const k = `${l.name}${SEP}${d.day}`;
                    return (
                      <td key={d.day} className={cn("border-r border-b border-slate-200 p-0", d.weekend && "bg-sky-50/70", !dayOk(d.day) && "bg-slate-50")}>
                        <input data-g="q" data-r={li} data-d={d.day} value={qv[k] ?? ""} disabled={!dayOk(d.day)} inputMode="decimal" autoComplete="off" aria-label={`${l.name}, ${d.day}-kun soni`}
                          onChange={(e) => { setQv((p) => ({ ...p, [k]: e.target.value })); dirtyQ.current.add(k); schedule(); }}
                          onFocus={(e) => e.currentTarget.select()} onBlur={() => void flush()}
                          onKeyDown={(e) => onKey(e, "q", li, d.day, lines.length)}
                          onPaste={(e) => paste(e, (r, dd) => (lines[r] && dd <= nDays && dayOk(dd) ? `${lines[r]!.name}${SEP}${dd}` : null), li, d.day, setQv, dirtyQ.current)}
                          className={cellCls} />
                      </td>
                    );
                  })}
                  <td className="border-r border-b border-slate-200 bg-emerald-50/50 px-2 text-right font-semibold">{total ? fmtNum(total, 3) : ""}</td>
                  <td className="border-b border-slate-200 bg-amber-50/40 px-2 text-right">{total ? fmtNum(Math.round(total * l.rate)) : ""}</td>
                </tr>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={nDays + 4} className="px-3 py-6 text-center text-slate-500">Mahsulot qatori yo&apos;q — pastdan qo&apos;shing (masalan: Plita 63-12, narx 90 909) yoki Excel&apos;dan import qiling</td></tr>}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <Input value={newLine.name} onChange={(e) => setNewLine((x) => ({ ...x, name: e.target.value }))} placeholder="Yangi qator: mahsulot nomi" className="h-9 w-64" />
          <Input value={newLine.rate} onChange={(e) => setNewLine((x) => ({ ...x, rate: e.target.value }))} placeholder="Narx (1 dona/m³)" inputMode="decimal" className="h-9 w-40" />
          <Button type="button" variant="secondary" size="sm" disabled={!newLine.name.trim()} onClick={() => { void saveMonth([...lines, { name: newLine.name.trim(), rate: Number(numText(newLine.rate)) || 0 }], brakTxt); setNewLine({ name: "", rate: "" }); }}><Plus size={14} /> Qator qo&apos;shish</Button>
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            Brak (oy, so&apos;m):
            <Input value={brakTxt} onChange={(e) => setBrakTxt(e.target.value)} onBlur={() => { const cur = data.brakManual != null ? String(data.brakManual) : ""; if (brakTxt.trim() !== cur) void saveMonth(lines, brakTxt); }}
              placeholder={`yozuvlardan: ${fmtNum(data.brakAuto)}`} inputMode="decimal" className="h-9 w-44" title="Bo'sh qoldirilsa — brak yozuvlari (Brigadalar → Brak) yig'indisi" />
          </label>
          <span className="text-xs text-slate-500">Hisobda: {fmtNum(brakUsed)}</span>
        </div>
      )}
    </div>
  );
}
