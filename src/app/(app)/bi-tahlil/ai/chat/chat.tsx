"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { Send, Sparkles, Zap, ArrowRight, User, Bot, LayoutDashboard, Wallet, Target, Warehouse, Landmark, Users, BadgeCheck, BrainCircuit, Megaphone, HelpCircle, type LucideIcon } from "lucide-react";
import { ask } from "../actions";
import type { Answer, CATALOG } from "@/lib/bi/ai";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { dashboard: LayoutDashboard, payments: Wallet, track_changes: Target, inventory_2: Warehouse, account_balance: Landmark, groups: Users, badge: BadgeCheck, auto_graph: BrainCircuit, campaign: Megaphone, help_outline: HelpCircle };
type Msg = { role: "user" | "ai"; text: string; bullets?: string[]; href?: { label: string; href: string }; pending?: boolean };

export function Chat({ catalog, sp, greeting }: { catalog: typeof CATALOG; sp: Record<string, string | undefined>; greeting: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs]);

  const send = (q: string) => {
    const question = q.trim(); if (!question || pending) return;
    setText("");
    setMsgs((m) => [...m, { role: "user", text: question }, { role: "ai", text: "Ma'lumotlar hisoblanmoqda…", pending: true }]);
    start(async () => {
      let a: Answer;
      try { a = await ask(question, sp); } catch { a = { key: "err", text: "Javob berishda xato yuz berdi. Qaytadan urinib ko'ring." }; }
      setMsgs((m) => [...m.slice(0, -1), { role: "ai", text: a.text, bullets: a.bullets, href: a.href }]);
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <div className="flex min-h-[560px] flex-col rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700"><Bot size={16} /></div><div className="max-w-3xl rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-3 text-[13.5px] leading-relaxed"><div className="font-semibold">Salom! Men Insof AI man.</div><p className="mt-1 text-slate-600">{greeting}</p><p className="mt-1 text-slate-600">Raqamni aytibgina qolmay, <b>nega</b> shunday bo'lganini va <b>nima qilish</b> kerakligini tushuntiraman. O'ngdagi tayyor savollar darhol javob beradi, yoki o'z savolingizni yozing.</p></div></div>
          {msgs.length === 0 && (
            <div className="grid grid-cols-1 gap-3 pl-11 md:grid-cols-2">
              {catalog.slice(0, 4).map((g) => { const I = ICONS[g.icon] ?? HelpCircle; return <div key={g.group} className="rounded-lg border border-slate-200 p-3"><div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold"><span className="inline-flex items-center gap-1.5"><I size={13} className="text-slate-500" /> {g.group}</span><span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{g.items.length}</span></div><ul className="space-y-0.5">{g.items.map((it) => <li key={it.key}><button type="button" onClick={() => send(it.q)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[13px] text-slate-700 hover:bg-slate-50 hover:text-slate-900"><span>{it.q}</span><Zap size={11} className="shrink-0 text-brand-500" /></button></li>)}</ul></div>; })}
            </div>
          )}
          {msgs.map((m, i) => m.role === "user" ? (
            <div key={i} className="flex justify-end gap-3"><div className="max-w-2xl rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-2.5 text-[13.5px] text-white">{m.text}</div><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600"><User size={15} /></div></div>
          ) : (
            <div key={i} className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700"><Bot size={16} /></div><div className={cn("max-w-3xl rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-3 text-[13.5px] leading-relaxed", m.pending && "animate-pulse text-slate-400")}><p className="text-slate-800">{m.text}</p>{m.bullets && m.bullets.length > 0 && <ul className="mt-2 space-y-1 text-[13px] text-slate-700">{m.bullets.map((b, j) => <li key={j} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" /><span>{b}</span></li>)}</ul>}{m.href && <Link href={m.href.href} className="mt-2.5 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">{m.href.label} <ArrowRight size={12} /></Link>}</div></div>
          ))}
          <div ref={endRef} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-center gap-2 border-t border-slate-100 p-3">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Savolingizni yozing… masalan: Nega sotuv kamaydi?" className="h-10 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400" />
          <button disabled={pending || !text.trim()} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-40"><Send size={15} /> Yuborish</button>
        </form>
        <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400"><Sparkles size={10} className="mr-1 inline" /> Javoblar dashboard ma'lumotlaridan olinadi. Muhim qarordan oldin manbani tekshiring.</div>
      </div>
      <div className="space-y-3">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Tayyor savollar</div>
        {catalog.map((g) => { const I = ICONS[g.icon] ?? HelpCircle; return (
          <details key={g.group} open={g.group === "Umumiy holat"} className="group rounded-lg border border-slate-200/80 bg-white shadow-(--shadow-card)">
            <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-[13px] font-semibold"><span className="inline-flex items-center gap-1.5"><I size={14} className="text-slate-500" /> {g.group}</span><span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">{g.items.length}</span></summary>
            <ul className="border-t border-slate-100 p-1.5">{g.items.map((it) => <li key={it.key}><button type="button" onClick={() => send(it.q)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-slate-700 hover:bg-slate-50 hover:text-slate-900"><span>{it.q}</span><Zap size={11} className="shrink-0 text-brand-500" /></button></li>)}</ul>
          </details>); })}
      </div>
    </div>
  );
}
