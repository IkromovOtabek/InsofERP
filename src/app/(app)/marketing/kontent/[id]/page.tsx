import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { getCompany } from "@/lib/company";
import { dateTime } from "@/lib/format";
import { aiReady } from "@/lib/ai/smm-writer";
import { AUDIENCES } from "@/lib/smm/audiences";
import { marketingSettings } from "@/lib/smm/boosts";
import { Badge, Callout, PageHeader } from "@/components/ui";
import { APPROVAL, VIDEO_STATUS } from "@/lib/smm/labels";
import { ContentForm, EMPTY_CONTENT, type MediaItem } from "../content-form";
import { ApprovalPanel, BoostRequest } from "../post-panel";

/** datetime-local qiymati (server vaqti — Toshkent) */
const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default async function ContentEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saqlandi?: string; video?: string; sana?: string }> }) {
  const s = await requirePage("/marketing/kontent");
  const { id } = await params;
  const { saqlandi, video, sana } = await searchParams;
  const [item, library, company, settings] = await Promise.all([
    id === "new" ? null : db.marketingContent.findUnique({
      where: { id },
      include: {
        media: { orderBy: { sort: "asc" }, include: { media: { select: { id: true, kind: true, title: true } } } }, publications: true, boosts: { orderBy: { createdAt: "desc" }, take: 3 },
        videoJobs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.smmMedia.findMany({ orderBy: { createdAt: "desc" }, take: 120, select: { id: true, kind: true, title: true } }),
    getCompany(),
    marketingSettings(),
  ]);
  if (id !== "new" && !item) notFound();

  const v = item
    ? {
        title: item.title, type: item.type, rubric: item.rubric ?? "", status: item.status,
        scheduledAt: item.scheduledAt ? local(item.scheduledAt) : "", channels: item.channels,
        media: item.media.map((m) => m.media as MediaItem),
        hook: item.hook ?? "", script: item.script ?? "", caption: item.caption ?? "", captionUz: item.captionUz ?? "", hashtags: item.hashtags ?? "", url: item.url ?? "", location: item.locationName ?? "",
        views: item.views, likes: item.likes, saves: item.saves, leads: item.leads,
      }
    // Kalendardagi «+» — tanlangan kun, 18:30 (keyin o'zgartiriladi)
    : { ...EMPTY_CONTENT, scheduledAt: /^\d{4}-\d{2}-\d{2}$/.test(sana ?? "") ? `${sana}T18:30` : "" };
  const places = (Array.isArray(settings.locations) ? settings.locations : []) as { name: string; locationId?: string | null }[];
  const job = item?.videoJobs[0];

  const canEdit = canDo(s, "marketing", "content");
  const igOut = item?.publications.find((p) => p.channel === "INSTAGRAM" && (p.status === "PUBLISHED" || p.status === "SIMULATED"));

  return (
    <div>
      <PageHeader
        back={{ href: "/marketing/kontent", label: "Kontent reja" }}
        title={<>{item ? item.title : "Yangi post"}{item && <Badge color={APPROVAL[item.approval].color}>{APPROVAL[item.approval].label}</Badge>}</>}
        subtitle={item?.createdBy ? `Muallif: ${item.createdBy}` : "Matn, media va tarmoqlarni tanlang — AI yordamchi ssenariy va izohni yozib beradi"}
      />
      {saqlandi && <div className="mb-4"><Callout tone="success">{video ? "Saqlandi. Video montaj navbatga qo'yildi — tayyor bo'lgach postga o'zi biriktiriladi." : "Saqlandi"}</Callout></div>}
      {job && job.status !== "DONE" && job.status !== "CANCELLED" && (
        <Callout tone={job.status === "FAILED" ? "danger" : "info"} title={VIDEO_STATUS[job.status].label}>
          {job.status === "FAILED" ? <>{job.error} — <Link href="/marketing/studiya?t=videolar" className="underline">Videolar</Link> bo&apos;limida qayta urinib ko&apos;ring.</> : <>Video {job.progress}% tayyor. <Link href="/marketing/studiya?t=videolar" className="underline">Kuzatish</Link></>}
        </Callout>
      )}
      <div className="grid gap-6 2xl:grid-cols-[1fr_300px]">
        <ContentForm id={item?.id ?? null} v={v} canEdit={canEdit} canAi={canDo(s, "marketing", "agent") && aiReady()} library={library as MediaItem[]} brand={company.name} places={places} defaultTags={settings.defaultHashtags ?? ""} />
        {item && (
          <div className="space-y-4">
            <ApprovalPanel
              id={item.id} version={item.updatedAt.toISOString()} approval={item.approval} note={item.approvalNote} approvedBy={item.approvedByName}
              canSubmit={canEdit} canPublish={canDo(s, "marketing", "publish")}
              scheduled={item.scheduledAt ? dateTime(item.scheduledAt) : null}
              pubs={item.publications.map((p) => ({ channel: p.channel, status: p.status, permalink: p.permalink, error: p.error, views: p.views, likes: p.likes, comments: p.comments }))}
            />
            {igOut && canDo(s, "marketing", "boost") && (
              <BoostRequest contentId={item.id} audiences={AUDIENCES.map(({ key, label, hint }) => ({ key, label, hint }))} currency={settings.adCurrency} dailyCap={Number(settings.boostDailyCap)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
