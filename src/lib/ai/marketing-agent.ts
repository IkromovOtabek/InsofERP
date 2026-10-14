/**
 * Marketing AI agenti (Sotuv → Marketing → AI agent): Claude + korxona bazasidagi vositalar + web qidiruv.
 *
 * Ko'p korxonali platforma: tizim ko'rsatmasida korxonaga xos fakt YO'Q — agent korxona va katalog
 * ma'lumotini `get_company` bilan o'sha korxona bazasidan oladi. Ko'rsatma o'zgarmas (prompt keshi ishlasin).
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { canDo } from "@/lib/permissions";
import { canView } from "@/lib/nav";
import type { Session } from "@/lib/auth";
import { campaignStats } from "@/lib/marketing";

export const MARKETING_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

export const MARKETING_SYSTEM = `Sen — beton va temir-beton zavodining marketing agentisan. ERP ichidagi Sotuv bo'limi (Marketing) xodimlari va reklama agentligi bilan ishlaysan.

## Ma'lumot manbai
- Korxona nomi, telefoni, manzili, tavsifi va mahsulot katalogi — get_company vositasida. Javob yoki matn yozishdan oldin kerak bo'lsa avval shuni chaqir.
- Arizalar (lidlar), reklama kampaniyalari, kontent reja va SEO yadro — tegishli vositalarda.
- Raqam, narx, xususiyat yoki da'voni o'ylab topma. Bazada yo'q bo'lsa «ma'lumot yo'q» de va nimani aniqlash kerakligini ayt.
- Qiyosiy da'volar («raqobatchilardan arzon», «24/7») faqat foydalanuvchi tasdiqlagan bo'lsa ishlatiladi; aks holda da'vosiz variant ber.

## Ish uslubi
- Javob tili — foydalanuvchi yozgan til (odatda o'zbek, lotin). Reels ovozi, reklama va SEO matnlari quruvchilar qidiradigan tilda: asosan rus tilida, kerak bo'lsa o'zbekcha variant bilan.
- Reels ssenariysi formati: davomiylik, hook (0–2 s), kadrlar ro'yxati, ovoz matni, ekrandagi matn, izoh va heshteglar, CTA.
- Reklama e'loni: sarlavha (56 belgigacha), matn (81 belgigacha), tavsiya etilgan kalit so'zlar va minus-so'zlar.
- Tahlilda: avval raqamlar (vositadan), keyin 2–3 ta aniq tavsiya. CPL = xarajat / ariza, ROMI = (zayavkalar − xarajat) / xarajat.
- create_content faqat foydalanuvchi so'rasa yoki rozilik bersa — o'zboshimchalik bilan yaratma.
- Raqobatchi yoki bozor haqida so'ralsa — web qidiruv, manbalarni ko'rsat.
- Qisqa yoz: natija, keyin keyingi qadam. Jadval kerak bo'lsa — markdown jadval.`;

const json = (v: unknown) => JSON.stringify(v);
const since = (days: number) => new Date(Date.now() - days * 86_400_000);
const LEAD_STATUS = ["NEW", "IN_PROGRESS", "CONVERTED", "REJECTED"] as const;
const CONTENT_STATUS = ["IDEA", "SCRIPT", "FILMED", "EDITING", "PUBLISHED", "CANCELLED"] as const;

export function marketingTools(s: Session) {
  const canWriteContent = canDo(s, "marketing", "content");
  // Arizalar — Sotuv moduli ma'lumoti: direktor yopib qo'ygan bo'lsa agent ham ko'rsatmaydi
  const canSeeLeads = canView(s, "sales");

  const company = betaZodTool({
    name: "get_company",
    description: "Korxona ma'lumoti (nomi, telefon, manzil, tavsif, ish vaqti, kunlik quvvat) va faol mahsulot katalogi (kod, nomi, birlik, mustahkamlik sinfi).",
    inputSchema: z.object({}),
    run: async () => {
      const [c, products] = await Promise.all([
        getCompany(),
        db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { code: true, name: true, unit: true, strengthClass: true, group: { select: { name: true } } } }),
      ]);
      return json({
        name: c.name, legal_name: c.legalName, phone: c.phone, email: c.email, address: c.address, about: c.about,
        working_hours: c.workingHours, founded_year: c.foundedYear, daily_capacity_m3: c.dailyCapacityM3 ? Number(c.dailyCapacityM3) : null,
        products: products.map((p) => ({ code: p.code, name: p.name, unit: p.unit, class: p.strengthClass, group: p.group?.name ?? null })),
      });
    },
  });

  const overview = betaZodTool({
    name: "get_overview",
    description: "Oxirgi N kun: arizalar holat va manba (utm) bo'yicha, kontent holati. Reklama (xarajat, klik, CPL) — butun davr bo'yicha, ro'yxatdagi kampaniyalar; kampaniya kesimi uchun list_campaigns.",
    inputSchema: z.object({ days: z.number().int().min(1).max(365).describe("Oxirgi necha kun, masalan 30") }),
    run: async ({ days }) => {
      const from = since(days);
      const [byStatus, bySource, ads, content] = await Promise.all([
        canSeeLeads ? db.lead.groupBy({ by: ["status"], where: { createdAt: { gte: from } }, _count: true }) : Promise.resolve([]),
        canSeeLeads ? db.lead.groupBy({ by: ["utmSource", "utmCampaign"], where: { createdAt: { gte: from } }, _count: true }) : Promise.resolve([]),
        db.adCampaign.findMany({ select: { spend: true, clicks: true, impressions: true, utmCampaign: true } }),
        db.marketingContent.groupBy({ by: ["status"], _count: true, _sum: { views: true, leads: true } }),
      ]);
      // CPL: xarajat va arizalar bir xil davr (butun davr) va bir xil kampaniyalar bo'yicha
      const keys = ads.map((c) => c.utmCampaign).filter((k): k is string => !!k);
      const adLeadsAllTime = keys.length ? await db.lead.count({ where: { utmCampaign: { in: keys } } }) : 0;
      const spend = ads.reduce((a, c) => a + Number(c.spend), 0);
      return json({
        period_days: days,
        leads_visible: canSeeLeads,
        leads_total: byStatus.reduce((a, x) => a + x._count, 0),
        leads_by_status: Object.fromEntries(byStatus.map((x) => [x.status, x._count])),
        leads_by_source: bySource.map((x) => ({ utm_source: x.utmSource, utm_campaign: x.utmCampaign, count: x._count })),
        ads_all_time: {
          spend_uzs: spend,
          clicks: ads.reduce((a, c) => a + c.clicks, 0),
          impressions: ads.reduce((a, c) => a + c.impressions, 0),
          leads_from_campaigns: adLeadsAllTime,
          cpl_uzs: adLeadsAllTime ? Math.round(spend / adLeadsAllTime) : null,
        },
        content_by_status: content.map((x) => ({ status: x.status, count: x._count, views: x._sum.views, leads: x._sum.leads })),
      });
    },
  });

  const leads = betaZodTool({
    name: "list_leads",
    description: "Sayt arizalari (eng yangilari birinchi): ism, mahsulot, hajm, xabar, UTM, holat. Telefon raqamlari qaytarilmaydi.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(365),
      status: z.enum(LEAD_STATUS).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: async ({ days, status, limit }) => {
      if (!canSeeLeads) return "Xato: foydalanuvchida Sotuv (arizalar) bo'limini ko'rish ruxsati yo'q.";
      const rows = await db.lead.findMany({
        where: { createdAt: { gte: since(days) }, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit ?? 50,
        select: { name: true, qty: true, message: true, source: true, utmSource: true, utmCampaign: true, landingPage: true, status: true, createdAt: true, product: { select: { name: true } } },
      });
      return json(rows.map((r) => ({ ...r, qty: r.qty ? Number(r.qty) : null, product: r.product?.name ?? null })));
    },
  });

  const campaigns = betaZodTool({
    name: "list_campaigns",
    description: "Reklama kampaniyalari: kanal, holat, byudjet, xarajat, ko'rsatish, klik; utm_campaign bo'yicha arizalar, mijozga aylanganlar va ularning zayavkalari summasi.",
    inputSchema: z.object({}),
    run: async () => {
      const [rows, stats] = await Promise.all([db.adCampaign.findMany({ orderBy: { createdAt: "desc" } }), campaignStats()]);
      return json(rows.map((c) => {
        const st = (c.utmCampaign && stats.get(c.utmCampaign)) || { leads: 0, converted: 0, revenue: 0 };
        return {
          name: c.name, channel: c.channel, status: c.status, utm_campaign: c.utmCampaign,
          budget_uzs: Number(c.budget), spend_uzs: Number(c.spend), impressions: c.impressions, clicks: c.clicks,
          leads: st.leads, converted: st.converted, orders_revenue_uzs: Math.round(st.revenue),
        };
      }));
    },
  });

  const listContent = betaZodTool({
    name: "list_content",
    description: "Kontent reja: Reels/post/maqola — sarlavha, rubrika, holat, nashr sanasi, natijalar. To'liq ssenariy uchun get_content.",
    inputSchema: z.object({ status: z.enum(CONTENT_STATUS).optional() }),
    run: async ({ status }) => json(await db.marketingContent.findMany({
      where: status ? { status } : {},
      orderBy: { publishDate: "asc" },
      select: { id: true, title: true, type: true, rubric: true, status: true, publishDate: true, hook: true, views: true, likes: true, saves: true, leads: true, url: true },
    })),
  });

  const getContent = betaZodTool({
    name: "get_content",
    description: "Bitta kontentning to'liq ma'lumoti: ssenariy, hook, izoh.",
    inputSchema: z.object({ id: z.string().min(1) }),
    run: async ({ id }) => {
      const row = await db.marketingContent.findUnique({ where: { id } });
      return row ? json(row) : "Topilmadi";
    },
  });

  const createContent = betaZodTool({
    name: "create_content",
    description: "Kontent rejaga yangi element qo'shadi (holat «Ssenariy»). Faqat foydalanuvchi so'raganda yoki rozilik berganda.",
    inputSchema: z.object({
      title: z.string().min(2).max(160),
      type: z.enum(["REELS", "POST", "STORIES", "ARTICLE"]),
      rubric: z.string().max(80).optional(),
      publish_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
      hook: z.string().max(500).optional(),
      script: z.string().max(20_000),
      caption: z.string().max(4000).optional(),
    }),
    run: async (i) => {
      if (!canWriteContent) return "Xato: foydalanuvchida kontent rejaga yozish ruxsati yo'q.";
      const row = await db.marketingContent.create({
        data: {
          title: i.title, type: i.type, rubric: i.rubric ?? null, status: "SCRIPT",
          publishDate: i.publish_date ? new Date(`${i.publish_date}T00:00:00Z`) : null,
          hook: i.hook ?? null, script: i.script, caption: i.caption ?? null, createdBy: `AI agent (${s.fullName})`,
        },
      });
      const { audit } = await import("@/lib/audit");
      await audit(db, s.userId, "CREATE", "MarketingContent", row.id, undefined, row);
      return json({ created: true, id: row.id, link: `/marketing/kontent/${row.id}` });
    },
  });

  const keywords = betaZodTool({
    name: "list_keywords",
    description: "SEO semantik yadro: so'rov, klaster, til, sahifa, Wordstat chastotasi, Yandex/Google pozitsiyasi.",
    inputSchema: z.object({ cluster: z.string().optional().describe("Klaster nomining bir qismi") }),
    run: async ({ cluster }) => json(await db.seoKeyword.findMany({
      where: cluster ? { cluster: { contains: cluster, mode: "insensitive" } } : {},
      orderBy: [{ cluster: "asc" }, { phrase: "asc" }],
      select: { phrase: true, cluster: true, lang: true, url: true, frequency: true, posYandex: true, posGoogle: true, checkedAt: true },
    })),
  });

  return [company, overview, leads, campaigns, listContent, getContent, createContent, keywords];
}

/** Vosita nomlari — chat oynasidagi belgilar uchun */
export const MARKETING_TOOL_LABELS: Record<string, string> = {
  get_company: "Korxona va katalog",
  get_overview: "Ko'rsatkichlar",
  list_leads: "Arizalar",
  list_campaigns: "Kampaniyalar",
  list_content: "Kontent reja",
  get_content: "Ssenariy",
  create_content: "Kontent rejaga qo'shildi",
  list_keywords: "SEO yadro",
  web_search: "Internetdan qidiruv",
};
