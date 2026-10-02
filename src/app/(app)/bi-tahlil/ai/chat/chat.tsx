"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Send, Sparkles, Zap, ArrowRight, User, Bot, Plus, Trash2, MessageSquare, History, X, LayoutDashboard, Wallet, Target, Warehouse, Landmark, Users, BadgeCheck, BrainCircuit, Megaphone, HelpCircle, type LucideIcon } from "lucide-react";
import type { CATALOG } from "@/lib/bi/ai";
import { cn } from "@/lib/utils";
import { listChatsAction, loadChatAction, deleteChatAction, sendAction } from "./actions";
import type { ChatListItem, StoredMsg } from "./shared";

const ICONS: Record<string, LucideIcon> = { dashboard: LayoutDashboard, payments: Wallet, track_changes: Target, inventory_2: Warehouse, account_balance: Landmark, groups: Users, badge: BadgeCheck, auto_graph: BrainCircuit, campaign: Megaphone, help_outline: HelpCircle };

type Msg = StoredMsg & { pending?: boolean };

/** Suhbatlarni sana guruhiga ajratadi: Bugun / Kecha / oldingi. */
function groupChats(chats: ChatListItem[]): { label: string; items: ChatListItem[] }[] {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYday = startToday - 86400000;
  const groups: { label: string; items: ChatListItem[] }[] = [];
  const push = (label: string, c: ChatListItem) => {
    let g = groups.find((x) => x.label === label);
    if (!g) { g = { label, items: [] }; groups.push(g); }
    g.items.push(c);
  };
  for (const c of chats) {
    const t = new Date(c.updatedAt).getTime();
    if (t >= startToday) push("Bugun", c);
    else if (t >= startYday) push("Kecha", c);
    else push(new Date(c.updatedAt).toLocaleDateString("uz", { day: "numeric", month: "long" }), c);
  }
  return groups;
}

