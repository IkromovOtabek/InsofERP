/**
 * Target (reklama) mantig'i. Pul sarflanadigan joy — shuning uchun qat'iy:
 *  · so'rov (requestBoost) faqat PENDING_APPROVAL yaratadi, Meta'ga hech narsa yuborilmaydi;
 *  · ishga tushirish faqat «boost_approve» huquqi bilan (odatda direktor), limitlar qayta tekshiriladi;
 *  · bitta reklamaning kunlik byudjeti va oy bo'yicha jami rejalashtirilgan summa — MarketingSettings limitlari;
 *  · holat o'tishlari shartli updateMany (ikki marta bosilsa ikki marta ishga tushmaydi);
 *  · AI agent faqat so'rov yarata oladi.
 */
import { Prisma } from "@/generated/prisma";
import type { SmmBoostObjective } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fmtNum } from "@/lib/format";
import { notifyAfter, notifyRoles, notifyUsers } from "@/lib/notify";
import { adsReady, smmDryRun } from "./config";
import { audienceByKey } from "./audiences";
import { BOOST_COUNTED } from "./labels";
import { boostStats, launchBoost, setCampaignStatus } from "./meta";

const fmtMoney = (n: number) => `${fmtNum(n, 2)}`;

/** Target so'ragan xodimga — qaror haqida */
function notifyRequester(id: string, title: string, body: string) {
  notifyAfter(async () => {
    const b = await db.smmBoost.findUnique({ where: { id }, select: { requestedById: true, content: { select: { title: true } } } });
    if (b?.requestedById) await notifyUsers([b.requestedById], { type: "BOOST_DECIDED", title, body: `${b.content.title} · ${body}`, link: { key: "boost", id } });
  });
}

export async function marketingSettings() {
  // Birinchi ochilishda ikki so'rov bir vaqtda yaratmoqchi bo'lsa — biri P2002 oladi, mavjud yozuv qaytariladi
  return db.marketingSettings.upsert({ where: { id: "main" }, create: { id: "main" }, update: {} })
    .catch(() => db.marketingSettings.findUniqueOrThrow({ where: { id: "main" } }));
}

/**
 * Joriy oyga tushadigan jami byudjet (kunlik × kun). Ishga tushganlari — faqat shu oyga to'g'ri kelgan kunlari
 * (o'tgan oyda boshlanib davom etayotgani ham); hali tasdiqlanmagan/yuborilayotgani — to'liq.
 */
