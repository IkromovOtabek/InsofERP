"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { aiAllowed } from "@/lib/rate-limit";
import { aiErrorText, aiReady, studioPackage, type StudioT } from "@/lib/ai/smm-writer";
import { sceneSchema, specSchema } from "@/lib/smm/video";
import { kickVideoQueue } from "@/lib/smm/watch";
import { aiRateText, matchMedia, nextSlot, type MediaPick } from "@/lib/smm/studio";

export type GenState = { ok?: boolean; error?: string; pkg?: StudioT; picks?: MediaPick[][]; slot?: string } | undefined;

const genSchema = z.object({
  brief: z.string().trim().min(10, "G'oyani batafsilroq yozing (kamida bir gap)").max(3000, "G'oya 3000 belgidan oshmasin"),
  format: z.enum(["REELS", "POST", "STORIES"]),
});

/** G'oyadan AI paket: ssenariy (sahnalar), matnlar, heshteg, joy, vaqt + har sahnaga kutubxonadan mos kadrlar */
export async function generate(raw: z.input<typeof genSchema>): Promise<GenState> {
  const s = await requireAction("marketing", "agent");
  await requireAction("marketing", "content");
  if (!aiReady()) return { error: "AI ulanmagan — administratorga murojaat qiling" };
  const p = genSchema.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" };
  if (!aiAllowed(s.userId)) return { error: aiRateText };
  try {
    const tags = await db.smmMedia.findMany({ select: { tags: true }, take: 500, orderBy: { createdAt: "desc" } });
    const pkg = await studioPackage({ ...p.data, mediaTags: [...new Set(tags.flatMap((t) => t.tags))] });
    const picks = await matchMedia(pkg.scenes.map((sc) => sc.mediaTags), p.data.format);
    return { ok: true, pkg, picks, slot: nextSlot(pkg.bestTime.weekday, pkg.bestTime.time) };
  } catch (e) {
    return { error: aiErrorText(e) };
  }
}

const saveSchema = z.object({
  brief: z.string().trim().max(3000),
  format: z.enum(["REELS", "POST", "STORIES"]),
  channels: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TELEGRAM"])).min(1, "Kamida bitta tarmoq tanlang"),
  title: z.string().trim().min(1, "Sarlavha kerak").max(160),
  rubric: z.string().trim().max(80),
  hook: z.string().trim().max(2000),
  music: z.string().trim().max(300),
  caption: z.string().trim().max(2200, "Izoh 2200 belgidan oshmasin"),
  captionUz: z.string().trim().max(2200),
  hashtags: z.string().trim().max(600),
  location: z.object({ name: z.string().max(120), locationId: z.string().regex(/^\d{3,25}$/).nullish() }).nullish(),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullish(),
  accent: z.string().max(7),
  scenes: z.array(sceneSchema.extend({ shot: z.string().max(600) })).min(1).max(12),
  makeVideo: z.boolean(),
});

/** Postni qoralama sifatida saqlash (+ ixtiyoriy video montaj navbatga) — tasdiqlash odatdagidek */
export async function savePackage(raw: z.input<typeof saveSchema>): Promise<{ error?: string; id?: string; video?: boolean }> {
  const s = await requireAction("marketing", "content");
  const p = saveSchema.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" };
  const d = p.data;
  const ids = [...new Set(d.scenes.map((sc) => sc.mediaId).filter((x): x is string => !!x))];
  if (ids.length && (await db.smmMedia.count({ where: { id: { in: ids } } })) !== ids.length) return { error: "Tanlangan kadr topilmadi — sahifani yangilang" };
  const when = d.scheduledAt ? new Date(d.scheduledAt) : null;
  const script = [
    d.hook ? `**Hook:** ${d.hook}` : null,
    ...d.scenes.map((sc, i) => `${i + 1}. (${sc.durationSec}s) ${sc.shot}${sc.text ? `\n   Ekranda: «${sc.text}»` : ""}${sc.sub ? `\n   Qo'shimcha: ${sc.sub}` : ""}`),
    d.music ? `**Musiqa:** ${d.music}` : null,
  ].filter(Boolean).join("\n");

  const c = await db.marketingContent.create({
    data: {
      title: d.title, type: d.format, rubric: d.rubric || null, status: d.makeVideo && d.format === "REELS" ? "EDITING" : "SCRIPT",
      hook: d.hook || null, script, caption: d.caption || null, captionUz: d.captionUz || null, hashtags: d.hashtags || null,
      channels: d.channels, brief: d.brief || null, locationName: d.location?.name || null, locationId: d.location?.locationId || null,
      scheduledAt: when, publishDate: when ? new Date(Date.UTC(when.getFullYear(), when.getMonth(), when.getDate())) : null,
      createdBy: `AI studiya (${s.fullName})`,
      // Video yaratilmasa — tanlangan kadrlar postga biriktiriladi (rasm/karusel uchun)
      media: d.makeVideo && d.format === "REELS" ? undefined : { create: ids.slice(0, 10).map((mediaId, sort) => ({ mediaId, sort })) },
    },
  });
  await audit(db, s.userId, "CREATE", "MarketingContent", c.id, undefined, { title: c.title, ai: "studiya" });

  let video = false;
  if (d.makeVideo && d.format === "REELS") {
    const spec = specSchema.parse({ title: d.title, accent: d.accent, scenes: d.scenes }); // shot — faqat ssenariy matni uchun, sxema uni tashlab yuboradi
    const job = await db.smmVideoJob.create({ data: { contentId: c.id, spec, createdById: s.userId, createdByName: s.fullName } });
    await audit(db, s.userId, "CREATE", "SmmVideoJob", job.id, undefined, { contentId: c.id });
    kickVideoQueue();
    video = true;
  }
  revalidatePath("/marketing", "layout");
  return { id: c.id, video };
}

/** Xato bo'lgan video ishni qayta navbatga qo'yish */
export async function retryVideo(id: string): Promise<{ error?: string; ok?: boolean }> {
  const s = await requireAction("marketing", "content");
  const r = await db.smmVideoJob.updateMany({ where: { id, status: { in: ["FAILED", "CANCELLED"] } }, data: { status: "QUEUED", error: null, progress: 0 } });
  if (r.count === 0) return { error: "Ish holati o'zgargan — sahifani yangilang" };
  await audit(db, s.userId, "STATUS_CHANGE", "SmmVideoJob", id, undefined, { status: "QUEUED" });
  kickVideoQueue();
  revalidatePath("/marketing", "layout");
  return { ok: true };
}

export async function cancelVideo(id: string): Promise<{ error?: string; ok?: boolean }> {
  const s = await requireAction("marketing", "content");
  const r = await db.smmVideoJob.updateMany({ where: { id, status: "QUEUED" }, data: { status: "CANCELLED" } });
  if (r.count === 0) return { error: "Montaj boshlanib bo'lgan — tugashini kuting" };
  await audit(db, s.userId, "STATUS_CHANGE", "SmmVideoJob", id, undefined, { status: "CANCELLED" });
  revalidatePath("/marketing", "layout");
  return { ok: true };
}
