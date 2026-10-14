import Link from "next/link";
import { ArrowRight, CalendarRange, Inbox, Megaphone, Search, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canView } from "@/lib/nav";
import { date, dateTime, fmtNum, money, pct } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { CONTENT_STATUS, CONTENT_TYPE, campaignStats, ratio } from "@/lib/marketing";
import { Badge, Card, CardHeader, Empty, PageHeader, StatCard } from "@/components/ui";

/** Marketing — bosh ko'rinish: joriy oy lidlari, reklama xarajati va natijasi, yaqin nashrlar. */
export default async function MarketingHome() {
  const s = await requirePage("/marketing");
  // Arizalar (telefon raqami bilan) — Sotuv moduli ma'lumoti: direktor uni yopib qo'ygan bo'lsa ko'rsatilmaydi
  const seeLeads = canView(s, "sales");
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const since30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [leadsMonth, convertedMonth, ads, stats, content, upcoming, recent, bySource, last30] = await Promise.all([
    db.lead.count({ where: { createdAt: { gte: from } } }),
    db.lead.count({ where: { createdAt: { gte: from }, status: "CONVERTED" } }),
    db.adCampaign.findMany({ select: { spend: true, clicks: true, utmCampaign: true } }),
    campaignStats(),
    db.marketingContent.groupBy({ by: ["status"], where: { publishDate: { gte: from } }, _count: true }),
    db.marketingContent.findMany({ where: { publishDate: { gte: today }, status: { notIn: ["PUBLISHED", "CANCELLED"] } }, orderBy: { publishDate: "asc" }, take: 5 }),
    seeLeads ? db.lead.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { id: true, name: true, phone: true, utmSource: true, utmCampaign: true, createdAt: true, status: true } }) : Promise.resolve([]),
    db.lead.groupBy({ by: ["utmSource"], where: { createdAt: { gte: from } }, _count: true }),
    db.lead.findMany({ where: { createdAt: { gte: since30 } }, select: { createdAt: true } }),
  ]);

  // Reklama ko'rsatkichlari — faqat ro'yxatdagi kampaniyalar (bepul bio/Reels havolalari kirmaydi), butun davr; «Reklama» sahifasi bilan bir xil
  const spend = ads.reduce((a, c) => a + Number(c.spend), 0);
  const clicks = ads.reduce((a, c) => a + c.clicks, 0);
  const keys = ads.map((c) => c.utmCampaign).filter((k): k is string => !!k);
  const utmLeads = keys.reduce((a, k) => a + (stats.get(k)?.leads ?? 0), 0);
  const revenue = keys.reduce((a, k) => a + (stats.get(k)?.revenue ?? 0), 0);
  const published = content.find((c) => c.status === "PUBLISHED")?._count ?? 0;
  const planned = content.filter((c) => c.status !== "CANCELLED").reduce((a, c) => a + c._count, 0);
  const romi = ratio(revenue - spend, spend);

  const days = Array.from({ length: 30 }, (_, i) => ({ d: new Date(since30.getFullYear(), since30.getMonth(), since30.getDate() + i), n: 0 }));
  for (const l of last30) {
    const i = Math.floor((new Date(l.createdAt.getFullYear(), l.createdAt.getMonth(), l.createdAt.getDate()).getTime() - since30.getTime()) / 86_400_000);
    if (i >= 0 && i < 30) days[i]!.n++;
  }
  const maxDay = Math.max(1, ...days.map((x) => x.n));
  const sources = bySource.sort((a, b) => b._count - a._count);
  const totalSrc = sources.reduce((a, s) => a + s._count, 0);

  return (
    <div>
      <PageHeader title="Marketing" subtitle="Saytdan kelgan arizalar, reklama xarajati va kontent reja — joriy oy bo'yicha. Reklama natijasi arizadagi UTM orqali hisoblanadi." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Arizalar (oy)" value={fmtNum(leadsMonth)} hint={`Mijoz bo'ldi: ${convertedMonth}`} icon={Inbox} href="/leads" />
        <StatCard label="Reklama xarajati" value={money(spend)} hint={`Jami davr · klik: ${fmtNum(clicks)}`} icon={Wallet} href="/marketing/reklama" />
        <StatCard label="Lid narxi (CPL)" value={utmLeads ? money(spend / utmLeads) : "—"} hint={`Jami davr · ROMI: ${romi === null ? "—" : pct(romi)}`} icon={Megaphone} tone="info" />
        <StatCard label="Kontent (oy)" value={`${published} / ${planned}`} hint="chiqdi / rejada" icon={CalendarRange} href="/marketing/kontent" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Arizalar — oxirgi 30 kun" />
          <div className="flex h-36 items-end gap-1" role="img" aria-label="Kunlik arizalar">
            {days.map((x) => (
              <div key={x.d.getTime()} className="group relative flex-1">
                <div className="rounded-t bg-slate-800/80 transition group-hover:bg-brand-500" style={{ height: `${Math.max(3, (x.n / maxDay) * 136)}px` }} />
                <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white group-hover:block">{date(x.d)}: {x.n}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-400"><span>{date(days[0]!.d)}</span><span>{date(days[29]!.d)}</span></div>
        </Card>
        <Card>
          <CardHeader title="Manba (utm_source)" description="Joriy oy" />
          {totalSrc === 0 ? <Empty text="Bu oy ariza yo'q" /> : (
            <ul className="space-y-3">
              {sources.map((s) => (
                <li key={s.utmSource ?? "-"}>
                  <div className="flex justify-between text-sm"><span>{s.utmSource ?? "To'g'ridan-to'g'ri / organik"}</span><span className="tabular">{s._count}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(s._count / totalSrc) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {seeLeads && <Card padded={false}>
          <div className="p-4 pb-0"><CardHeader title="Oxirgi arizalar" action={<Link href="/leads" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">Sayt arizalari <ArrowRight size={14} /></Link>} /></div>
          {recent.length === 0 ? <Empty text="Ariza yo'q" /> : (
            <ul className="divide-y divide-slate-100">
              {recent.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.name} <span className="text-xs font-normal text-slate-500">{formatPhone(l.phone)}</span></p>
                    <p className="truncate text-xs text-slate-500">{l.utmSource ? `${l.utmSource}${l.utmCampaign ? ` / ${l.utmCampaign}` : ""}` : "Organik"} · {dateTime(l.createdAt)}</p>
                  </div>
                  <Badge color={l.status === "NEW" ? "amber" : l.status === "CONVERTED" ? "green" : l.status === "IN_PROGRESS" ? "blue" : "slate"}>
                    {{ NEW: "Yangi", IN_PROGRESS: "Ishda", CONVERTED: "Mijoz bo'ldi", REJECTED: "Bekor" }[l.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>}
        <Card padded={false}>
          <div className="p-4 pb-0"><CardHeader title="Yaqin nashrlar" action={<Link href="/marketing/kontent" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">Kontent reja <ArrowRight size={14} /></Link>} /></div>
          {upcoming.length === 0 ? <Empty text="Rejada nashr yo'q" icon={Search} /> : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((c) => (
                <li key={c.id}>
                  <Link href={`/marketing/kontent/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.title}</p>
                      <p className="text-xs text-slate-500">{CONTENT_TYPE[c.type]} · {c.publishDate ? date(c.publishDate) : "—"}</p>
                    </div>
                    <Badge color={CONTENT_STATUS[c.status].color}>{CONTENT_STATUS[c.status].label}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
