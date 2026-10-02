import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";
import { biContext, BiPage } from "../../shell";
import { CATALOG } from "@/lib/bi/ai";
import { Chat } from "./chat";
import { requirePage } from "@/lib/page-guard";
import { listChats, getChatMessages } from "@/lib/bi/ai-chat";
import { decode, type ChatListItem, type StoredMsg } from "./shared";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePage("/bi-tahlil/ai/chat");
  const { sp, range } = await biContext(searchParams);

  const rawChats = await listChats(s.userId);
  const chats: ChatListItem[] = rawChats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() }));
  const activeId = chats[0]?.id ?? null;
  const rawMsgs = activeId ? await getChatMessages(s.userId, activeId) : null;
  const initialMessages: StoredMsg[] = rawMsgs ? rawMsgs.map(decode) : [];

  return (
    <BiPage title="AI Chat" subtitle="Javoblar dashboard ma'lumotlariga asoslanadi — tanlangan davr (yuqorida) savollarga qo'llanadi." eyebrow="Insof AI" tab="chat" range={range}>
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
