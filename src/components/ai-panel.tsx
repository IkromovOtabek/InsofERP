"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, X, Maximize2, Trash2, Send, ChevronDown, Zap, Bot, ExternalLink, LayoutDashboard, Wallet, Target, Boxes, Landmark, Users, BadgeCheck, TrendingUp, Megaphone, HelpCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* Team24 AI panelining Insof ERP uchun nusxasi:
   • header'dagi trigger (Ctrl+K) → o'ngdan chiqadigan panel
   • tez savollar katalogi (0 token, qoida asosida) + erkin savol (Claude, kalit bo'lsa)
   • kontekst = joriy sahifadagi davr (URL: period/from/to) avtomatik yuboriladi */

type Q = { id: string; text: string };
type Group = { key: string; label: string; icon: string; questions: Q[] };
type Answer = { key: string; text: string; bullets?: string[]; href?: { label: string; href: string } };
type Msg = { role: "user" | "assistant"; text: string; answer?: Answer; level?: number; latency?: number; error?: boolean };

const GROUP_ICON: Record<string, LucideIcon> = { dashboard: LayoutDashboard, payments: Wallet, track_changes: Target, inventory_2: Boxes, account_balance: Landmark, groups: Users, badge: BadgeCheck, auto_graph: TrendingUp, campaign: Megaphone, help_outline: HelpCircle };
const OPEN_EVENT = "insof-ai-open";
const ASK_EVENT = "insof-ai-ask";

/** Boshqa komponentlardan panelni ochish / savol yuborish ("Nega?" tugmalari uchun). */
export const openAiPanel = () => window.dispatchEvent(new CustomEvent(OPEN_EVENT));
export const askAi = (question: string) => window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { question } }));

/** Joriy sahifadagi davr parametrlari — panel shu kesimda javob beradi. */
function currentSp() {
  const u = new URLSearchParams(window.location.search); const sp: Record<string, string> = {};
  for (const k of ["period", "from", "to"]) { const v = u.get(k); if (v) sp[k] = v; }
  return sp;
}

/* Juda cheklangan markdown: **qalin** va qator ko'chirish. Qolgani escape — javob LLM'dan kelishi mumkin (XSS). */
function md(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}

export function AiTrigger({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openAiPanel} title="Insof AI (Ctrl+K)"
      className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-600 shadow-xs transition-colors hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-400", className)}>
      <Sparkles size={15} className="text-brand-500" />
      <span className="hidden sm:inline">Insof AI</span>
      <kbd className="hidden rounded border border-slate-200 px-1 text-[10px] font-medium text-slate-400 md:inline">Ctrl K</kbd>
    </button>
  );
}

