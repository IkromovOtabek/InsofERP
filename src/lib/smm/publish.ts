/**
 * Nashr dvigateli: tasdiqlangan postni tanlangan tarmoqlarga chiqaradi.
 *
 * Har tarmoq — alohida `SmmPublication`. Ikki marta chiqib ketmasligi uchun yozuv shartli `updateMany`
 * bilan «egallanadi» (PENDING/FAILED → PUBLISHING); egallay olmagan jarayon o'tkazib yuboradi.
 * Sinov rejimi — natija SIMULATED (tarmoqqa hech narsa yuborilmaydi). Kalit yo'q bo'lsa — FAILED:
 * profil ulangach «Qayta urinish» bilan chiqariladi (jimgina «chiqdi» bo'lib qolmaydi).
 * Xato bo'lgan nashr avtomatik qayta yuborilmaydi (tarmoq tomonida chiqib ulgurgan bo'lishi mumkin) —
 * xodim «Qayta urinish» bosadi.
 */
import path from "node:path";
import type { SmmChannel } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { channelReady, smmDryRun } from "./config";
import { mediaPath, publicMediaUrl } from "./media";
import { publishTelegram, type PostMedia } from "./telegram";
import { facebookStats, instagramStats, publishFacebook, publishInstagram, type PostStats } from "./meta";
import { CHANNEL_LABEL } from "./labels";

/** Post matni: asosiy (RU) + o'zbekcha + heshteglar (+ korxonaning standart heshteglari) */
export function composeText(c: { caption: string | null; captionUz: string | null; hashtags: string | null }, defaultTags?: string | null): string {
  const tags = [c.hashtags, defaultTags].filter(Boolean).join(" ").trim();
  return [c.caption?.trim(), c.captionUz?.trim(), tags].filter(Boolean).join("\n\n");
}

export type PublishOutcome = { channel: SmmChannel; status: "PUBLISHED" | "FAILED" | "SIMULATED" | "SKIPPED"; message?: string };

// Eng uzun holat: 10 ta videoli karusel (har konteyner 5 daqiqagacha kutiladi) — undan katta zaxira bilan
const STUCK_MS = 90 * 60_000;

/** Bitta postni chiqarish. `userId` — kim bosgani (avtomatik nashrda null). */
export async function publishContent(contentId: string, userId: string | null): Promise<PublishOutcome[]> {
  const c = await db.marketingContent.findUnique({
    where: { id: contentId },
    include: { media: { orderBy: { sort: "asc" }, include: { media: true } }, publications: true },
  });
  if (!c) throw new Error("Post topilmadi");
  if (c.approval !== "APPROVED") throw new Error("Post tasdiqlanmagan");
  if (c.status === "CANCELLED") throw new Error("Post bekor qilingan");
  if (!c.channels.length) throw new Error("Post uchun tarmoq tanlanmagan");
  const settings = await db.marketingSettings.findUnique({ where: { id: "main" } });
  const text = composeText(c, settings?.defaultHashtags);

  // Uzilib qolgan (jarayon to'xtagan) nashrlar — xato deb belgilanadi, xodim tekshirib qayta yuboradi
  await db.smmPublication.updateMany({
    where: { contentId, status: "PUBLISHING", updatedAt: { lt: new Date(Date.now() - STUCK_MS) } },
    data: { status: "FAILED", error: "Nashr uzilib qoldi — tarmoqda chiqqan-chiqmaganini tekshirib, qayta yuboring" },
  });

  const files: PostMedia[] = [];
  for (const m of c.media) {
    const file = mediaPath(m.media.fileName);
    if (file) files.push({ kind: m.media.kind, file, mime: m.media.mime, name: path.basename(file) });
  }

  const out: PublishOutcome[] = [];
  for (const channel of c.channels) {
    const pub = await db.smmPublication.upsert({
      where: { contentId_channel: { contentId, channel } },
      create: { contentId, channel },
      update: {},
    });
    const claim = await db.smmPublication.updateMany({
      where: { id: pub.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "PUBLISHING", attempts: { increment: 1 }, error: null },
    });
    if (claim.count === 0) { out.push({ channel, status: "SKIPPED", message: "allaqachon chiqarilgan yoki yuborilmoqda" }); continue; }

    if (smmDryRun()) {
      const reason = "Sinov rejimi — tarmoqqa yuborilmadi";
      await db.smmPublication.update({ where: { id: pub.id }, data: { status: "SIMULATED", error: reason, publishedAt: new Date() } });
      out.push({ channel, status: "SIMULATED", message: reason });
      continue;
    }
    if (!(await channelReady(channel))) {
      const reason = `${CHANNEL_LABEL[channel]} ulanmagan — Marketing → Sozlamalar'da profilni ulab, qayta yuboring`;
      await db.smmPublication.update({ where: { id: pub.id }, data: { status: "FAILED", error: reason } });
      out.push({ channel, status: "FAILED", message: reason });
      continue;
    }
    try {
      if (channel !== "TELEGRAM" && !files.length) throw new Error(`${CHANNEL_LABEL[channel]} uchun kamida bitta rasm yoki video kerak`);
      const metaMedia = files.map((f) => ({ kind: f.kind, url: publicMediaUrl(c.media.find((m) => mediaPath(m.media.fileName) === f.file)!.media.id) }));
      const r = channel === "TELEGRAM" ? await publishTelegram(text, files)
        : channel === "INSTAGRAM" ? await publishInstagram(text, metaMedia, { locationId: c.locationId })
        : await publishFacebook(text, metaMedia);
      await db.smmPublication.update({ where: { id: pub.id }, data: { status: "PUBLISHED", externalId: r.externalId, permalink: r.permalink, publishedAt: new Date(), error: null } });
      out.push({ channel, status: "PUBLISHED" });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await db.smmPublication.update({ where: { id: pub.id }, data: { status: "FAILED", error: message } });
      out.push({ channel, status: "FAILED", message });
    }
  }

  // Hamma tarmoq yakunlandi — post «Chiqdi»; havola — birinchi haqiqiy nashrdan
  const pubs = await db.smmPublication.findMany({ where: { contentId } });
  const finished = pubs.filter((p) => c.channels.includes(p.channel)).every((p) => p.status === "PUBLISHED" || p.status === "SIMULATED");
  if (finished) {
    const link = pubs.find((p) => p.status === "PUBLISHED" && p.permalink)?.permalink ?? c.url;
    // Mahalliy (Toshkent) sana: UTC bo'yicha olinsa, 00:00–05:00 da kechagi kun yozilardi
    const d = new Date();
    const today = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    await db.marketingContent.update({ where: { id: contentId }, data: { status: "PUBLISHED", url: link, publishDate: c.publishDate ?? today } });
  }
  // Avtomatik nashr (rejalashtiruvchi) — postni tasdiqlagan xodim nomidan yoziladi
  const actor = userId ?? c.approvedById;
  if (actor) await audit(db, actor, "UPDATE", "SmmPublish", contentId, undefined, { auto: !userId, out });
  return out;
}

