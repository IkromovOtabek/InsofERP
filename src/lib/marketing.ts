/**
 * Marketing (Sotuv kabineti): yorliqlar va hisob-kitob.
 *
 * Lid manbai — `Lead.utmCampaign` (saytdagi formaga manzildagi UTM yoziladi). Kampaniya shu kalit bilan
 * bog'lanadi: lidlar, mijozga aylanganlar va ular ochgan zayavkalar summasi (bekor qilinmagan) → CPL, ROMI.
 */
import { db } from "./db";
import { orderTotal } from "@/lib/order-total";

export { CONTENT_STATUS, CONTENT_FLOW, CONTENT_TYPE, CHANNEL, CAMPAIGN_STATUS } from "./marketing-labels";

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
      select: { customerId: true, createdAt: true, deliveryFee: true, items: { select: { qtyM3: true, price: true } } },
    });
    // Mijoz bir nechta kampaniyadan kelgan bo'lsa — zayavka eng oxirgi (zayavkadan oldingi) lidga yoziladi
    for (const o of orders) {
      const lead = conv
        .filter((l) => l.customerId === o.customerId && l.createdAt <= o.createdAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (!lead) continue;
      const sum = orderTotal(o);
      out.get(lead.utmCampaign!)!.revenue += sum;
    }
  }
  return out;
}

/** Ulush foizda; maxraj nol bo'lsa — null */
export const ratio = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);
