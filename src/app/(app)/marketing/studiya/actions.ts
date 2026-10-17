"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { aiAllowed } from "@/lib/rate-limit";
import { aiErrorText, aiReady, studioPackage, type StudioT } from "@/lib/ai/smm-writer";
import { kickVideoQueue } from "@/lib/smm/watch";
import { aiRateText, matchMedia, nextSlot, saveStudioPost, studioSaveSchema, type MediaPick } from "@/lib/smm/studio";

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

/** Postni qoralama sifatida saqlash (+ ixtiyoriy video montaj navbatga) — tasdiqlash odatdagidek */
export async function savePackage(raw: z.input<typeof studioSaveSchema>): Promise<{ error?: string; id?: string; video?: boolean }> {
  const s = await requireAction("marketing", "content");
  const p = studioSaveSchema.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" };
  const r = await saveStudioPost(p.data, { userId: s.userId, name: s.fullName }, "AI studiya");
  if (!r.error) revalidatePath("/marketing", "layout");
  return r;
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
