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

export const MARKETING_SYSTEM = `Sen — beton va temir-beton zavodining SMM va marketing agentisan. ERP ichidagi Sotuv bo'limi (Marketing) xodimlari va reklama agentligi bilan ishlaysan: kontent reja, Reels ssenariylari, Instagram/Telegram/Facebook postlari, target va tahlil.

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
- create_post, update_post, plan_month va propose_boost faqat foydalanuvchi so'rasa yoki rozilik bersa — o'zboshimchalik bilan yaratma.
- Sen yaratgan post doim QORALAMA: tasdiqlash, tarmoqqa chiqarish va reklamani ishga tushirish — faqat odam (direktor) qiladi. Buni foydalanuvchiga ayt va havolani ber (/marketing/kontent/<id>).
- Postga media biriktirishdan oldin list_media bilan mavjud fayllarni ko'r; mos media bo'lmasa, qanday kadr kerakligini yoz (suratga olish ro'yxati).
- Kontent tahlilida list_content natijalari (ko'rish, layk, nashr holati) va target natijalariga (list_boosts) tayan.
- Target taklif qilganda: maqsad, auditoriya, kunlik byudjet va kun sonini asoslab ber; limitdan oshmasin (list_boosts limitni ko'rsatadi).
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
      select: { id: true, title: true, type: true, rubric: true, status: true, approval: true, channels: true, scheduledAt: true, publishDate: true, hook: true, views: true, likes: true, saves: true, leads: true, url: true, publications: { select: { channel: true, status: true, views: true, likes: true, comments: true, reach: true } }, _count: { select: { media: true } } },
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

  const postFields = {
    rubric: z.string().max(80).optional(),
    scheduled_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional().describe("Chiqish vaqti YYYY-MM-DDTHH:MM (Toshkent)"),
    channels: z.array(z.enum(["INSTAGRAM", "TELEGRAM", "FACEBOOK"])).optional().describe("Standart: INSTAGRAM, TELEGRAM"),
    hook: z.string().max(500).optional(),
    script: z.string().max(20_000).optional(),
    caption: z.string().max(2200).optional().describe("Asosiy izoh (rus tilida)"),
    caption_uz: z.string().max(2200).optional(),
    hashtags: z.string().max(500).optional(),
    media_ids: z.array(z.string()).max(10).optional().describe("list_media dagi id lar, tartib bilan"),
  };
  const when = (v?: string) => (v ? { scheduledAt: new Date(v), publishDate: new Date(`${v.slice(0, 10)}T00:00:00Z`) } : {});
  async function validMedia(ids?: string[]): Promise<string[] | string> {
    if (!ids?.length) return [];
    const uniq = [...new Set(ids)];
    const n = await db.smmMedia.count({ where: { id: { in: uniq } } });
    return n === uniq.length ? uniq : "Xato: media id lardan biri topilmadi — list_media bilan tekshir";
  }

  const createPost = betaZodTool({
    name: "create_post",
    description: "Kontent rejaga QORALAMA post qo'shadi (tasdiqlanmagan — hech qayerga chiqmaydi). Faqat foydalanuvchi so'raganda yoki rozilik berganda.",
    inputSchema: z.object({ title: z.string().min(2).max(160), type: z.enum(["REELS", "POST", "STORIES", "ARTICLE"]), ...postFields }),
    run: async (i) => {
      if (!canWriteContent) return "Xato: foydalanuvchida kontent rejaga yozish ruxsati yo'q.";
      const media = await validMedia(i.media_ids);
      if (typeof media === "string") return media;
      const row = await db.marketingContent.create({
        data: {
          title: i.title, type: i.type, rubric: i.rubric ?? null, status: i.script ? "SCRIPT" : "IDEA",
          hook: i.hook ?? null, script: i.script ?? null, caption: i.caption ?? null, captionUz: i.caption_uz ?? null, hashtags: i.hashtags ?? null,
          channels: i.channels ?? ["INSTAGRAM", "TELEGRAM"], ...when(i.scheduled_at), createdBy: `AI agent (${s.fullName})`,
          media: { create: media.map((mediaId, sort) => ({ mediaId, sort })) },
        },
      });
      const { audit } = await import("@/lib/audit");
      await audit(db, s.userId, "CREATE", "MarketingContent", row.id, undefined, { title: row.title, ai: true });
      return json({ created: true, id: row.id, link: `/marketing/kontent/${row.id}`, note: "Qoralama — tasdiqlash uchun odam ko'rib chiqadi" });
    },
  });

  const updatePost = betaZodTool({
    name: "update_post",
    description: "Qoralama yoki rad etilgan postni tahrirlaydi (matn, ssenariy, vaqt, tarmoqlar, media). Tasdiqlangan/chiqqan postni o'zgartirmaydi.",
    inputSchema: z.object({ id: z.string().min(1), title: z.string().min(2).max(160).optional(), ...postFields }),
    run: async (i) => {
      if (!canWriteContent) return "Xato: foydalanuvchida kontent rejaga yozish ruxsati yo'q.";
      const c = await db.marketingContent.findUnique({ where: { id: i.id }, select: { approval: true, status: true } });
      if (!c) return "Topilmadi";
      if (c.approval === "APPROVED" || c.approval === "PENDING" || c.status === "PUBLISHED") return "Xato: post tasdiqlashda yoki tasdiqlangan — faqat odam o'zgartiradi";
      const media = await validMedia(i.media_ids);
      if (typeof media === "string") return media;
      const data: Record<string, unknown> = { ...when(i.scheduled_at) };
      if (i.title) data.title = i.title;
      if (i.rubric !== undefined) data.rubric = i.rubric;
      if (i.hook !== undefined) data.hook = i.hook;
      if (i.script !== undefined) data.script = i.script;
      if (i.caption !== undefined) data.caption = i.caption;
      if (i.caption_uz !== undefined) data.captionUz = i.caption_uz;
      if (i.hashtags !== undefined) data.hashtags = i.hashtags;
      if (i.channels) data.channels = i.channels;
      const ok = await db.$transaction(async (tx) => {
        // Shartli: tekshiruvdan keyin post tasdiqlashga ketgan bo'lsa — tegilmaydi
        const u = await tx.marketingContent.updateMany({ where: { id: i.id, approval: { in: ["DRAFT", "REJECTED"] }, status: { not: "PUBLISHED" } }, data });
        if (u.count === 0) return false;
        if (i.media_ids) {
          await tx.marketingContentMedia.deleteMany({ where: { contentId: i.id } });
          if (media.length) await tx.marketingContentMedia.createMany({ data: media.map((mediaId, sort) => ({ contentId: i.id, mediaId, sort })) });
        }
        return true;
      });
      if (!ok) return "Xato: post shu orada tasdiqlashga yuborildi — faqat odam o'zgartiradi";
      const { audit } = await import("@/lib/audit");
      await audit(db, s.userId, "UPDATE", "MarketingContent", i.id, undefined, { ai: true, fields: Object.keys(data) });
      return json({ updated: true, link: `/marketing/kontent/${i.id}` });
    },
  });

  const planMonthTool = betaZodTool({
    name: "plan_month",
    description: "Tanlangan oy uchun kontent reja tuzadi va QORALAMA postlar yaratadi (ssenariy, izoh RU/UZ, heshteg, vaqt). Faqat so'ralganda; 1–2 daqiqa ishlaydi.",
    inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).describe("YYYY-MM"), count: z.number().int().min(1).max(16), focus: z.string().max(300).optional() }),
    run: async ({ month, count, focus }) => {
      if (!canWriteContent) return "Xato: foydalanuvchida kontent rejaga yozish ruxsati yo'q.";
      const { planMonth } = await import("./smm-writer");
      const [y, m] = month.split("-").map(Number) as [number, number];
      const plan = await planMonth({ year: y, month: m, count, focus });
      const ids: string[] = [];
      for (const p of plan.posts.slice(0, count)) {
        const okWhen = /^\d{4}-\d{2}-\d{2}$/.test(p.date) && /^\d{2}:\d{2}$/.test(p.time) ? `${p.date}T${p.time}` : undefined;
        const row = await db.marketingContent.create({
          data: {
            title: p.title.slice(0, 160), type: p.type, rubric: p.rubric.slice(0, 80), status: "SCRIPT", hook: p.hook, script: p.script,
            caption: p.caption.slice(0, 2200), captionUz: p.captionUz.slice(0, 2200), hashtags: p.hashtags, channels: ["INSTAGRAM", "TELEGRAM"],
            ...when(okWhen), createdBy: `AI reja (${s.fullName})`,
          },
        });
        ids.push(row.id);
      }
      const { audit } = await import("@/lib/audit");
      await audit(db, s.userId, "CREATE", "MarketingContentPlan", month, undefined, { ai: true, count: ids.length });
      return json({ created: ids.length, posts: plan.posts.map((p, k) => ({ id: ids[k], title: p.title, date: p.date, time: p.time, rubric: p.rubric })), link: "/marketing/kontent" });
    },
  });

  const listMedia = betaZodTool({
    name: "list_media",
    description: "Media kutubxona: rasm va videolar (id, nomi, teglari, turi, nechta postda ishlatilgan).",
    inputSchema: z.object({ tag: z.string().optional(), kind: z.enum(["IMAGE", "VIDEO"]).optional() }),
    run: async ({ tag, kind }) => json((await db.smmMedia.findMany({
      where: { ...(tag ? { tags: { has: tag.toLowerCase() } } : {}), ...(kind ? { kind } : {}) },
      orderBy: { createdAt: "desc" }, take: 80,
      select: { id: true, kind: true, title: true, tags: true, createdAt: true, _count: { select: { contents: true } } },
    })).map((m) => ({ id: m.id, kind: m.kind, title: m.title, tags: m.tags, used_in_posts: m._count.contents }))),
  });

  const listBoosts = betaZodTool({
    name: "list_boosts",
    description: "Target reklamalar: post, maqsad, auditoriya, byudjet, holat, sarflangan pul, qamrov, natija; va limitlar (kunlik, oylik, shu oy band).",
    inputSchema: z.object({}),
    run: async () => {
      const { marketingSettings, monthCommitted } = await import("@/lib/smm/boosts");
      const [rows, st, used] = await Promise.all([
        db.smmBoost.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { content: { select: { id: true, title: true } } } }),
        marketingSettings(), monthCommitted(),
      ]);
      return json({
        limits: { currency: st.adCurrency, daily_cap: Number(st.boostDailyCap), monthly_cap: Number(st.boostMonthlyCap), month_committed: used },
        boosts: rows.map((b) => ({ id: b.id, post: b.content.title, post_id: b.content.id, objective: b.objective, audience: b.audience, daily: Number(b.dailyBudget), days: b.days, status: b.status, spend: Number(b.spend), reach: b.reach, clicks: b.clicks, results: b.results })),
      });
    },
  });

  const proposeBoost = betaZodTool({
    name: "propose_boost",
    description: "Instagram'da chiqqan post uchun target SO'ROVI yaratadi (pul sarflanmaydi — direktor tasdiqlaydi). Auditoriya: toshkent | yetkazish | quruvchi | ozbekiston.",
    inputSchema: z.object({
      post_id: z.string().min(1), objective: z.enum(["REACH", "MESSAGES", "LEADS"]), audience: z.enum(["toshkent", "yetkazish", "quruvchi", "ozbekiston"]),
      daily_budget: z.number().positive(), days: z.number().int().min(1).max(30), reason: z.string().max(300).optional(),
    }),
    run: async (i) => {
      if (!canDo(s, "marketing", "boost")) return "Xato: foydalanuvchida target so'rovi yuborish ruxsati yo'q.";
      const { requestBoost } = await import("@/lib/smm/boosts");
      const r = await requestBoost({ contentId: i.post_id, objective: i.objective, audience: i.audience, dailyBudget: i.daily_budget, days: i.days, note: i.reason ? `AI: ${i.reason}` : "AI taklifi" }, { userId: s.userId, name: `AI agent (${s.fullName})` });
      return r.ok ? json({ requested: true, id: r.id, note: "Direktor tasdiqlashi kerak — /marketing/target" }) : `Xato: ${r.error}`;
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

  return [company, overview, leads, campaigns, listContent, getContent, createPost, updatePost, planMonthTool, listMedia, listBoosts, proposeBoost, keywords];
}

/** Vosita nomlari — chat oynasidagi belgilar uchun */
export const MARKETING_TOOL_LABELS: Record<string, string> = {
  get_company: "Korxona va katalog",
  get_overview: "Ko'rsatkichlar",
  list_leads: "Arizalar",
  list_campaigns: "Kampaniyalar",
  list_content: "Kontent reja",
  get_content: "Ssenariy",
  create_post: "Post qoralamasi yaratildi",
  update_post: "Post tahrirlandi",
  plan_month: "Oylik reja tuzildi",
  list_media: "Media kutubxona",
  list_boosts: "Target",
  propose_boost: "Target so'rovi yuborildi",
  list_keywords: "SEO yadro",
  web_search: "Internetdan qidiruv",
};
