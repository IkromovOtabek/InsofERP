import Link from "next/link";
import { ArrowRight, Eye, Inbox, Lightbulb, MousePointerClick, Send, Sparkles, TrendingDown, TrendingUp, Trophy, UserPlus, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canView } from "@/lib/nav";
import { canDo } from "@/lib/permissions";
import { date, dateTime, fmtNum, pct } from "@/lib/format";
import { analytics } from "@/lib/smm/insights";
import { MEDIA_TYPE_LABEL, WEEKDAY } from "@/lib/smm/labels";
import { CONTENT_TYPE } from "@/lib/marketing";
import { ratio } from "@/lib/marketing";
import { aiReady } from "@/lib/ai/smm-writer";
import { Badge, Callout, Card, CardHeader, Empty, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { Markdown } from "./agent/markdown";
import { StatsButtons } from "./stats-buttons";

type Idea = { title: string; format: "REELS" | "POST" | "STORIES"; hook: string; why: string; brief: string };

const delta = (cur: number, prev: number) => (prev > 0 ? ratio(cur - prev, prev) : null);

/** Marketing — statistika: ulangan profillar ko'rsatkichlari, nima ishlayapti, AI tahlil va g'oyalar, arizalar */
export default async function MarketingStats({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const s = await requirePage("/marketing");
  const sp = await searchParams;
  const days = sp.d === "7" ? 7 : sp.d === "90" ? 90 : 30;
  const seeLeads = canView(s, "sales");
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);

  const [a, report, competitors, leads, upcoming] = await Promise.all([
    analytics(days, now),
    db.smmInsightReport.findFirst({ orderBy: { createdAt: "desc" } }),
    db.smmCompetitor.findMany({ where: { followers: { not: null } }, orderBy: { followers: "desc" }, take: 8 }),
    seeLeads ? db.lead.groupBy({ by: ["utmSource"], where: { createdAt: { gte: since } }, _count: true }) : Promise.resolve([]),
    db.marketingContent.findMany({ where: { scheduledAt: { gte: now }, status: { notIn: ["PUBLISHED", "CANCELLED"] } }, orderBy: { scheduledAt: "asc" }, take: 5 }),
  ]);
  const ideas = (Array.isArray(report?.ideas) ? report.ideas : []) as Idea[];
  const vDelta = delta(a.totals.views, a.prev.views);
  const totalLeads = leads.reduce((x, l) => x + l._count, 0);
  const maxV = Math.max(1, ...a.series.map((x) => x.views));
  const bestDay = [...a.byWeekday].filter((d) => d.posts >= 2).sort((x, y) => y.avgViews - x.avgViews)[0];
  const bestHour = [...a.byHour].filter((h) => h.posts >= 2).sort((x, y) => y.avgViews - x.avgViews)[0];
  const canAi = aiReady() && canDo(s, "marketing", "agent");
  const canSync = canDo(s, "marketing", "content");

  return (
    <div>
      <PageHeader title="Statistika" subtitle="Ulangan profillar ko'rsatkichlari, qaysi kontent ko'p ko'rilyapti va AI tavsiyalari."
        action={<StatsButtons canAi={canAi} canSync={canSync && !!a.account} />} />
      <Tabs current={String(days)} items={[
        { key: "7", label: "7 kun", href: "/marketing?d=7" },
        { key: "30", label: "30 kun", href: "/marketing" },
        { key: "90", label: "90 kun", href: "/marketing?d=90" },
      ]} />

      {!a.account && (
        <Callout tone="info" title="Instagram profili ulanmagan">
          Statistika va AI tavsiyalari uchun <Link href="/marketing/sozlamalar" className="font-medium underline">Sozlamalar</Link>&apos;da profilni ulang — ko&apos;rsatkichlar har 6 soatda o&apos;zi yig&apos;iladi.
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Ko'rishlar (${days} kun)`} value={fmtNum(a.totals.views)} icon={Eye}
          hint={vDelta === null ? "oldingi davr bilan solishtirish yo'q" : `${vDelta >= 0 ? "+" : ""}${pct(vDelta)} oldingi davrga`} tone={vDelta !== null && vDelta < 0 ? "warning" : "default"} href="#kunlik" />
        <StatCard label="Qamrov" value={fmtNum(a.totals.reach)} hint={`Profilga kirish: ${fmtNum(a.totals.profileViews)}`} icon={Users} href="#kunlik" />
        <StatCard label="Obunachilar" value={a.account?.followers != null ? fmtNum(a.account.followers) : "—"} icon={UserPlus}
          hint={a.totals.followersDelta != null ? `${a.totals.followersDelta >= 0 ? "+" : ""}${fmtNum(a.totals.followersDelta)} davrda` : a.account?.username ? `@${a.account.username}` : undefined} href="#raqobatchilar" />
        <StatCard label={seeLeads ? "Arizalar" : "Saytga o'tish"} value={fmtNum(seeLeads ? totalLeads : a.totals.websiteClicks)} icon={seeLeads ? Inbox : MousePointerClick}
          hint={seeLeads ? `Saytga o'tish: ${fmtNum(a.totals.websiteClicks)}` : undefined} href={seeLeads ? "/leads" : undefined} />
      </div>

      <div id="kunlik" className="mt-6 grid scroll-mt-20 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Kunlik ko'rishlar" description="Instagram profili bo'yicha" />
          {a.series.length === 0 ? <Empty text="Hali ma'lumot yo'q" /> : (
            <>
              <div className="flex h-36 items-end gap-1" role="img" aria-label="Kunlik ko'rishlar">
                {a.series.map((x) => (
                  <div key={x.date} className="group relative flex-1">
                    <div className="rounded-t bg-slate-800/80 transition group-hover:bg-brand-500" style={{ height: `${Math.max(3, (x.views / maxV) * 136)}px` }} />
                    <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white group-hover:block">{date(new Date(`${x.date}T12:00:00`))}: {fmtNum(x.views)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-slate-400"><span>{date(new Date(`${a.series[0]!.date}T12:00:00`))}</span><span>{date(new Date(`${a.series[a.series.length - 1]!.date}T12:00:00`))}</span></div>
            </>
          )}
        </Card>
        <Card>
          <CardHeader title="Qachon chiqarish kerak" description="So'nggi 90 kundagi postlar bo'yicha" />
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between gap-2"><span className="text-slate-500">Eng yaxshi kun</span><span className="font-medium">{bestDay ? `${WEEKDAY[bestDay.day]} · ${fmtNum(bestDay.avgViews)} ko'rish` : "ma'lumot kam"}</span></li>
            <li className="flex justify-between gap-2"><span className="text-slate-500">Eng yaxshi soat</span><span className="font-medium">{bestHour ? `${bestHour.hour}:00 · ${fmtNum(bestHour.avgViews)} ko'rish` : "ma'lumot kam"}</span></li>
            <li className="flex justify-between gap-2"><span className="text-slate-500">Davrdagi postlar</span><span className="font-medium">{fmtNum(a.posts)}</span></li>
            {a.telegram && <li className="flex justify-between gap-2"><span className="inline-flex items-center gap-1 text-slate-500"><Send size={13} /> Telegram</span><span className="font-medium">{a.telegram.followers != null ? fmtNum(a.telegram.followers) : "—"} obunachi{a.telegram.delta != null ? ` (${a.telegram.delta >= 0 ? "+" : ""}${fmtNum(a.telegram.delta)})` : ""}</span></li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="AI tahlil va g'oyalar" icon={Sparkles}
          description={report ? `${dateTime(report.createdAt)}${report.createdByName ? ` · ${report.createdByName}` : ""}` : "«AI tahlil va g'oyalar» tugmasini bosing — AI profilingiz va raqobatchilarni tahlil qilib, ko'rishni oshirish yo'llarini beradi"} />
        {report ? (
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div className="text-sm"><Markdown text={report.summary} /></div>
            <ul className="space-y-3">
              {ideas.map((i) => (
                <li key={i.title} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium"><Lightbulb size={14} className="text-amber-500" /> {i.title}</span>
                    <Badge color="slate" dot={false}>{CONTENT_TYPE[i.format] ?? i.format}</Badge>
                  </div>
                  <p className="text-xs text-slate-600">Hook: {i.hook}</p>
                  <p className="mt-1 text-xs text-slate-500">{i.why}</p>
                  <LinkButton size="sm" variant="secondary" className="mt-2" href={`/marketing/studiya?g=${encodeURIComponent(i.brief.slice(0, 1500))}`}><Sparkles size={13} /> Studiyada yaratish</LinkButton>
                </li>
              ))}
            </ul>
          </div>
        ) : <Empty text="Hali tahlil qilinmagan" />}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-4 pb-2"><CardHeader title="Format bo'yicha" description="90 kun · ER — saqlash, ulashish va izohlar qamrovga nisbatan" /></div>
          {a.byFormat.length === 0 ? <Empty text="Ma'lumot yo'q" /> : (
            <Table>
              <thead><tr><Th>Format</Th><Th className="text-right">Post</Th><Th className="text-right">O&apos;rt. ko&apos;rish</Th><Th className="text-right">ER</Th><Th className="text-right">Tomosha</Th></tr></thead>
              <tbody>
                {a.byFormat.map((f) => (
                  <Tr key={f.type}>
                    <Td>{MEDIA_TYPE_LABEL[f.type] ?? f.type}</Td>
                    <Td className="text-right tabular">{fmtNum(f.posts)}</Td>
                    <Td className="text-right tabular">{fmtNum(f.avgViews)}</Td>
                    <Td className="text-right tabular">{pct(f.engagement)}</Td>
                    <Td className="text-right tabular">{f.avgWatch != null ? `${fmtNum(f.avgWatch, 1)} s` : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false}>
          <div id="raqobatchilar" className="scroll-mt-20 p-4 pb-2"><CardHeader title="Raqobatchilar" action={<Link href="/marketing/sozlamalar" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">Ro&apos;yxat <ArrowRight size={14} /></Link>} /></div>
          {competitors.length === 0 ? <Empty text="Sozlamalar'da raqobatchi profillarini qo'shing" /> : (
            <Table>
              <thead><tr><Th>Profil</Th><Th className="text-right">Obunachi</Th><Th className="text-right">O&apos;rt. layk</Th><Th className="text-right">O&apos;rt. izoh</Th></tr></thead>
              <tbody>
                {a.account && (
                  <Tr><Td className="font-medium">Biz{a.account.username ? ` (@${a.account.username})` : ""}</Td><Td className="text-right tabular">{a.account.followers != null ? fmtNum(a.account.followers) : "—"}</Td><Td className="text-right tabular">—</Td><Td className="text-right tabular">—</Td></Tr>
                )}
                {competitors.map((c) => (
                  <Tr key={c.id}>
                    <Td><a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="hover:underline">@{c.username}</a></Td>
                    <Td className="text-right tabular">{fmtNum(c.followers ?? 0)}</Td>
                    <Td className="text-right tabular">{fmtNum(c.avgLikes ?? 0)}</Td>
                    <Td className="text-right tabular">{fmtNum(c.avgComments ?? 0)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Eng ko'p ko'rilgan postlar" icon={Trophy} description={`${days} kun ichida chiqqanlar`} />
          {a.top.length === 0 ? <Empty text="Davrda post yo'q" /> : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {a.top.map((p) => (
                <li key={p.id} className="overflow-hidden rounded-xl border border-slate-200">
                  <a href={p.permalink ?? "#"} target="_blank" rel="noreferrer" className="block">
                    <div className="aspect-[4/5] bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element -- Instagram CDN rasmi */}
                      {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
                    </div>
                    <div className="space-y-0.5 p-2">
                      <p className="line-clamp-2 text-xs">{p.caption ?? "—"}</p>
                      <p className="text-[11px] text-slate-500 tabular">{MEDIA_TYPE_LABEL[p.mediaType] ?? p.mediaType} · {fmtNum(p.views)} ko&apos;rish · {fmtNum(p.saves)} saqlash</p>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {a.worst.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"><TrendingDown size={13} /> Eng kam ko&apos;rilganlar</p>
              <ul className="space-y-1 text-xs text-slate-600">
                {a.worst.map((p) => <li key={p.id} className="flex justify-between gap-3"><span className="truncate">{p.caption?.slice(0, 80) ?? "—"}</span><span className="shrink-0 tabular">{fmtNum(p.views)}</span></li>)}
              </ul>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          {seeLeads && (
            <Card>
              <CardHeader title="Arizalar manbai" description={`${days} kun`} />
              {totalLeads === 0 ? <Empty text="Ariza yo'q" /> : (
                <ul className="space-y-3">
                  {[...leads].sort((x, y) => y._count - x._count).map((l) => (
                    <li key={l.utmSource ?? "-"}>
                      <div className="flex justify-between text-sm"><span>{l.utmSource ?? "To'g'ridan-to'g'ri / organik"}</span><span className="tabular">{l._count}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(l._count / totalLeads) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card padded={false}>
            <div className="p-4 pb-0"><CardHeader title="Yaqin nashrlar" icon={TrendingUp} action={<Link href="/marketing/kontent" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">Kontent reja <ArrowRight size={14} /></Link>} /></div>
            {upcoming.length === 0 ? <Empty text="Rejada nashr yo'q" /> : (
              <ul className="divide-y divide-slate-100">
                {upcoming.map((c) => (
                  <li key={c.id}>
                    <Link href={`/marketing/kontent/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                      <span className="truncate font-medium">{c.title}</span>
                      <span className="shrink-0 text-xs text-slate-500">{c.scheduledAt ? dateTime(c.scheduledAt) : "—"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
