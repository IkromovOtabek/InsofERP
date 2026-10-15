/**
 * Profil statistikasi va tahlil: ulangan profillardan kunlik ko'rsatkichlar, profildagi barcha postlar
 * (ERP'dan tashqarida chiqqanlari ham) va raqobatchilar. Natija — Statistika sahifasi va AI tavsiyalari uchun.
 *
 * Rejalashtiruvchi (`watch.ts`) har 6 soatda chaqiradi; Meta chegarasiga tushmaslik uchun har safar
 * cheklangan miqdordagi post yangilanadi.
 */
import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { channelReady, smmCreds } from "./config";
import { competitorInfo, graphWith, igAccountDay, igRecentMedia, instagramStats } from "./meta";
import { telegramMembers } from "./telegram";

const DAY = 86_400_000;
/** Mahalliy (Toshkent) kun boshi — @db.Date ustunlari uchun UTC yarim tun ko'rinishida */
const dateKey = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
const localStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

async function primary(channel: "INSTAGRAM" | "FACEBOOK" | "TELEGRAM") {
  return db.smmAccount.findFirst({ where: { channel, isPrimary: true, status: { in: ["ACTIVE", "ERROR"] } } });
}

/** Kecha (va bo'sh qolgan oxirgi 7 kun) uchun Instagram profil ko'rsatkichlari; Telegram/Facebook — obunachilar */
export async function syncAccountDays(now = new Date()): Promise<number> {
  let n = 0;
  const ig = await primary("INSTAGRAM");
  if (ig && (await channelReady("INSTAGRAM"))) {
    const have = new Set((await db.smmAccountDaily.findMany({
      where: { accountId: ig.id, date: { gte: dateKey(new Date(now.getTime() - 8 * DAY)) }, views: { not: null } }, select: { date: true },
    })).map((d) => d.date.getTime()));
    for (let i = 1; i <= 7; i++) {
      const day = localStart(new Date(now.getTime() - i * DAY));
      const key = dateKey(day);
      if (have.has(key.getTime())) continue;
      try {
        const v = await igAccountDay(day);
        await db.smmAccountDaily.upsert({ where: { accountId_date: { accountId: ig.id, date: key } }, create: { accountId: ig.id, date: key, ...v }, update: v });
        n++;
      } catch (e) {
        console.error("[smm] profil statistikasi", e instanceof Error ? e.message : e);
        break;
      }
    }
    const today = await db.smmAccountDaily.findUnique({ where: { accountId_date: { accountId: ig.id, date: dateKey(now) } } });
    const followers = ig.followers;
    if (!today && followers != null) await db.smmAccountDaily.create({ data: { accountId: ig.id, date: dateKey(now), followers } });
  }
  const tg = await primary("TELEGRAM");
  if (tg && (await channelReady("TELEGRAM"))) {
    const members = await telegramMembers();
    if (members != null) {
      await db.smmAccountDaily.upsert({ where: { accountId_date: { accountId: tg.id, date: dateKey(now) } }, create: { accountId: tg.id, date: dateKey(now), followers: members }, update: { followers: members } });
      await db.smmAccount.update({ where: { id: tg.id }, data: { followers: members } });
      n++;
    }
  }
  const fb = await primary("FACEBOOK");
  if (fb && (await channelReady("FACEBOOK"))) {
    const { pageToken } = await smmCreds();
    const r = await graphWith<{ followers_count?: number }>(pageToken, fb.externalId, { fields: "followers_count" }).catch(() => null);
    if (r?.followers_count != null) {
      await db.smmAccountDaily.upsert({ where: { accountId_date: { accountId: fb.id, date: dateKey(now) } }, create: { accountId: fb.id, date: dateKey(now), followers: r.followers_count }, update: { followers: r.followers_count } });
      await db.smmAccount.update({ where: { id: fb.id }, data: { followers: r.followers_count } });
      n++;
    }
  }
  return n;
}