export function AiPanel({ period }: { period?: string }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [llm, setLlm] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const [ctxLabel, setCtxLabel] = useState(period ?? "");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Katalog bir marta yuklanadi
  useEffect(() => {
    fetch("/api/ai").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setGroups(d.groups); setLlm(Boolean(d.llm)); setOpenGroup(d.groups[0]?.key ?? null); } }).catch(() => {});
  }, []);

  const scrollDown = () => requestAnimationFrame(() => { const b = listRef.current; if (b) b.scrollTop = b.scrollHeight; });

  const ask = useCallback(async (payload: { mode: "quick"; key: string; text: string } | { mode: "chat"; text: string }) => {
    setMsgs((m) => [...m, { role: "user", text: payload.text }]);
    setLoading(true); setShowQuick(false); scrollDown();
    try {
      const history = msgs.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      const body = payload.mode === "quick" ? { mode: "quick", key: payload.key, sp: currentSp() } : { mode: "chat", question: payload.text, history, sp: currentSp() };
      const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.answer) throw new Error(d.error || r.statusText);
      if (d.period) setCtxLabel(d.period);
      setMsgs((m) => [...m, { role: "assistant", text: d.answer.text, answer: d.answer, level: d.level, latency: d.latency }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "Serverga ulanib bo'lmadi. Internet yoki server holatini tekshiring.", error: true }]);
    } finally { setLoading(false); scrollDown(); }
  }, [msgs]);

  const send = useCallback((text?: string) => {
    const q = (text ?? input).trim(); if (!q || loading) return;
    setInput(""); ask({ mode: "chat", text: q });
  }, [input, loading, ask]);

  // Ctrl+K / Esc / tashqi hodisalar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen((o) => !o);
    const onAsk = (e: Event) => { const q = (e as CustomEvent<{ question: string }>).detail?.question; if (q) { setOpen(true); send(q); } };
    document.addEventListener("keydown", onKey); window.addEventListener(OPEN_EVENT, onOpen); window.addEventListener(ASK_EVENT, onAsk);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_EVENT, onOpen); window.removeEventListener(ASK_EVENT, onAsk); };
  }, [send]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  const quick = (
    <div className="mt-3 space-y-1.5">
      {groups.map((g) => {
        const Icon = GROUP_ICON[g.icon] ?? HelpCircle; const isOpen = openGroup === g.key;
        return (
          <div key={g.key} className={cn("overflow-hidden rounded-lg border bg-white transition-colors", isOpen ? "border-brand-500/40" : "border-slate-200")}>
            <button type="button" onClick={() => setOpenGroup(isOpen ? null : g.key)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-semibold text-slate-900 hover:bg-slate-50">
              <Icon size={16} className="text-brand-500" />
              <span className="flex-1">{g.label}</span>
              <span className="min-w-5 rounded-full border border-slate-200 bg-slate-50 px-1.5 text-center text-[10.5px] font-medium text-slate-500">{g.questions.length}</span>
              <ChevronDown size={16} className={cn("text-slate-400 transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
                {g.questions.map((q) => (
                  <button key={q.id} type="button" disabled={loading} onClick={() => ask({ mode: "quick", key: q.id, text: q.text })}
                    className="group flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left text-[12.5px] leading-snug text-slate-800 transition hover:border-brand-500 hover:bg-slate-50 disabled:opacity-50">
                    <span className="flex-1">{q.text}</span>
                    <Zap size={12} className="shrink-0 text-amber-500 opacity-40 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {open && <div className="fixed inset-0 z-[60] bg-slate-900/35 backdrop-blur-[1px] dark:bg-black/50" onClick={() => setOpen(false)} />}
      <aside aria-hidden={!open} className={cn("fixed inset-y-0 right-0 z-[70] flex w-[440px] max-w-[100vw] flex-col border-l border-slate-200 bg-white shadow-(--shadow-pop) transition-transform duration-200 ease-out", open ? "translate-x-0" : "translate-x-full")}>
        {/* Sarlavha */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-slate-900"><Sparkles size={18} className="text-brand-500" /> Insof AI</div>
            {ctxLabel && <div className="mt-0.5 text-[11px] text-slate-500">{ctxLabel}</div>}
          </div>
          <div className="flex gap-1">
            <Link href="/bi-tahlil/ai/chat" onClick={() => setOpen(false)} title="To'liq sahifada ochish" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Maximize2 size={16} /></Link>
            {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} title="Suhbatni tozalash" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Trash2 size={16} /></button>}
            <button type="button" onClick={() => setOpen(false)} title="Yopish" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
          </div>
        </div>

        {/* Xabarlar */}
        <div ref={listRef} className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
          {msgs.length === 0 && (
            <div className="text-[13px] leading-relaxed text-slate-500">
              <h4 className="mb-1 text-[15px] font-semibold text-slate-900">Salom! Men Insof AI man.</h4>
              <p>Raqamni aytibgina qolmay, <b className="text-slate-700">nega shunday</b> bo'lganini va <b className="text-slate-700">nima qilish</b> kerakligini tushuntiraman. Tayyor savollar darhol javob beradi{llm ? ", o'z savolingizni ham yozishingiz mumkin" : ""}.</p>
              {quick}
            </div>
          )}
          {msgs.length > 0 && showQuick && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-900">Tez savollar <button type="button" onClick={() => setShowQuick(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={14} /></button></div>
              {quick}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn("flex flex-col gap-1.5", m.role === "user" ? "items-end" : "items-start")}>
              {m.role === "user" ? (
                <div className="max-w-[92%] rounded-xl rounded-br-sm bg-brand-500 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-slate-950">{m.text}</div>
              ) : (
                <div className={cn("w-full rounded-xl rounded-bl-sm border px-3.5 py-2.5 text-[13.5px] leading-relaxed", m.error ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-900")}>
                  <div dangerouslySetInnerHTML={{ __html: md(m.text) }} />
                  {m.answer?.bullets?.length ? <ul className="mt-1.5 space-y-0.5 text-[13px] text-slate-700">{m.answer.bullets.map((b, j) => <li key={j} className="flex gap-1.5"><span className="text-slate-400">•</span><span dangerouslySetInnerHTML={{ __html: md(b) }} /></li>)}</ul> : null}
                  {m.answer?.href && <Link href={m.answer.href.href} onClick={() => setOpen(false)} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-600 hover:underline dark:text-brand-400">{m.answer.href.label} <ExternalLink size={12} /></Link>}
                </div>
              )}
              {m.role === "assistant" && !m.error && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-slate-500">
                  {m.level === 2
                    ? <span className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-violet-700"><Bot size={11} /> Claude</span>
                    : <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700" title="Tayyor javob — AI tokeni sarflanmadi"><Zap size={11} /> Tezkor</span>}
                  {m.answer && m.answer.key !== "none" && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">📊 Manba: dashboard ({m.answer.key})</span>}
                  {m.latency !== undefined && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">{m.latency} ms</span>}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-start"><div className="flex gap-1 rounded-xl rounded-bl-sm border border-slate-200 bg-slate-50 px-3.5 py-3.5">
              {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div></div>
          )}
        </div>

        {/* Kiritish */}
        <div className="flex items-end gap-2 border-t border-slate-200 px-3 pb-3 pt-2.5">
          {msgs.length > 0 && (
            <button type="button" onClick={() => setShowQuick((v) => !v)} title="Tez savollar" className={cn("flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-lg border bg-slate-50 transition", showQuick ? "border-brand-500 text-brand-600" : "border-slate-200 text-slate-500 hover:border-brand-500 hover:text-brand-600")}><Zap size={16} /></button>
          )}
          <textarea ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={llm ? "Savolingizni yozing… masalan: Nega sotuv kamaydi?" : "Savol yozing yoki tayyor savolni tanlang…"}
            className="max-h-30 min-h-9.5 flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15" />
          <button type="button" onClick={() => send()} disabled={loading || !input.trim()} title="Yuborish" className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-slate-950 transition hover:bg-brand-400 disabled:opacity-40"><Send size={16} /></button>
        </div>
        <div className="px-4 pb-2.5 text-[10.5px] text-slate-400">Javoblar dashboard ma'lumotlaridan olinadi. Muhim qarordan oldin manbani tekshiring.</div>
      </aside>
    </>
  );
}
