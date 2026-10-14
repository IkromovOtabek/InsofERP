import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { SITE_URL } from "@/lib/site";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { UtmBuilder } from "./utm-builder";

/** UTM havola yasash — arizalar qaysi kampaniyadan kelgani panelda ko'rinsin. */
export default async function UtmPage() {
  await requirePage("/marketing/utm");
  const campaigns = await db.adCampaign.findMany({ where: { utmCampaign: { not: null } }, select: { utmCampaign: true }, orderBy: { createdAt: "desc" } });
  return (
    <div>
      <PageHeader title="UTM generator" subtitle="Har bir reklama va bio havolasiga UTM qo'ying. utm_campaign — Reklama bo'limidagi kampaniya bilan bir xil bo'lsin." />
      <Card><UtmBuilder siteUrl={SITE_URL.replace(/\/$/, "")} campaigns={campaigns.map((c) => c.utmCampaign!)} /></Card>
      <Card className="mt-4">
        <CardHeader title="Qoidalar" />
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>Faqat kichik lotin harf, raqam, <code>_</code> va <code>-</code>; bo&apos;sh joy o&apos;rniga <code>_</code>.</li>
          <li>utm_campaign: <code>kanal_tur_mahsulot</code> — <code>ya_search_fbs</code>, <code>gg_search_plita</code>, <code>ig_reels_02</code>.</li>
          <li>Yandex va Google&apos;da <code>{"{keyword}"}</code> makrosi kalit so&apos;zni o&apos;zi qo&apos;yadi.</li>
          <li>Instagram bio uchun «Instagram bio / Reels» presetini tanlang, utm_content&apos;ga Reels raqamini yozing.</li>
        </ul>
      </Card>
    </div>
  );
}
