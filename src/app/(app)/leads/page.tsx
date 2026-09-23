import Link from "next/link";
import { ExternalLink, MapPin, MessageSquare, Phone } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { dateTime, fmtNum } from "@/lib/format";
import { formatPhone } from "@/lib/sms/phone";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { ConvertLead, LeadNote, LeadStatusButtons } from "./lead-actions";

const STATUS = {
  NEW: { label: "Yangi", color: "amber" },
  IN_PROGRESS: { label: "Ishda", color: "blue" },
  CONVERTED: { label: "Mijoz bo'ldi", color: "green" },
  REJECTED: { label: "Bekor", color: "slate" },
} as const;

/**
 * Saytdan (`/` landing) tushgan arizalar. Sotuv bo'limi shu yerdan bog'lanadi
 * va kerak bo'lsa arizani mijozga aylantiradi — shundan keyingina `Customer` yaratiladi.
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireSession(["SALES", "DIRECTOR"]);
  const { tab = "new" } = await searchParams;

  const leads = await db.lead.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { product: { select: { name: true, unit: true } }, customer: { select: { id: true, name: true } }, handledBy: { select: { fullName: true } } },
  });

  const counts = {
    new: leads.filter((l) => l.status === "NEW").length,
    work: leads.filter((l) => l.status === "IN_PROGRESS").length,
    done: leads.filter((l) => l.status === "CONVERTED").length,
    rejected: leads.filter((l) => l.status === "REJECTED").length,
  };
  const shown = leads.filter((l) =>
    tab === "new" ? l.status === "NEW" : tab === "work" ? l.status === "IN_PROGRESS" : tab === "done" ? l.status === "CONVERTED" : tab === "rejected" ? l.status === "REJECTED" : true,
  );

  return (
    <div>
      <PageHeader
        title="Sayt arizalari"
        subtitle="Saytdagi formadan tushgan so'rovlar. Bog'lanib, kerak bo'lsa mijozga aylantiriladi — mijozlar bazasi keraksiz raqamlar bilan to'lib ketmaydi."
      />

      <Tabs current={tab} className="mb-6" items={[
        { key: "new", label: "Yangi", href: "/leads?tab=new", count: counts.new },
        { key: "work", label: "Ishda", href: "/leads?tab=work", count: counts.work },
        { key: "done", label: "Mijoz bo'ldi", href: "/leads?tab=done", count: counts.done },
        { key: "rejected", label: "Bekor", href: "/leads?tab=rejected", count: counts.rejected },
        { key: "all", label: "Hammasi", href: "/leads?tab=all", count: leads.length },
      ]} />

      {shown.length === 0 ? (
        <EmptyState title="Ariza yo'q" text="Saytdagi forma to'ldirilsa, ariza shu yerda paydo bo'ladi va Telegram'ga xabar keladi." icon={MessageSquare} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((l) => {
            const st = STATUS[l.status];
            return (
              <Card key={l.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{l.name}</h3>
                      <Badge color={st.color}>{st.label}</Badge>
                    </div>
                    <a href={`tel:${l.phone}`} className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:underline">
                      <Phone size={14} className="text-slate-400" /> {formatPhone(l.phone)}
                    </a>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    {dateTime(l.createdAt)}
                    {l.handledBy && <div className="mt-0.5">{l.handledBy.fullName}</div>}
                  </div>
                </div>

                <dl className="mt-3 space-y-1.5 text-sm">
                  {l.product && (
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-slate-500">Mahsulot</dt>
                      <dd>{l.product.name}{l.qty ? ` — ${fmtNum(l.qty, 3)} ${unitLabel(l.product.unit)}` : ""}</dd>
                    </div>
                  )}
                  {!l.product && l.qty && (
                    <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Hajm</dt><dd>{fmtNum(l.qty, 3)}</dd></div>
                  )}
                  {l.address && (
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-slate-500">Manzil</dt>
                      <dd className="inline-flex items-start gap-1.5"><MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />{l.address}</dd>
                    </div>
                  )}
                  {l.message && (
                    <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Izoh</dt><dd className="text-slate-700">{l.message}</dd></div>
                  )}
                  {l.customer && (
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-slate-500">Mijoz</dt>
                      <dd><Link href={`/customers/${l.customer.id}`} className="inline-flex items-center gap-1 font-medium hover:underline">{l.customer.name} <ExternalLink size={13} /></Link></dd>
                    </div>
                  )}
                </dl>

                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <LeadStatusButtons leadId={l.id} status={l.status} />
                    {l.status !== "CONVERTED" && <ConvertLead leadId={l.id} defaultName={l.name} />}
                  </div>
                  <LeadNote leadId={l.id} note={l.note} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
