import { notFound } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { dateTime } from "@/lib/format";
import { getFeedback } from "@/lib/hr/voice";
import { Badge, Card, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MyReplyForm } from "../../voice-forms";

const STATUS = { NEW: ["Yangi", "amber"], IN_REVIEW: ["Ko'rib chiqilmoqda", "blue"], RESOLVED: ["Hal qilindi", "green"] } as const;

/** Xodimning o'z murojaati va kadr javoblari (anonimda ham — faqat muallifga ko'rinadi). */
export default async function MyFeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/hisobim");
  const { id } = await params;
  const f = await getFeedback(id, s, false);
  if (!f || !f.mine) notFound();
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/hisobim", label: "Mening hisobim" }} eyebrow={f.anonymous ? "Anonim murojaat" : "Murojaat"} title={f.subject} action={<Badge color={STATUS[f.status][1]}>{STATUS[f.status][0]}</Badge>} />
      <Card>
        <div className="space-y-3">
          {f.messages.map((m) => (
            <div key={m.id} className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.fromHr ? "bg-brand-50" : "ml-auto bg-slate-100")}>
              <div className="text-xs text-slate-500">{m.fromHr ? m.who : "Men"} · {dateTime(m.createdAt)}</div>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-3"><MyReplyForm id={f.id} /></div>
      </Card>
    </div>
  );
}