export function Chat({ catalog, sp, greeting, initialChats, initialActiveId, initialMessages }: {
  catalog: typeof CATALOG;
  sp: Record<string, string | undefined>;
  greeting: string;
  initialChats: ChatListItem[];
  initialActiveId: string | null;
  initialMessages: StoredMsg[];
}) {
  const [chats, setChats] = useState<ChatListItem[]>(initialChats);
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const [msgs, setMsgs] = useState<Msg[]>(initialMessages);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [switching, startSwitch] = useTransition();
  const [drawer, setDrawer] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs]);

  const send = useCallback((q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    setText("");
    setDrawer(false);
    const startedFrom = activeId;
    setMsgs((m) => [...m, { id: `u-${Date.now()}`, role: "user", text: question, createdAt: new Date().toISOString() }, { id: `a-${Date.now()}`, role: "assistant", text: "Ma'lumotlar hisoblanmoqda…", createdAt: new Date().toISOString(), pending: true }]);
    start(async () => {
      const r = await sendAction(startedFrom, question, sp);
      if ("error" in r) {
        setMsgs((m) => [...m.slice(0, -1), { id: `e-${Date.now()}`, role: "assistant", text: "Javob berishda xato yuz berdi. Qaytadan urinib ko'ring.", createdAt: new Date().toISOString() }]);
        return;
      }
      setActiveId(r.chatId);
      setMsgs((m) => [...m.slice(0, -2), r.user, r.answer]);
      setChats((cs) => {
        const rest = cs.filter((c) => c.id !== r.chatId);
        return [{ id: r.chatId, title: r.title, updatedAt: new Date().toISOString() }, ...rest];
      });
    });
  }, [pending, activeId, sp]);

  const selectChat = (id: string) => {
    if (id === activeId || pending) { setDrawer(false); return; }
    setDrawer(false);
    startSwitch(async () => {
      const loaded = await loadChatAction(id);
      setActiveId(id);
      setMsgs(loaded ?? []);
    });
  };

  const newChat = () => {
    if (pending) return;
    setActiveId(null);
    setMsgs([]);
    setDrawer(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const del = (id: string) => {
    startSwitch(async () => {
      const ok = await deleteChatAction(id);
      if (!ok) return;
      setChats((cs) => cs.filter((c) => c.id !== id));
      if (id === activeId) { setActiveId(null); setMsgs([]); }
      // ro'yxatni bazadan sinxronlab olamiz
      setChats(await listChatsAction());
    });
  };

  const groups = groupChats(chats);

  const historyPanel = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button type="button" onClick={newChat} className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-slate-800"><Plus size={15} /> Yangi suhbat</button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-2 pb-3">
        {chats.length === 0 && <div className="px-2 py-6 text-center text-[12.5px] text-slate-400">Hali suhbat yo'q. Savol yuboring — tarix shu yerda saqlanadi.</div>}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((c) => (
                <li key={c.id}>
                  <div className={cn("group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-slate-100", c.id === activeId ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700")}>
                    <button type="button" onClick={() => selectChat(c.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <MessageSquare size={13} className="shrink-0 text-slate-400" />
                      <span className="truncate">{c.title}</span>
                    </button>
                    <button type="button" title="O'chirish" onClick={() => del(c.id)} className="shrink-0 rounded p-1 text-slate-300 opacity-0 hover:bg-slate-200 hover:text-red-600 group-hover:opacity-100"><Trash2 size={13} /></button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* Tarix paneli — desktop */}
      <aside className="hidden min-h-[560px] rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card) lg:block">{historyPanel}</aside>

      {/* Tarix paneli — mobil drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[82%] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-[13px] font-semibold"><span className="inline-flex items-center gap-1.5"><History size={14} /> Suhbatlar tarixi</span><button type="button" onClick={() => setDrawer(false)} className="rounded p-1 hover:bg-slate-100"><X size={16} /></button></div>
            {historyPanel}
          </div>
        </div>
      )}

      {/* Suhbat */}
      <div className="flex min-h-[560px] flex-col rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 lg:hidden">
          <button type="button" onClick={() => setDrawer(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium text-slate-700"><History size={15} /> Tarix</button>
          <button type="button" onClick={newChat} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[13px] font-medium text-white"><Plus size={14} /> Yangi</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700"><Bot size={16} /></div><div className="max-w-3xl rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-3 text-[13.5px] leading-relaxed"><div className="font-semibold">Salom! Men Insof AI man.</div><p className="mt-1 text-slate-600">{greeting}</p><p className="mt-1 text-slate-600">Raqamni aytibgina qolmay, <b>nega</b> shunday bo'lganini va <b>nima qilish</b> kerakligini tushuntiraman. Tayyor savollardan tanlang yoki o'z savolingizni yozing.</p></div></div>

          {msgs.length === 0 && !switching && (
            <div className="grid grid-cols-1 gap-3 pl-11 md:grid-cols-2">
              {catalog.slice(0, 4).map((g) => { const I = ICONS[g.icon] ?? HelpCircle; return <div key={g.group} className="rounded-lg border border-slate-200 p-3"><div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold"><span className="inline-flex items-center gap-1.5"><I size={13} className="text-slate-500" /> {g.group}</span><span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{g.items.length}</span></div><ul className="space-y-0.5">{g.items.map((it) => <li key={it.key}><button type="button" onClick={() => send(it.q)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[13px] text-slate-700 hover:bg-slate-50 hover:text-slate-900"><span>{it.q}</span><Zap size={11} className="shrink-0 text-brand-500" /></button></li>)}</ul></div>; })}
            </div>
          )}

          {switching && <div className="pl-11 text-[13px] text-slate-400">Suhbat yuklanmoqda…</div>}

          {msgs.map((m) => m.role === "user" ? (
            <div key={m.id} className="flex justify-end gap-3"><div className="max-w-2xl rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-2.5 text-[13.5px] text-white">{m.text}</div><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600"><User size={15} /></div></div>
          ) : (
            <div key={m.id} className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700"><Bot size={16} /></div><div className={cn("max-w-3xl rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-3 text-[13.5px] leading-relaxed", m.pending && "animate-pulse text-slate-400")}><p className="whitespace-pre-wrap text-slate-800">{m.text}</p>{m.bullets && m.bullets.length > 0 && <ul className="mt-2 space-y-1 text-[13px] text-slate-700">{m.bullets.map((b, j) => <li key={j} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" /><span>{b}</span></li>)}</ul>}{m.href && <Link href={m.href.href} className="mt-2.5 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">{m.href.label} <ArrowRight size={12} /></Link>}</div></div>
          ))}
          <div ref={endRef} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-center gap-2 border-t border-slate-100 p-3">
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Savolingizni yozing… masalan: Nega sotuv kamaydi?" className="h-10 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400" />
          <button disabled={pending || !text.trim()} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-40"><Send size={15} /> Yuborish</button>
        </form>
        <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400"><Sparkles size={10} className="mr-1 inline" /> Javoblar dashboard ma'lumotlaridan olinadi. Suhbatlar tarixda saqlanadi.</div>
      </div>
    </div>
  );
}