/** Instagram profilidagi postlar ro'yxati + statistika (yangi postlar tez-tez, eskilari kamroq yangilanadi) */
export async function syncProfilePosts(now = new Date(), budget = 40): Promise<number> {
  const ig = await primary("INSTAGRAM");
  if (!ig || !(await channelReady("INSTAGRAM"))) return 0;
  const items = await igRecentMedia(100);
  for (const m of items) {
    const mediaType = m.media_product_type === "REELS" ? "REELS" : m.media_type;
    const data = {
      mediaType, caption: m.caption?.slice(0, 2500) ?? null, permalink: m.permalink ?? null, thumbnailUrl: m.thumbnail_url ?? (m.media_type === "IMAGE" ? m.media_url ?? null : null),
      postedAt: new Date(m.timestamp), likes: m.like_count ?? null, comments: m.comments_count ?? null,
    };
    await db.smmPost.upsert({ where: { accountId_externalId: { accountId: ig.id, externalId: m.id } }, create: { accountId: ig.id, externalId: m.id, ...data }, update: data });
  }
  // Statistika: 3 kundan yosh post — har 6 soatda, 60 kungacha — kuniga bir marta, eskisi — haftada bir marta
  const posts = await db.smmPost.findMany({ where: { accountId: ig.id }, orderBy: { postedAt: "desc" }, take: 100 });
  const due = posts.filter((p) => {
    if (!p.statsAt) return true;
    const age = now.getTime() - p.postedAt.getTime();
    const since = now.getTime() - p.statsAt.getTime();
    return age < 3 * DAY ? since > 6 * 3600_000 : age < 60 * DAY ? since > DAY : since > 7 * DAY;
  }).slice(0, budget);
  let n = 0;
  for (const p of due) {
    try {
      const s = await instagramStats(p.externalId, p.mediaType === "REELS");
      await db.smmPost.update({
        where: { id: p.id },
        data: {
          views: s.views ?? null, reach: s.reach ?? null, likes: s.likes ?? p.likes, comments: s.comments ?? p.comments, shares: s.shares ?? null, saves: s.saves ?? null,
          avgWatchSec: s.avgWatchSec != null ? new Prisma.Decimal(s.avgWatchSec) : null, statsAt: now,
        },
      });
      n++;
    } catch (e) {
      console.error("[smm] post statistikasi", p.externalId, e instanceof Error ? e.message : e);
      await db.smmPost.update({ where: { id: p.id }, data: { statsAt: now } });
    }
  }
  return n;
}

export async function syncCompetitor(username: string): Promise<void> {
  try {
    const c = await competitorInfo(username);
    const media = c.media?.data ?? [];
    const avg = (k: "like_count" | "comments_count") => (media.length ? Math.round(media.reduce((a, m) => a + (m[k] ?? 0), 0) / media.length) : null);
    const top = [...media].sort((a, b) => (b.like_count ?? 0) + (b.comments_count ?? 0) * 3 - ((a.like_count ?? 0) + (a.comments_count ?? 0) * 3)).slice(0, 5)
      .map((m) => ({ permalink: m.permalink, caption: m.caption?.slice(0, 300), likes: m.like_count, comments: m.comments_count, mediaType: m.media_type, postedAt: m.timestamp }));
    await db.smmCompetitor.update({
      where: { username },
      data: { name: c.name ?? null, followers: c.followers_count ?? null, mediaCount: c.media_count ?? null, avgLikes: avg("like_count"), avgComments: avg("comments_count"), topPosts: top, checkedAt: new Date(), lastError: null },
    });
  } catch (e) {
    await db.smmCompetitor.update({ where: { username }, data: { checkedAt: new Date(), lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
    throw e;
  }
}

export async function syncCompetitors(now = new Date()): Promise<number> {
  if (!(await channelReady("INSTAGRAM"))) return 0;
  const list = await db.smmCompetitor.findMany({ where: { OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - DAY) } }] }, take: 15 });
  let n = 0;
  for (const c of list) { try { await syncCompetitor(c.username); n++; } catch { /* xato yozuvga yozildi */ } }
  return n;
}

/* ───────── Tahlil (sahifa va AI uchun) ───────── */

export type FormatRow = { type: string; posts: number; avgViews: number; avgReach: number; engagement: number; avgWatch: number | null };
export type Analytics = {
  days: number;
  account: { name: string; username: string | null; followers: number | null } | null;
  totals: { views: number; reach: number; interactions: number; profileViews: number; websiteClicks: number; followersDelta: number | null };
  prev: { views: number; reach: number };
  series: { date: string; views: number; reach: number; followers: number | null }[];
  posts: number;
  byFormat: FormatRow[];
  byWeekday: { day: number; posts: number; avgViews: number }[];
  byHour: { hour: number; posts: number; avgViews: number }[];
  top: { id: string; permalink: string | null; caption: string | null; mediaType: string; postedAt: Date; views: number; reach: number; likes: number; comments: number; saves: number; shares: number; avgWatchSec: number | null; thumbnailUrl: string | null }[];
  worst: Analytics["top"];
  telegram: { name: string; followers: number | null; delta: number | null } | null;
};

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

