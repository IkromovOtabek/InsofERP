import { ChevronDown } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { fmtNum, money, pct } from "@/lib/format";
import { CAMPAIGN_STATUS, CHANNEL, campaignStats, ratio } from "@/lib/marketing";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { CampaignForm, EMPTY_CAMPAIGN } from "./campaign-form";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const pctOr = (v: number | null) => (v === null ? "—" : pct(v));

/** Reklama kampaniyalari: xarajat (kabinetdan), lidlar va daromad (UTM → ariza → mijoz → zayavka). */
export default async function AdsPage() {
  const s = await requirePage("/marketing/reklama");
  const canEdit = canDo(s, "marketing", "ads");
  const [campaigns, stats] = await Promise.all([
    db.adCampaign.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    campaignStats(),
  ]);
  const rows = campaigns.map((c) => ({ c, s: (c.utmCampaign && stats.get(c.utmCampaign)) || { leads: 0, converted: 0, revenue: 0 }, spend: Number(c.spend) }));
  const t = rows.reduce((a, r) => ({ spend: a.spend + r.spend, clicks: a.clicks + r.c.clicks, leads: a.leads + r.s.leads, conv: a.conv + r.s.converted, revenue: a.revenue + r.s.revenue }), { spend: 0, clicks: 0, leads: 0, conv: 0, revenue: 0 });

  return (
    <div>
      <PageHeader title="Reklama" subtitle="Yandex Direct, Google Ads va Instagram. Xarajat va kliklarni kabinetdan kiriting; arizalar utm_campaign orqali avtomatik bog'lanadi, daromad — mijozga aylanganlarning zayavkalaridan." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Jami xarajat" value={money(t.spend)} hint={`Klik: ${fmtNum(t.clicks)}`} />
        <StatCard label="Arizalar (UTM)" value={fmtNum(t.leads)} hint={`CPL: ${t.leads ? money(t.spend / t.leads) : "—"}`} />
        <StatCard label="Mijoz bo'ldi" value={fmtNum(t.conv)} hint={`Konversiya: ${pctOr(ratio(t.conv, t.leads))}`} />
        <StatCard label="ROMI" value={pctOr(ratio(t.revenue - t.spend, t.spend))} hint={`Zayavkalar: ${money(t.revenue)}`} tone="info" />
      </div>

      {canEdit && (
        <details className="group mt-6 rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-medium">Kampaniya qo&apos;shish <ChevronDown size={16} className="transition group-open:rotate-180" /></summary>
          <div className="border-t border-slate-100 p-4"><CampaignForm id={null} v={EMPTY_CAMPAIGN} canEdit /></div>
        </details>
      )}

      <Card padded={false} className="mt-6">
        {rows.length === 0 ? (
          <EmptyState title="Kampaniya yo'q" text="Reklama tuzilmasi: docs/marketing/05-reklama.md" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map(({ c, s: st, spend }) => (
              <li key={c.id}>
                <details className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-2 items-center gap-3 px-4 py-3 hover:bg-slate-50 lg:grid-cols-[2fr_repeat(6,1fr)_auto]">
                    <div className="col-span-2 min-w-0 lg:col-span-1">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="truncate font-mono text-xs text-slate-500">{CHANNEL[c.channel]}{c.utmCampaign ? ` · ${c.utmCampaign}` : ""}</p>
                    </div>
                    <Metric k="Xarajat" v={money(spend)} />
                    <Metric k="Byudjet" v={money(c.budget)} />
                    <Metric k="CTR" v={pctOr(ratio(c.clicks, c.impressions))} />
                    <Metric k="CPC" v={c.clicks ? money(spend / c.clicks) : "—"} />
                    <Metric k="Ariza / mijoz" v={`${st.leads} / ${st.converted}`} />
                    <Metric k="CPL" v={st.leads ? money(spend / st.leads) : "—"} />
                    <Badge color={CAMPAIGN_STATUS[c.status].color}>{CAMPAIGN_STATUS[c.status].label}</Badge>
                  </summary>
                  <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                    <CampaignForm id={c.id} canEdit={canEdit} v={{
                      name: c.name, channel: c.channel, status: c.status, utmCampaign: c.utmCampaign ?? "",
                      budget: c.budget.toString(), spend: c.spend.toString(), impressions: c.impressions, clicks: c.clicks,
                      startDate: day(c.startDate), endDate: day(c.endDate), note: c.note ?? "",
                    }} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500">{k}</p>
      <p className="truncate text-sm tabular">{v}</p>
    </div>
  );
}
