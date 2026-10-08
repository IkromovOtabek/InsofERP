"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, RefreshCw, Search } from "lucide-react";
import { Button, Card, Field, FormError, Input, Select } from "@/components/ui";
import { LOG_FILTER_MAX, LOG_PRIORITIES } from "@/lib/control/devops/contract";
import { ACTION_STATUS, dt, type ActionStatusT } from "@/lib/control/monitor/shared";
import { ActionStatusBadge } from "../_monitor/bits";
import { logResult, requestLogs } from "./actions";
import { HelpButton } from "../_help/help";

export type SourceOpt = { value: string; label: string; group: string; unit: boolean };
const LINES = ["50", "100", "200", "500"];
const POLL_MS = 1200;
const WAIT_MS = 90_000;

/**
 * Log ko'ruvchi: manba/qatorlar/daraja/filtr → LOG_TAIL amali → natija kelguncha so'rab turadi (≤ 90 s).
 * «Qidiruv» — kelgan natija ichida (brauzerda) qatorlarni saralaydi va belgilaydi; «Filtr» — agentda (ko'proq qatordan).
 */
export function LogsClient({ sources, initial }: { sources: SourceOpt[]; initial: string }) {
  const [source, setSource] = useState(initial);
  const [lines, setLines] = useState("200");
  const [priority, setPriority] = useState("");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>();
  const [res, setRes] = useState<{ status: ActionStatusT; output: string | null; finishedAt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const run = useRef(0);
  const isUnit = sources.find((s) => s.value === source)?.unit ?? false;

  const load = useCallback(async () => {
    const my = ++run.current;
    setLoading(true); setErr(undefined);
    try {
      const r = await requestLogs({ source, lines, filter, priority: isUnit ? priority : "" });
      if (!r.id) { setErr(r.error ?? "So'rov qo'yilmadi"); return; }
      const t0 = Date.now();
      while (run.current === my && Date.now() - t0 < WAIT_MS) {
        await new Promise((ok) => setTimeout(ok, POLL_MS));
        const x = await logResult(r.id);
        if ("error" in x) { setErr(x.error); return; }
        if (x.status !== "PENDING" && x.status !== "RUNNING") { if (run.current === my) setRes(x); return; }
      }
      if (run.current === my) setErr("Agent javob bermadi (90 s) — «Server» sahifasida agent holatini tekshiring");
    } catch {
      setErr("Tarmoq xatosi — qayta urinib ko'ring");
    } finally {
      if (run.current === my) setLoading(false);
    }
  }, [source, lines, filter, priority, isUnit]);

  // Manba o'zgarganda avtomatik yuklash (birinchi ochilishda ham)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [source]);
  useEffect(() => () => { run.current++; }, []);

  const all = useMemo(() => (res?.output ?? "").split("\n"), [res]);
  const q = search.trim().toLowerCase();
  const shown = useMemo(() => (q ? all.filter((l, i) => i === 0 || l.toLowerCase().includes(q)) : all), [all, q]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(shown.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setErr("Nusxa olib bo'lmadi (brauzer ruxsati)"); }
  };
  const groups = [...new Set(sources.map((s) => s.group))];

  return (
    <div className="space-y-4">
      <Card>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.4fr_2fr_auto] lg:items-end" onSubmit={(e) => { e.preventDefault(); void load(); }}>
          <Field label="Manba" help={<HelpButton topic="log:source" />}>
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {sources.filter((s) => s.group === g).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Qatorlar">
            <Select value={lines} onChange={(e) => setLines(e.target.value)}>{LINES.map((l) => <option key={l} value={l}>{l}</option>)}</Select>
          </Field>
          <Field label="Daraja (journald)" help={<HelpButton topic="log:priority" />}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)} disabled={!isUnit}>
              <option value="">Hammasi</option>
              {Object.entries(LOG_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Filtr (agentda, oddiy matn)" help={<HelpButton topic="log:filter" />}>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} maxLength={LOG_FILTER_MAX} placeholder="masalan: error, 502, POST /api" autoComplete="off" spellCheck={false} />
          </Field>
          <span className="flex items-center gap-0.5 sm:col-span-2 lg:col-span-1"><Button type="submit" disabled={loading} className="flex-1"><RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden /> {loading ? "Yuklanmoqda…" : "Yangilash"}</Button><HelpButton topic="action:LOG_TAIL" /></span>
        </form>
        <FormError error={err} />
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          {res ? <ActionStatusBadge s={res.status} /> : <span className="text-sm text-slate-500">{loading ? "Agent o'qimoqda…" : "Natija yo'q"}</span>}
          {res?.finishedAt && <span className="text-xs text-slate-500 tabular" data-no-translit>{dt(res.finishedAt)}</span>}
          {res && <span className="text-xs text-slate-500">{q ? `${Math.max(0, shown.length - 1)} / ${Math.max(0, all.length - 1)} qator` : `${Math.max(0, all.length - 1)} qator`}</span>}
          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Natija ichida qidirish" aria-label="Natija ichida qidirish" className="pl-8" />
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={copy} disabled={!res?.output}>{copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Olindi" : "Nusxa"}</Button>
          </div>
        </div>
        <pre className="max-h-[70vh] min-h-40 overflow-auto whitespace-pre-wrap break-all bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100" data-no-translit aria-live="polite">
          {res ? (res.output ? shown.map((l, i) => <Line key={i} text={l} q={q} first={i === 0} />) : `(chiqish yo'q — ${ACTION_STATUS[res.status]?.label ?? res.status})`) : ""}
        </pre>
      </Card>
    </div>
  );
}

function Line({ text, q, first }: { text: string; q: string; first: boolean }) {
  const lvl = /\b(error|err|crit|fatal|emerg|alert|xato|✗)\b/i.test(text) ? "text-red-300" : /\b(warn|warning|⚠)\b/i.test(text) ? "text-amber-200" : first ? "text-slate-400" : "";
  if (!q) return <div className={lvl}>{text || " "}</div>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <div className={lvl}>{text || " "}</div>;
  return <div className={lvl}>{text.slice(0, i)}<mark className="rounded bg-amber-300 px-0.5 text-slate-900">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</div>;
}