export async function analytics(days = 30, now = new Date()): Promise<Analytics> {
  const from = dateKey(new Date(now.getTime() - days * DAY));
  const prevFrom = dateKey(new Date(now.getTime() - 2 * days * DAY));
  const ig = await db.smmAccount.findFirst({ where: { channel: "INSTAGRAM", isPrimary: true } });
  const tg = await db.smmAccount.findFirst({ where: { channel: "TELEGRAM", isPrimary: true } });
  const [daily, prevDaily, posts, tgDaily] = await Promise.all([
    ig ? db.smmAccountDaily.findMany({ where: { accountId: ig.id, date: { gte: from } }, orderBy: { date: "asc" } }) : [],
    ig ? db.smmAccountDaily.findMany({ where: { accountId: ig.id, date: { gte: prevFrom, lt: from } } }) : [],
    ig ? db.smmPost.findMany({ where: { accountId: ig.id, postedAt: { gte: new Date(now.getTime() - Math.max(days, 90) * DAY) } }, orderBy: { postedAt: "desc" } }) : [],
    tg ? db.smmAccountDaily.findMany({ where: { accountId: tg.id, date: { gte: from } }, orderBy: { date: "asc" } }) : [],
  ]);
  const inPeriod = posts.filter((p) => p.postedAt >= from);
  const fl = daily.filter((d) => d.followers != null);
  const followersDelta = fl.length >= 2 ? fl[fl.length - 1]!.followers! - fl[0]!.followers! : null;
  const eng = (p: (typeof posts)[number]) => (p.likes ?? 0) + (p.comments ?? 0) * 2 + (p.saves ?? 0) * 3 + (p.shares ?? 0) * 3;

  // Format, kun va soat bo'yicha — 90 kunlik postlar (kichik namunada xulosa noto'g'ri bo'lmasin)
  const group = <K extends string | number>(key: (p: (typeof posts)[number]) => K) => {
    const m = new Map<K, typeof posts>();
    for (const p of posts) { const k = key(p); m.set(k, [...(m.get(k) ?? []), p]); }
    return m;
  };
  const byFormat: FormatRow[] = [...group((p) => p.mediaType)].map(([type, ps]) => {
    const watch = ps.filter((p) => p.avgWatchSec != null);
    const reach = sum(ps.map((p) => p.reach));
    return {
      type, posts: ps.length, avgViews: Math.round(sum(ps.map((p) => p.views)) / ps.length), avgReach: Math.round(reach / ps.length),
      engagement: reach ? Math.round((sum(ps.map(eng)) / reach) * 1000) / 10 : 0,
      avgWatch: watch.length ? Math.round((sum(watch.map((p) => Number(p.avgWatchSec))) / watch.length) * 10) / 10 : null,
    };
  }).sort((a, b) => b.avgViews - a.avgViews);
  const byWeekday = [...group((p) => p.postedAt.getDay())].map(([day, ps]) => ({ day, posts: ps.length, avgViews: Math.round(sum(ps.map((p) => p.views)) / ps.length) })).sort((a, b) => a.day - b.day);
  const byHour = [...group((p) => p.postedAt.getHours())].map(([hour, ps]) => ({ hour, posts: ps.length, avgViews: Math.round(sum(ps.map((p) => p.views)) / ps.length) })).sort((a, b) => a.hour - b.hour);

  const toTop = (p: (typeof posts)[number]) => ({
    id: p.id, permalink: p.permalink, caption: p.caption, mediaType: p.mediaType, postedAt: p.postedAt, views: p.views ?? 0, reach: p.reach ?? 0,
    likes: p.likes ?? 0, comments: p.comments ?? 0, saves: p.saves ?? 0, shares: p.shares ?? 0, avgWatchSec: p.avgWatchSec != null ? Number(p.avgWatchSec) : null, thumbnailUrl: p.thumbnailUrl,
  });
  const ranked = [...inPeriod].filter((p) => p.statsAt).sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const tgf = tgDaily.filter((d) => d.followers != null);

  return {
    days,
    account: ig ? { name: ig.name, username: ig.username, followers: ig.followers } : null,
    totals: {
      views: sum(daily.map((d) => d.views)), reach: sum(daily.map((d) => d.reach)), interactions: sum(daily.map((d) => d.interactions)),
      profileViews: sum(daily.map((d) => d.profileViews)), websiteClicks: sum(daily.map((d) => d.websiteClicks)), followersDelta,
    },
    prev: { views: sum(prevDaily.map((d) => d.views)), reach: sum(prevDaily.map((d) => d.reach)) },
    series: daily.map((d) => ({ date: d.date.toISOString().slice(0, 10), views: d.views ?? 0, reach: d.reach ?? 0, followers: d.followers })),
    posts: inPeriod.length,
    byFormat, byWeekday, byHour,
    top: ranked.slice(0, 6).map(toTop),
    worst: ranked.length > 8 ? ranked.slice(-3).reverse().map(toTop) : [],
    telegram: tg ? { name: tg.name, followers: tg.followers, delta: tgf.length >= 2 ? tgf[tgf.length - 1]!.followers! - tgf[0]!.followers! : null } : null,
  };
}
