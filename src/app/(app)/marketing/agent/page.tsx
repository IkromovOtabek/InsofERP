import Link from "next/link";
import { ChartColumn, Clapperboard, Compass, Megaphone, MessageSquare, Plus, Sparkles, Telescope, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AGENTS, MARKETING_TOOL_LABELS, agentKey, type AgentKey } from "@/lib/ai/marketing-agent";
import { PageHeader, Tabs } from "@/components/ui";
import { Chat, type ChatMsg } from "./chat";

const AGENT_ICON: Record<AgentKey, LucideIcon> = {
  umumiy: Sparkles, strateg: Compass, kontent: Clapperboard, analitik: ChartColumn, target: Megaphone, raqobatchi: Telescope,
};

/** AI marketing agentlari: yuqorida agent tanlash, chap tomonda o'z suhbatlari, o'ngda chat. */
export default async function AgentPage({ searchParams }: { searchParams: Promise<{ c?: string; a?: string }> }) {
  const s = await requirePage("/marketing/agent");
  const { c, a } = await searchParams;
  const [chats, active] = await Promise.all([
    db.marketingChat.findMany({ where: { userId: s.userId }, orderBy: { updatedAt: "desc" }, take: 40, select: { id: true, title: true, agent: true, updatedAt: true } }),
    c ? db.marketingChat.findFirst({ where: { id: c, userId: s.userId }, include: { messages: { orderBy: { createdAt: "asc" } } } }) : null,
  ]);
  const initial: ChatMsg[] = (active?.messages ?? []).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content, tools: m.tools }));
  // Suhbat ochiq bo'lsa — uning agenti; yangi suhbatda — tanlangan (?a=)
  const agent = agentKey(active?.agent ?? a);
  const def = AGENTS[agent];

  return (
    <div>
      <PageHeader back={{ href: "/marketing/studiya", label: "AI studiya" }} title="AI agentlar" subtitle="Har agent o'z ishiga ixtisoslashgan: strategiya, Reels va video, tahlil, target, raqobatchilar. Arizalar, kontent reja, statistika va target ma'lumotiga tayanadi." />
      <Tabs current={active ? "" : agent} items={(Object.keys(AGENTS) as AgentKey[]).map((k) => ({ key: k, label: AGENTS[k].label, href: `/marketing/agent?a=${k}`, icon: AGENT_ICON[k] }))} />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="order-2 space-y-2 lg:order-1">
          <Link href={`/marketing/agent?a=${agent}`} className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-sm font-medium text-white hover:bg-slate-800"><Plus size={15} /> Yangi suhbat</Link>
          <ul className="space-y-1">
            {chats.map((x) => (
              <li key={x.id}>
                <Link href={`/marketing/agent?c=${x.id}`} className={cn("flex gap-2 rounded-lg px-3 py-2 text-sm transition", x.id === active?.id ? "bg-white shadow-xs ring-1 ring-slate-200" : "text-slate-600 hover:bg-white")}>
                  <MessageSquare size={15} className="mt-0.5 shrink-0 text-slate-400" />
                  <span className="min-w-0"><span className="line-clamp-2">{x.title}</span><span className="text-[11px] text-slate-400">{AGENTS[agentKey(x.agent)].label} · {dateTime(x.updatedAt)}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <div className="order-1 lg:order-2">
          {/* key — suhbat almashganda holat tozalansin */}
          <Chat key={active?.id ?? `new-${agent}`} chatId={active?.id} agent={{ key: agent, label: def.label, about: def.about, suggestions: def.suggestions }}
            initial={initial} labels={MARKETING_TOOL_LABELS} canUse={canDo(s, "marketing", "agent")} />
        </div>
      </div>
    </div>
  );
}
