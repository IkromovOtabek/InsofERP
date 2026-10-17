import { notFound } from "next/navigation";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { getFeedback } from "@/lib/hr/voice";
import { Badge, Callout, Card, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { HrReplyForm } from "../../hr4-forms";
import { FEEDBACK_KIND_LABEL, FEEDBACK_STATUS_BADGE, FEEDBACK_STATUS_LABEL } from "../../hr4-tabs";

/** Murojaat (HR chat): yozishma, javob, holat. Anonim murojaatda muallif ko'rsatilmaydi. */
export default async function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("/otdel-kadr");
  const s = await requireRoles(["HR"], { module: "employees" });
  const { id } = await params;
  const f = await getFeedback(id, s, true);
  if (!f) notFound();
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/otdel-kadr?tab=murojaatlar", label: "Murojaatlar" }} eyebrow={FEEDBACK_KIND_LABEL[f.kind]} title={f.subject}
        subtitle={f.anonymous ? "Anonim xodim" : f.author ?? undefined} action={<Badge color={FEEDBACK_STATUS_BADGE[f.status]}>{FEEDBACK_STATUS_LABEL[f.status]}</Badge>} />
      {f.anonymous && <Callout tone="info">Anonim murojaat — muallifni tizim saqlamaydi. Javobingizni u «Mening hisobim → Murojaatlarim»da ko&apos;radi.</Callout>}
      <Card>
        <div className="space-y-3">
          {f.messages.map((m) => (
            <div key={m.id} className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.fromHr ? "ml-auto bg-brand-50 text-slate-900" : "bg-slate-100")}>
              <div className="text-xs text-slate-500">{m.who} · {dateTime(m.createdAt)}</div>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
          ))}
        </div>
        {canDo(s, "employees", "voice", ["HR"]) && <div className="mt-4 border-t border-slate-100 pt-3"><HrReplyForm id={f.id} status={f.status} /></div>}
      </Card>
    </div>
  );
}