export async function monthCommitted(excludeId?: string, now = new Date()): Promise<number> {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const rows = await db.smmBoost.findMany({
    where: {
      status: { in: BOOST_COUNTED },
      OR: [{ startAt: null }, { startAt: { lt: to }, endAt: { gt: from } }],
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { dailyBudget: true, days: true, startAt: true, endAt: true },
  });
  return rows.reduce((a, r) => {
    if (!r.startAt || !r.endAt) return a + Number(r.dailyBudget) * r.days;
    const ms = Math.min(r.endAt.getTime(), to.getTime()) - Math.max(r.startAt.getTime(), from.getTime());
    return a + Number(r.dailyBudget) * Math.min(r.days, Math.max(0, Math.ceil(ms / 86_400_000)));
  }, 0);
}

type Actor = { userId: string; name: string };
type Res = { ok: true; id?: string; note?: string } | { ok: false; error: string };

async function checkCaps(daily: number, days: number, excludeId?: string): Promise<string | null> {
  const s = await marketingSettings();
  if (daily > Number(s.boostDailyCap)) return `Kunlik byudjet limitdan katta (${Number(s.boostDailyCap)} ${s.adCurrency})`;
  const used = await monthCommitted(excludeId);
  if (used + daily * days > Number(s.boostMonthlyCap)) {
    return `Oylik limitdan oshadi: band ${used.toFixed(2)} + ${(daily * days).toFixed(2)} > ${Number(s.boostMonthlyCap)} ${s.adCurrency}`;
  }
  return null;
}

export async function requestBoost(p: { contentId: string; objective: SmmBoostObjective; audience: string; dailyBudget: number; days: number; note?: string | null }, actor: Actor): Promise<Res> {
  if (!audienceByKey(p.audience)) return { ok: false, error: "Auditoriya noto'g'ri" };
  if (!(p.dailyBudget > 0) || !Number.isInteger(p.days) || p.days < 1 || p.days > 30) return { ok: false, error: "Byudjet va kun (1–30) to'g'ri kiritilsin" };
  const ig = await db.smmPublication.findUnique({ where: { contentId_channel: { contentId: p.contentId, channel: "INSTAGRAM" } } });
  if (!ig || (ig.status !== "PUBLISHED" && ig.status !== "SIMULATED")) return { ok: false, error: "Avval post Instagram'da chiqishi kerak" };
  const cap = await checkCaps(p.dailyBudget, p.days);
  if (cap) return { ok: false, error: cap };
  const b = await db.smmBoost.create({
    data: {
      contentId: p.contentId, objective: p.objective, audience: p.audience, dailyBudget: new Prisma.Decimal(p.dailyBudget.toFixed(2)), days: p.days,
      note: p.note || null, requestedById: actor.userId, requestedByName: actor.name,
    },
  });
  await audit(db, actor.userId, "CREATE", "SmmBoost", b.id, undefined, b);
  // Pul sarflanadigan so'rov — direktor bilmasa kutib qoladi
  notifyAfter(async () => {
    const c = await db.marketingContent.findUnique({ where: { id: p.contentId }, select: { title: true } });
    await notifyRoles(["DIRECTOR"], {
      type: "BOOST_PENDING", title: `Target so'rovi — ${fmtMoney(p.dailyBudget * p.days)}`,
      body: `${c?.title ?? "Post"} · ${p.days} kun × ${fmtMoney(p.dailyBudget)} · so'radi: ${actor.name}`, link: { key: "boost", id: b.id },
    }, { except: actor.userId });
  });
  return { ok: true, id: b.id };
}

export async function approveBoost(id: string, actor: Actor): Promise<Res> {
  const b = await db.smmBoost.findUnique({ where: { id }, include: { content: { select: { title: true } } } });
  if (!b) return { ok: false, error: "Reklama topilmadi" };
  // Limit tekshiruvi va egallash bitta qulf ostida: ikki target bir vaqtda tasdiqlansa, ikkalasi limitdan o'tib ketmasin
  const gate = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('smm_boost_caps'))`;
    const cap = await checkCaps(Number(b.dailyBudget), b.days, b.id);
    if (cap) return cap;
    const claim = await tx.smmBoost.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "LAUNCHING", approvedById: actor.userId, approvedByName: actor.name, approvedAt: new Date() } });
    return claim.count === 0 ? "Reklama allaqachon ko'rib chiqilgan" : null;
  });
  if (gate) return { ok: false, error: gate };

  const start = new Date(Date.now() + 10 * 60_000);
  const end = new Date(start.getTime() + b.days * 86_400_000);
  const ig = await db.smmPublication.findUnique({ where: { contentId_channel: { contentId: b.contentId, channel: "INSTAGRAM" } } });

  const ready = await adsReady();
  if (smmDryRun() || !ready || ig?.status !== "PUBLISHED" || !ig.externalId) {
    const why = smmDryRun() ? "Sinov rejimi" : !ready ? "Meta reklama kabineti ulanmagan (Sozlamalar)" : "Post Instagram'da haqiqatda chiqmagan (sinov nashri)";
    await db.smmBoost.update({ where: { id }, data: { status: "SIMULATED", error: `${why} — Meta'ga yuborilmadi, pul sarflanmadi`, startAt: start, endAt: end } });
    await audit(db, actor.userId, "STATUS_CHANGE", "SmmBoost", id, b, { status: "SIMULATED" });
    return { ok: true, note: `${why}: reklama sinov rejimida belgilandi, pul sarflanmadi` };
  }
  try {
    const a = audienceByKey(b.audience)!;
    const r = await launchBoost({
      name: `INSOF · ${b.content.title}`.slice(0, 120), igMediaId: ig.externalId, objective: b.objective, targeting: a.targeting, dailyBudget: Number(b.dailyBudget), currency: (await marketingSettings()).adCurrency, start, end,
      saved: async (ids) => { await db.smmBoost.update({ where: { id }, data: { metaCampaignId: ids.campaignId, metaAdSetId: ids.adSetId, metaAdId: ids.adId, startAt: start, endAt: end } }); },
    });
    await db.smmBoost.update({ where: { id }, data: { status: "ACTIVE", metaCampaignId: r.campaignId, metaAdSetId: r.adSetId, metaAdId: r.adId, startAt: start, endAt: end, error: null } });
    await audit(db, actor.userId, "STATUS_CHANGE", "SmmBoost", id, b, { status: "ACTIVE", ...r });
    notifyRequester(id, "Target ishga tushdi", "Reklama Meta'da faol");
    return { ok: true, note: "Reklama Meta'da ishga tushirildi" };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    // Kampaniya yaratilgan bo'lsa (yoqish so'rovi Meta'da bajarilgan bo'lishi ham mumkin) — darhol to'xtatamiz
    const cur = await db.smmBoost.findUnique({ where: { id }, select: { metaCampaignId: true } });
    let status: "FAILED" | "ACTIVE" = "FAILED";
    let error = message;
    if (cur?.metaCampaignId) {
      try {
        await setCampaignStatus(cur.metaCampaignId, "PAUSED");
        error = `${message} (Meta'dagi kampaniya to'xtatildi)`;
      } catch {
        // To'xtatib bo'lmadi — ishlayotgan deb hisoblaymiz: limitga kiradi, statistika tortiladi, «To'xtatish» tugmasi chiqadi
        status = "ACTIVE";
        error = `${message} — kampaniya to'xtatilmadi, Meta Ads Manager'da tekshiring yoki «To'xtatish»ni bosing`;
      }
    }
    await db.smmBoost.update({ where: { id }, data: { status, error } });
    await audit(db, actor.userId, "STATUS_CHANGE", "SmmBoost", id, b, { status, error });
    return { ok: false, error };
  }
}

