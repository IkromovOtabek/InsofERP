/**
 * Marketing (Sotuv kabineti): yorliqlar va hisob-kitob.
 *
 * Lid manbai — `Lead.utmCampaign` (saytdagi formaga manzildagi UTM yoziladi). Kampaniya shu kalit bilan
 * bog'lanadi: lidlar, mijozga aylanganlar va ular ochgan zayavkalar summasi (bekor qilinmagan) → CPL, ROMI.
 */
import type { AdCampaignStatus, AdChannel, MarketingContentStatus, MarketingContentType } from "@/generated/prisma";
import type { BadgeColor } from "@/components/ui";
import { db } from "./db";

export const CONTENT_STATUS: Record<MarketingContentStatus, { label: string; color: BadgeColor }> = {
  IDEA: { label: "G'oya", color: "slate" },
  SCRIPT: { label: "Ssenariy", color: "blue" },
  FILMED: { label: "Suratga olindi", color: "violet" },
  EDITING: { label: "Montaj", color: "amber" },
  PUBLISHED: { label: "Chiqdi", color: "green" },
  CANCELLED: { label: "Bekor", color: "red" },
};
/** Kanban ustunlari (bekor qilinganlar alohida) */
export const CONTENT_FLOW: MarketingContentStatus[] = ["IDEA", "SCRIPT", "FILMED", "EDITING", "PUBLISHED"];

export const CONTENT_TYPE: Record<MarketingContentType, string> = {
  REELS: "Reels",
  POST: "Post",
  STORIES: "Stories",
  ARTICLE: "Maqola",
};

export const CHANNEL: Record<AdChannel, string> = {
  YANDEX: "Yandex",
  GOOGLE: "Google",
  INSTAGRAM: "Instagram",
  TELEGRAM: "Telegram",
  OTHER: "Boshqa",
};

export const CAMPAIGN_STATUS: Record<AdCampaignStatus, { label: string; color: BadgeColor }> = {
  DRAFT: { label: "Qoralama", color: "slate" },
  ACTIVE: { label: "Faol", color: "green" },
  PAUSED: { label: "To'xtatilgan", color: "amber" },
  FINISHED: { label: "Tugagan", color: "slate" },
};

export type CampaignStat = { leads: number; converted: number; revenue: number };

/**
 * utm_campaign bo'yicha: lidlar soni, mijozga aylanganlar va ularning zayavkalari summasi
 * (lid kelgandan keyin ochilgan, bekor/qoralama bo'lmagan zayavkalar; summa = hajm × kelishilgan narx).
 */
export async function campaignStats(since?: Date): Promise<Map<string, CampaignStat>> {
  const leads = await db.lead.findMany({
    where: { utmCampaign: { not: null }, ...(since ? { createdAt: { gte: since } } : {}) },
    select: { utmCampaign: true, status: true, customerId: true, createdAt: true },
  });
  const out = new Map<string, CampaignStat>();
  for (const l of leads) {
    const s = out.get(l.utmCampaign!) ?? { leads: 0, converted: 0, revenue: 0 };
    s.leads++;
    if (l.status === "CONVERTED") s.converted++;
    out.set(l.utmCampaign!, s);
  }

  const conv = leads.filter((l) => l.status === "CONVERTED" && l.customerId);
  if (conv.length) {
    const orders = await db.order.findMany({
      where: { customerId: { in: [...new Set(conv.map((l) => l.customerId!))] }, status: { notIn: ["CANCELLED", "DRAFT"] } },
      select: { customerId: true, createdAt: true, items: { select: { qtyM3: true, price: true } } },
    });
    // Mijoz bir nechta kampaniyadan kelgan bo'lsa — zayavka eng oxirgi (zayavkadan oldingi) lidga yoziladi
    for (const o of orders) {
      const lead = conv
        .filter((l) => l.customerId === o.customerId && l.createdAt <= o.createdAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (!lead) continue;
      const sum = o.items.reduce((a, i) => a + Number(i.qtyM3) * Number(i.price), 0);
      out.get(lead.utmCampaign!)!.revenue += sum;
    }
  }
  return out;
}

/** Ulush foizda; maxraj nol bo'lsa — null */
export const ratio = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);
