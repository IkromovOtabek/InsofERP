import Link from "next/link";
import { ChevronLeft, ChevronRight, Eye, Facebook, Heart, Instagram, Plus, Send, UserPlus } from "lucide-react";
import type { SmmChannel } from "@/generated/prisma";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date, fmtNum } from "@/lib/format";
import { CONTENT_FLOW, CONTENT_STATUS, CONTENT_TYPE } from "@/lib/marketing";
import { APPROVAL } from "@/lib/smm/labels";
import { aiReady } from "@/lib/ai/smm-writer";
import { cn } from "@/lib/utils";
import { Badge, LinkButton, PageHeader, StatCard, Tabs } from "@/components/ui";
import { PlanAi } from "./plan-ai";

const CH_ICON: Record<SmmChannel, typeof Instagram> = { INSTAGRAM: Instagram, TELEGRAM: Send, FACEBOOK: Facebook };
const WEEK = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const pad = (n: number) => String(n).padStart(2, "0");
const ym = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** Kontent reja: oylik kalendar (chiqish vaqti bo'yicha) yoki kanban (ish holati bo'yicha) */
export default async function ContentPlanPage({ searchParams }: { searchParams: Promise<{ v?: string; m?: string }> }) {
  const s = await requirePage("/marketing/kontent");
  const sp = await searchParams;
  const view = sp.v === "kanban" ? "kanban" : "kalendar";
  const now = new Date();
  const [y, mo] = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m!.split("-").map(Number) as [number, number] : [now.getFullYear(), now.getMonth() + 1];
  const first = new Date(y, mo - 1, 1);
  const next = new Date(y, mo, 1);
  const prev = new Date(y, mo - 2, 1);

  const items = await db.marketingContent.findMany({
    orderBy: [{ scheduledAt: "asc" }, { publishDate: "asc" }, { createdAt: "asc" }],
    include: { media: { take: 1, orderBy: { sort: "asc" }, include: { media: { select: { id: true, kind: true } } } } },
  });
  const active = items.filter((i) => i.status !== "CANCELLED");
  const pub = active.filter((i) => i.status === "PUBLISHED");
  const sum = (k: "views" | "likes" | "leads") => pub.reduce((a, i) => a + i[k], 0);
  const pendingApproval = active.filter((i) => i.approval === "PENDING").length;
  const when = (i: (typeof items)[number]) => i.scheduledAt ?? (i.publishDate ? new Date(i.publishDate.getUTCFullYear(), i.publishDate.getUTCMonth(), i.publishDate.getUTCDate(), 12) : null);

  // Kalendar katakchalari: dushanbadan boshlanadi
  const lead = (first.getDay() + 6) % 7;
  const daysIn = new Date(y, mo, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + daysIn) / 7) * 7 }, (_, i) => {
    const d = i - lead + 1;
    return d >= 1 && d <= daysIn ? d : null;
  });
  const byDay = new Map<number, typeof items>();
  for (const i of active) {
    const w = when(i);
    if (!w || w < first || w >= next) continue;
    byDay.set(w.getDate(), [...(byDay.get(w.getDate()) ?? []), i]);
  }
  const unscheduled = active.filter((i) => !when(i) && i.status !== "PUBLISHED");
  const today = now.getFullYear() === y && now.getMonth() + 1 === mo ? now.getDate() : -1;
  const canEdit = canDo(s, "marketing", "content");

  return (
    <div>
      <PageHeader
        title="Kontent reja"
        subtitle="Reels va postlar: g'oya → ssenariy → suratga olish → tasdiqlash → tarmoqlarga avtomatik chiqish."
        action={canEdit ? (
          <>
            {canDo(s, "marketing", "agent") && aiReady() && <PlanAi defaultMonth={ym(first)} />}
            <LinkButton href="/marketing/kontent/new"><Plus size={15} /> Yangi post</LinkButton>
          </>
        ) : undefined}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Chiqdi" value={`${pub.length} / ${active.length}`} hint="nashr / rejada" />
        <StatCard label="Tasdiq kutmoqda" value={fmtNum(pendingApproval)} tone={pendingApproval ? "warning" : "default"} />
        <StatCard label="Ko'rishlar" value={fmtNum(sum("views"))} hint={`Layk: ${fmtNum(sum("likes"))}`} />
        <StatCard label="Kontentdan lid" value={fmtNum(sum("leads"))} />
      </div>

      <Tabs className="mt-6" current={view} items={[
        { key: "kalendar", label: "Kalendar", href: `/marketing/kontent?m=${ym(first)}` },
        { key: "kanban", label: "Ish holati", href: "/marketing/kontent?v=kanban" },
      ]} />

      {view === "kalendar" ? (
        <>
          <div className="mb-3 flex items-center justify-between">
            <Link href={`/marketing/kontent?m=${ym(prev)}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50" aria-label="Oldingi oy"><ChevronLeft size={16} /></Link>
            <h2 className="text-lg font-semibold">{MONTHS[mo - 1]} {y}</h2>
            <Link href={`/marketing/kontent?m=${ym(next)}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50" aria-label="Keyingi oy"><ChevronRight size={16} /></Link>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-xl border border-slate-200 bg-slate-200 gap-px">
              {WEEK.map((w) => <div key={w} className="bg-slate-50 px-2 py-1.5 text-center text-xs font-medium text-slate-500">{w}</div>)}
              {cells.map((d, i) => (
                <div key={i} className={cn("min-h-28 bg-white p-1.5", !d && "bg-slate-50/60")}>
                  {d && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-xs", d === today ? "bg-slate-900 font-semibold text-white" : "text-slate-500")}>{d}</span>
                        {canEdit && <Link href="/marketing/kontent/new" className="text-slate-300 hover:text-slate-700" aria-label="Post qo'shish"><Plus size={13} /></Link>}
                      </div>
                      <ul className="mt-1 space-y-1">
                        {(byDay.get(d) ?? []).map((p) => {
                          const w = when(p)!;
                          const thumb = p.media[0]?.media;
                          return (
                            <li key={p.id}>
                              <Link href={`/marketing/kontent/${p.id}`} className={cn("flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] leading-tight transition hover:shadow-sm",
                                p.status === "PUBLISHED" ? "border-emerald-200 bg-emerald-50" : p.approval === "APPROVED" ? "border-blue-200 bg-blue-50" : p.approval === "PENDING" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white")}>
                                {thumb && (thumb.kind === "IMAGE"
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={`/api/marketing/media/${thumb.id}`} alt="" className="h-7 w-5 shrink-0 rounded object-cover" loading="lazy" />
                                  : <span className="h-7 w-5 shrink-0 rounded bg-slate-800" />)}
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-slate-800">{p.title}</span>
                                  <span className="flex items-center gap-1 text-slate-500">
                                    {p.scheduledAt ? `${pad(w.getHours())}:${pad(w.getMinutes())}` : CONTENT_TYPE[p.type]}
                                    {p.channels.map((c) => { const I = CH_ICON[c]; return <I key={c} size={10} />; })}
                                  </span>
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-slate-300 bg-white" /> Qoralama</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-200" /> Tasdiq kutmoqda</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-200" /> Tasdiqlangan — o&apos;zi chiqadi</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" /> Chiqdi</span>
          </div>
          {unscheduled.length > 0 && (
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-3">
              <p className="mb-2 text-sm font-medium text-slate-700">Vaqti belgilanmagan ({unscheduled.length})</p>
              <ul className="flex flex-wrap gap-2">
                {unscheduled.map((p) => (
                  <li key={p.id}><Link href={`/marketing/kontent/${p.id}`} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:border-slate-400">{p.title} <Badge color={APPROVAL[p.approval].color} dot={false}>{APPROVAL[p.approval].label}</Badge></Link></li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 xl:grid xl:grid-cols-5 xl:overflow-visible">
          {CONTENT_FLOW.map((col) => {
            const list = active.filter((i) => i.status === col);
            return (
              <section key={col} className="w-72 shrink-0 snap-start rounded-xl bg-slate-100/80 p-2.5 xl:w-auto">
                <header className="mb-2.5 flex items-center justify-between px-1">
                  <Badge color={CONTENT_STATUS[col].color}>{CONTENT_STATUS[col].label}</Badge>
                  <span className="text-xs text-slate-500 tabular">{list.length}</span>
                </header>
                <ul className="space-y-2">
                  {list.map((i) => (
                    <li key={i.id}>
                      <Link href={`/marketing/kontent/${i.id}`} className="block rounded-lg border border-slate-200 bg-white p-3 shadow-xs transition hover:border-slate-400">
                        <div className="flex justify-between gap-2 text-[11px] text-slate-500">
                          <span className="truncate">{CONTENT_TYPE[i.type]}{i.rubric ? ` · ${i.rubric}` : ""}</span>
                          <span className="shrink-0">{when(i) ? date(when(i)!) : "—"}</span>
                        </div>
                        <p className="mt-1.5 text-sm leading-snug font-medium">{i.title}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <Badge color={APPROVAL[i.approval].color} dot={false}>{APPROVAL[i.approval].label}</Badge>
                          {i.status === "PUBLISHED" && (
                            <span className="flex gap-2 text-[11px] text-slate-500 tabular">
                              <span className="inline-flex items-center gap-1"><Eye size={11} />{fmtNum(i.views)}</span>
                              <span className="inline-flex items-center gap-1"><Heart size={11} />{fmtNum(i.likes)}</span>
                              <span className="inline-flex items-center gap-1"><UserPlus size={11} />{i.leads}</span>
                            </span>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
