import Link from "next/link";
import { Bot, Clapperboard, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { aiReady } from "@/lib/ai/smm-writer";
import { marketingSettings } from "@/lib/smm/boosts";
import { missingChannels } from "@/lib/smm/config";
import { ffmpegReady } from "@/lib/smm/video";
import { VIDEO_STATUS } from "@/lib/smm/labels";
import { Badge, Callout, Card, EmptyState, PageHeader, Progress, Tabs } from "@/components/ui";
import { Studio } from "./studio";
import { JobButtons } from "./job-buttons";
import type { Place } from "../sozlamalar/actions";

/** AI studiya: g'oyani oddiy so'z bilan aytasiz — AI ssenariy, matn, heshteg, joy, vaqt va Reels videosini tayyorlaydi */
export default async function StudioPage({ searchParams }: { searchParams: Promise<{ t?: string; g?: string }> }) {
  const s = await requirePage("/marketing/studiya");
  const sp = await searchParams;
  const tab = sp.t === "videolar" ? "videolar" : "yangi";
  const [settings, jobs, miss, ff] = await Promise.all([
    marketingSettings(),
    db.smmVideoJob.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { content: { select: { id: true, title: true } } } }),
    missingChannels(),
    ffmpegReady(),
  ]);
  const running = jobs.filter((j) => j.status === "QUEUED" || j.status === "GENERATING" || j.status === "RENDERING").length;
  const canUse = canDo(s, "marketing", "content") && canDo(s, "marketing", "agent");
  const places = (Array.isArray(settings.locations) ? settings.locations : []) as Place[];
  const connected = (["INSTAGRAM", "TELEGRAM", "FACEBOOK"] as const).filter((c) => !miss[c]);

  return (
    <div>
      <PageHeader title="AI studiya" subtitle="G'oyangizni oddiy so'z bilan yozing — AI ssenariy, izoh, heshteg, joylashuv, chiqish vaqti va Reels videosini tayyorlaydi. Natija qoralama bo'lib Kontent rejaga tushadi." />
      <Tabs current={tab} items={[
        { key: "yangi", label: "Yangi kontent", href: "/marketing/studiya", icon: Sparkles },
        { key: "videolar", label: "Videolar", href: "/marketing/studiya?t=videolar", icon: Clapperboard, count: running || undefined },
        { key: "suhbat", label: "AI bilan suhbat", href: "/marketing/agent", icon: Bot },
      ]} />

      {tab === "yangi" ? (
        !aiReady() ? <Callout tone="warning">AI ulanmagan — administratorga murojaat qiling.</Callout>
        : !canUse ? <Callout tone="info">AI studiyadan foydalanish uchun «Kontent reja» va «AI marketing agenti» ruxsatlari kerak.</Callout>
        : (
          <>
            {!connected.length && <Callout tone="info">Profillar hali ulanmagan — kontent tayyorlanadi, lekin chiqarish uchun <Link href="/marketing/sozlamalar" className="font-medium underline">Sozlamalar</Link>&apos;da profilni ulang.</Callout>}
            <Studio
              initialBrief={sp.g?.slice(0, 3000) ?? ""}
              places={places}
              connected={connected.length ? [...connected] : ["INSTAGRAM", "TELEGRAM"]}
              caps={{ video: ff }}
            />
          </>
        )
      ) : (
        <Card padded={false}>
          {jobs.length === 0 ? <EmptyState title="Video hali yaratilmagan" text="«Yangi kontent» bo'limida Reels tanlab, g'oyani yozing va «Saqlash va video yaratish»ni bosing." /> : (
            <ul className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <li key={j.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      {j.content ? <Link href={`/marketing/kontent/${j.content.id}`} className="font-medium hover:underline">{j.content.title}</Link> : <span className="font-medium">Post o&apos;chirilgan</span>}
                      <p className="text-xs text-slate-500">{dateTime(j.createdAt)}{j.createdByName ? ` · ${j.createdByName}` : ""}</p>
                    </div>
                    <Badge color={VIDEO_STATUS[j.status].color}>{VIDEO_STATUS[j.status].label}</Badge>
                  </div>
                  {(j.status === "GENERATING" || j.status === "RENDERING") && <Progress value={j.progress} max={100} />}
                  {j.error && <p className="text-xs text-red-600">{j.error}</p>}
                  {j.status === "DONE" && j.outputMediaId && (
                    <video src={`/api/marketing/media/${j.outputMediaId}`} controls preload="metadata" playsInline className="aspect-[9/16] w-40 rounded-lg bg-slate-900 object-cover" />
                  )}
                  {canUse && <JobButtons id={j.id} status={j.status} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