export async function rejectBoost(id: string, reason: string | null, actor: Actor): Promise<Res> {
  const r = await db.smmBoost.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "REJECTED", error: reason, approvedById: actor.userId, approvedByName: actor.name, approvedAt: new Date() } });
  if (r.count === 0) return { ok: false, error: "Reklama allaqachon ko'rib chiqilgan" };
  await audit(db, actor.userId, "STATUS_CHANGE", "SmmBoost", id, undefined, { status: "REJECTED", reason });
  notifyRequester(id, "Target so'rovi rad etildi", reason ? `Sabab: ${reason}` : "Direktor rad etdi");
  return { ok: true };
}

/** To'xtatish / davom ettirish (faqat Meta'da haqiqatda ishlayotgani) */
export async function toggleBoost(id: string, to: "PAUSED" | "ACTIVE", actor: Actor): Promise<Res> {
  const b = await db.smmBoost.findUnique({ where: { id } });
  if (!b?.metaCampaignId) return { ok: false, error: "Bu reklama Meta'da ishlamayapti" };
  if (to === "ACTIVE" && b.endAt && b.endAt < new Date()) return { ok: false, error: "Reklama muddati tugagan" };
  const from = to === "PAUSED" ? "ACTIVE" : "PAUSED";
  const r = await db.smmBoost.updateMany({ where: { id, status: from }, data: { status: to } });
  if (r.count === 0) return { ok: false, error: "Holat o'zgargan — sahifani yangilang" };
  try {
    await setCampaignStatus(b.metaCampaignId, to);
  } catch (e) {
    await db.smmBoost.update({ where: { id }, data: { status: from } });
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await audit(db, actor.userId, "STATUS_CHANGE", "SmmBoost", id, { status: from }, { status: to });
  return { ok: true };
}

/** Faol reklamalar natijasi (har 30 daqiqada) va muddati tugaganlarini yopish */
export async function syncBoosts(now = new Date()): Promise<number> {
  const rows = await db.smmBoost.findMany({ where: { status: { in: ["ACTIVE", "PAUSED"] }, metaCampaignId: { not: null } }, take: 50 });
  let n = 0;
  for (const b of rows) {
    try {
      const s = await boostStats(b.metaCampaignId!, b.objective);
      const done = (b.endAt && b.endAt < now) || s.effective === "COMPLETED";
      await db.smmBoost.update({
        where: { id: b.id },
        data: { spend: new Prisma.Decimal(s.spend.toFixed(2)), impressions: s.impressions, reach: s.reach, clicks: s.clicks, results: s.results, statsAt: now, ...(done ? { status: "COMPLETED" } : {}) },
      });
      n++;
    } catch (e) {
      console.error("[smm] reklama statistikasi", b.id, e instanceof Error ? e.message : e);
    }
  }
  return n;
}
