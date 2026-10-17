/**
 * AI studiya yordamchilari: sahnaga media kutubxonadan mos kadr topish, tavsiya etilgan chiqish vaqti
 * va paketni qoralama post (+ video navbat) qilib saqlash — studiya sahifasi va marketing agenti uchun umumiy.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sceneSchema, specSchema } from "./video";
import { kickVideoQueue } from "./watch";

export const aiRateText = "AI so'rovlari chegarasi — birozdan keyin qayta urinib ko'ring";

export type MediaPick = { id: string; kind: "IMAGE" | "VIDEO"; title: string };

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ'`‘’]/g, "").replace(/[^a-z0-9а-яё]+/gi, " ").trim();

/**
 * Har sahna uchun 4 tagacha nomzod: teg yoki nom mos kelgani yuqorida; Reels'da video kadr afzal.
 * Bitta kadr ketma-ket sahnalarda takrorlanmasligi uchun birinchi nomzod imkon qadar har xil.
 */
export async function matchMedia(sceneTags: string[][], format: "REELS" | "POST" | "STORIES"): Promise<MediaPick[][]> {
  const all = await db.smmMedia.findMany({ orderBy: { createdAt: "desc" }, take: 400, select: { id: true, kind: true, title: true, tags: true } });
  const used = new Set<string>();
  return sceneTags.map((tags) => {
    const want = tags.map(norm).filter(Boolean);
    const scored = all.map((m) => {
      const hay = [...m.tags.map(norm), norm(m.title)];
      let score = 0;
      for (const w of want) for (const h of hay) if (h === w) score += 3; else if (h.includes(w) || w.includes(h)) score += 1;
      if (format === "REELS" && m.kind === "VIDEO") score += 0.5;
      if (format !== "REELS" && m.kind === "IMAGE") score += 0.5;
      if (used.has(m.id)) score -= 2;
      return { m, score };
    }).filter((x) => x.score > 0.5).sort((a, b) => b.score - a.score).slice(0, 4).map((x) => ({ id: x.m.id, kind: x.m.kind, title: x.m.title }));
    if (scored[0]) used.add(scored[0].id);
    return scored;
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Hafta kuni (0 — yakshanba) va HH:MM → kamida 3 soatdan keyingi eng yaqin sana (datetime-local, Toshkent) */
export function nextSlot(weekday: number, time: string, now = new Date()): string {
  const [h, m] = /^\d{1,2}:\d{2}$/.test(time) ? time.split(":").map(Number) as [number, number] : [18, 30];
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(23, h), Math.min(59, m));
  const wd = Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 2;
  let add = (wd - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() - now.getTime() < 3 * 3600_000) add = 7;
  d.setDate(d.getDate() + add);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const studioSaveSchema = z.object({
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

export type StudioSave = z.infer<typeof studioSaveSchema>;

/** Paketni qoralama post qilib saqlaydi; Reels va `makeVideo` bo'lsa — video montaj navbatga qo'yiladi */
export async function saveStudioPost(d: StudioSave, by: { userId: string; name: string }, source: string): Promise<{ error?: string; id?: string; video?: boolean }> {
  const ids = [...new Set(d.scenes.map((sc) => sc.mediaId).filter((x): x is string => !!x))];
  if (ids.length && (await db.smmMedia.count({ where: { id: { in: ids } } })) !== ids.length) return { error: "Tanlangan kadr topilmadi — sahifani yangilang" };
  const when = d.scheduledAt ? new Date(d.scheduledAt) : null;
  const script = [
    d.hook ? `**Hook:** ${d.hook}` : null,
    ...d.scenes.map((sc, i) => `${i + 1}. (${sc.durationSec}s) ${sc.shot}${sc.text ? `\n   Ekranda: «${sc.text}»` : ""}${sc.sub ? `\n   Qo'shimcha: ${sc.sub}` : ""}`),
    d.music ? `**Musiqa:** ${d.music}` : null,
  ].filter(Boolean).join("\n");
  const video = d.makeVideo && d.format === "REELS";

  const c = await db.marketingContent.create({
    data: {
      title: d.title, type: d.format, rubric: d.rubric || null, status: video ? "EDITING" : "SCRIPT",
      hook: d.hook || null, script, caption: d.caption || null, captionUz: d.captionUz || null, hashtags: d.hashtags || null,
      channels: d.channels, brief: d.brief || null, locationName: d.location?.name || null, locationId: d.location?.locationId || null,
      scheduledAt: when, publishDate: when ? new Date(Date.UTC(when.getFullYear(), when.getMonth(), when.getDate())) : null,
      createdBy: `${source} (${by.name})`,
      // Video yaratilmasa — tanlangan kadrlar postga biriktiriladi (rasm/karusel uchun)
      media: video ? undefined : { create: ids.slice(0, 10).map((mediaId, sort) => ({ mediaId, sort })) },
    },
  });
  await audit(db, by.userId, "CREATE", "MarketingContent", c.id, undefined, { title: c.title, ai: source });

  if (video) {
    const spec = specSchema.parse({ title: d.title, accent: d.accent, scenes: d.scenes }); // shot — faqat ssenariy matni uchun, sxema uni tashlab yuboradi
    const job = await db.smmVideoJob.create({ data: { contentId: c.id, spec, createdById: by.userId, createdByName: by.name } });
    await audit(db, by.userId, "CREATE", "SmmVideoJob", job.id, undefined, { contentId: c.id });
    kickVideoQueue();
  }
  return { id: c.id, video };
}