/** Vaqti kelgan tasdiqlangan postlar (rejalashtiruvchi chaqiradi) */
export async function publishDue(now = new Date()): Promise<number> {
  const due = await db.marketingContent.findMany({
    // Xato bilan to'xtagan post avtomatik qayta yuborilmaydi — so'rovning o'zida chiqariladi,
    // aks holda 20 ta eski xato post navbatni egallab, yangilari hech qachon chiqmasdi
    where: {
      approval: "APPROVED", scheduledAt: { lte: now }, status: { notIn: ["PUBLISHED", "CANCELLED"] }, NOT: { channels: { isEmpty: true } },
      publications: { none: { status: { in: ["FAILED", "PUBLISHING"] } } },
    },
    select: { id: true },
    take: 20,
    orderBy: { scheduledAt: "asc" },
  });
  let n = 0;
  for (const c of due) {
    try { await publishContent(c.id, null); n++; } catch (e) { console.error("[smm] nashr", c.id, e instanceof Error ? e.message : e); }
  }
  return n;
}

/** Chiqqan postlar statistikasi (oxirgi 45 kun, har 3 soatda) → nashr va post kartochkasi */
export async function syncPublicationStats(now = new Date()): Promise<number> {
  const pubs = await db.smmPublication.findMany({
    where: {
      status: "PUBLISHED", externalId: { not: null }, channel: { in: ["INSTAGRAM", "FACEBOOK"] },
      publishedAt: { gte: new Date(now.getTime() - 45 * 86_400_000) },
      OR: [{ statsAt: null }, { statsAt: { lt: new Date(now.getTime() - 3 * 3600_000) } }],
    },
    take: 50,
  });
  let n = 0;
  for (const p of pubs) {
    if (!(await channelReady(p.channel))) continue;
    try {
      const s: PostStats = p.channel === "INSTAGRAM" ? await instagramStats(p.externalId!) : await facebookStats(p.externalId!);
      await db.smmPublication.update({ where: { id: p.id }, data: { ...s, statsAt: now } });
      n++;
    } catch (e) {
      console.error("[smm] statistika", p.id, e instanceof Error ? e.message : e);
      await db.smmPublication.update({ where: { id: p.id }, data: { statsAt: now } });
    }
  }
  // Post kartochkasidagi umumiy raqamlar — tarmoqlar yig'indisi (qo'lda kiritilganidan katta bo'lsa)
  const touched = [...new Set(pubs.map((p) => p.contentId))];
  for (const id of touched) {
    const all = await db.smmPublication.findMany({ where: { contentId: id, status: "PUBLISHED" } });
    const sum = (k: "views" | "likes" | "saves") => all.reduce((a, p) => a + (p[k] ?? 0), 0);
    const c = await db.marketingContent.findUnique({ where: { id }, select: { views: true, likes: true, saves: true } });
    if (!c) continue;
    await db.marketingContent.update({ where: { id }, data: { views: Math.max(c.views, sum("views")), likes: Math.max(c.likes, sum("likes")), saves: Math.max(c.saves, sum("saves")) } });
  }
  return n;
}
