"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Bot, Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

export type ChatMsg = { role: "user" | "assistant"; content: string; tools: string[] };

/** Agent bilan chat: javob oqim bilan keladi, ishlatilgan vositalar belgi bo'lib ko'rinadi. */
export type AgentInfo = { key: string; label: string; about: string; suggestions: string[] };

export function Chat({ chatId: initialId, agent, initial, labels, canUse }: { chatId?: string; agent: AgentInfo; initial: ChatMsg[]; labels: Record<string, string>; canUse: boolean }) {
  const router = useRouter();
  const [chatId, setChatId] = useState(initialId);
  const [msgs, setMsgs] = useState<ChatMsg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || busy || !canUse) return;
    setError(""); setBusy(true); setInput("");
    setMsgs((m) => [...m, { role: "user", content: message, tools: [] }, { role: "assistant", content: "", tools: [] }]);
    const patch = (fn: (a: ChatMsg) => ChatMsg) => setMsgs((m) => { const c = m.slice(); c[c.length - 1] = fn(c[c.length - 1]!); return c; });

    // Yangi suhbat: oqim tugaguncha manzil o'zgartirilmaydi (aks holda sahifa komponentni qayta o'rnatadi)
    let newId: string | undefined;
    let failed = false;
    try {
      const res = await fetch("/api/marketing/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, message, agent: agent.key }) });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string; text?: string; name?: string; id?: string; message?: string };
          if (ev.type === "chat" && ev.id) { newId = chatId ? undefined : ev.id; setChatId(ev.id); }
          else if (ev.type === "text" && ev.text) patch((a) => ({ ...a, content: a.content + ev.text }));
          else if (ev.type === "tool" && ev.name) patch((a) => (a.tools.includes(ev.name!) ? a : { ...a, tools: [...a.tools, ev.name!] }));
          else if (ev.type === "error") { failed = true; setError(ev.message ?? "Xato"); }
        }
      }
    } catch {
      failed = true;
      setError("Ulanishda xato. Qayta urinib ko'ring.");
    } finally {
      setBusy(false);
      if (newId && !failed) router.replace(`/marketing/agent?c=${newId}`);
      else router.refresh();
      taRef.current?.focus();
    }
  }

  return (
    <div className="flex h-[calc(100svh-11rem)] min-h-[520px] flex-col rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
      <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
        {msgs.length === 0 ? (
          <div className="mx-auto max-w-xl py-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-brand-400"><Sparkles size={22} /></span>
            <h2 className="mt-4 text-lg font-semibold">{agent.label}</h2>
            <p className="mt-1.5 text-sm text-slate-500">{agent.about}. Agent yaratgan hamma narsa qoralama — tasdiqlash va nashr sizda.</p>
            {canUse ? (
              <div className="mt-6 flex flex-col gap-2">
                {agent.suggestions.map((x) => (
                  <button key={x} type="button" onClick={() => send(x)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-left text-sm transition hover:border-slate-400 hover:bg-slate-50">{x}</button>
                ))}
              </div>
            ) : <p className="mt-6 text-sm text-amber-700">Agentdan foydalanish uchun direktordan «AI marketing agenti» ruxsatini so&apos;rang.</p>}
          </div>
        ) : msgs.map((m, i) => {
          if (m.role === "assistant" && !m.content && !m.tools.length && !(busy && i === msgs.length - 1)) return null;
          return m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-[15px] whitespace-pre-wrap text-white">{m.content}</p>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-slate-950"><Bot size={16} /></span>
              <div className="min-w-0 flex-1">
                {m.tools.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {m.tools.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"><Check size={11} className="text-emerald-600" /> {labels[t] ?? t}</span>)}
                  </div>
                )}
                {m.content ? <Markdown text={m.content} /> : <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> O&apos;ylayapti…</p>}
              </div>
            </div>
          );
        })}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-slate-100 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-1.5 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/25">
          <textarea
            ref={taRef}
            value={input}
            disabled={!canUse}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }}
            rows={1}
            placeholder={`${agent.label}ga yozing… (Shift+Enter — yangi qator)`}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] outline-none disabled:cursor-not-allowed"
          />
          <button type="submit" aria-label="Yuborish" disabled={busy || !input.trim() || !canUse} className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition", busy || !input.trim() ? "bg-slate-100 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-800")}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </form>
    </div>
  );
}
