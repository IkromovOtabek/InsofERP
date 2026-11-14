import Link from "next/link";
import { BarChart3, ChevronRight, MessageSquare, MessagesSquare, Timer, History } from "lucide-react";
import { biContext, BiPage } from "../../shell";
import { CATALOG } from "@/lib/bi/ai";
import { Chat } from "./chat";
import { requirePage } from "@/lib/page-guard";
import { listChats, getChatMessages, aiUsageStats } from "@/lib/bi/ai-chat";
import { startOfDay } from "@/lib/bi/core";
import { fmtNum, time, date as fmtDate } from "@/lib/format";
import { Kpi } from "../../ui";
import { decode, type ChatListItem, type StoredMsg } from "./shared";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePage("/bi-tahlil/ai/chat");
  const { sp, range } = await biContext(searchParams);

  // Statistika — faqat shu foydalanuvchining savollari (suhbatlar egasiga xos)
  const [rawChats, u] = await Promise.all([listChats(s.userId), aiUsageStats(s.userId)]);
  const today = startOfDay(new Date()), sec = (ms: number | null) => (ms === null ? "—" : `${fmtNum(ms / 1000, 1)} soniya`);
  const chats: ChatListItem[] = rawChats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() }));
  const activeId = chats[0]?.id ?? null;
  const rawMsgs = activeId ? await getChatMessages(s.userId, activeId) : null;
  const initialMessages: StoredMsg[] = rawMsgs ? rawMsgs.map(decode) : [];

  return (
    <BiPage title="AI Chat" info="Javoblar dashboard ma'lumotlariga asoslanadi — tanlangan davr (yuqorida) savollarga qo'llanadi." eyebrow="Insof AI" tab="chat" range={range}>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Savollarim · bugun" value={String(u.today)} icon={MessageSquare} tone="info" hint={`bu oy ${u.month} · shundan Telegram ${u.telegram.month}`} />
        <Kpi label="Suhbatlar" value={String(u.chats)} icon={MessagesSquare} tone="violet" hint="saqlangan suhbatlaringiz" />
        <Kpi label="O'rtacha javob vaqti" value={sec(u.avgMs)} icon={Timer} hint={u.avgMs === null ? "bu oy savol yo'q" : "bu oy · savoldan javobgacha"} />
        <Kpi label="Oxirgi savol" value={u.last ? (u.last.at >= today ? time(u.last.at) : fmtDate(u.last.at)) : "—"} icon={History} hint={u.last ? `${u.last.at >= today ? "bugun" : time(u.last.at)} · ${u.last.channel}` : "hali savol berilmagan"} />
      </div>
      <div className="mb-4 flex items-center justify-between rounded-lg border border-slate-200/80 bg-white px-4 py-2.5 text-[13px] shadow-(--shadow-card)"><span className="inline-flex items-center gap-2"><BarChart3 size={15} className="text-brand-500" /> <b>AI tahlil</b> <span className="text-slate-500">— bugungi vazifalar va hisobotlar</span></span><Link href="/bi-tahlil/ai" className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline">Ochish <ChevronRight size={14} /></Link></div>
      <Chat
        catalog={CATALOG}
        sp={sp}
        greeting={`${s.fullName.split(" ")[0]}, davr: ${range.label}.`}
        initialChats={chats}
        initialActiveId={activeId}
        initialMessages={initialMessages}
      />
    </BiPage>
  );
}
