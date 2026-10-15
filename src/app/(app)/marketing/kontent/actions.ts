"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/auth";
import { parseForm, zOpt, zStr, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { publishContent } from "@/lib/smm/publish";
import { approveContentLib, rejectContentLib, submitContent } from "@/lib/smm/approval";
import { aiAllowed } from "@/lib/rate-limit";
import { aiErrorText, aiReady, planMonth, translateCaption, writeCaption, writeScript, type PostTextT } from "@/lib/ai/smm-writer";

const zInt = z.coerce.number({ message: "raqam bo'lishi kerak" }).int("butun son bo'lsin").min(0).max(1_000_000_000);
const CHANNELS = ["INSTAGRAM", "FACEBOOK", "TELEGRAM"] as const;

const schema = z.object({
  title: zStr("sarlavha kerak").pipe(z.string().max(160)),
  type: z.enum(["REELS", "POST", "STORIES", "ARTICLE"]),
  rubric: zOpt,
  status: z.enum(["IDEA", "SCRIPT", "FILMED", "EDITING", "PUBLISHED", "CANCELLED"]),
  scheduledAt: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/, "chiqish vaqti noto'g'ri"),
  channels: z.array(z.enum(CHANNELS)).optional(),
  media: z.array(z.string().regex(/^[a-z0-9]{16,40}$/)).max(10, "ko'pi bilan 10 ta media").optional(),
  hook: zOpt,
  script: z.string().trim().max(20_000).optional().transform((v) => (v ? v : null)),
  caption: z.string().trim().max(2200, "izoh 2200 belgidan oshmasin (Instagram chegarasi)").optional().transform((v) => (v ? v : null)),
  captionUz: z.string().trim().max(2200).optional().transform((v) => (v ? v : null)),
  hashtags: zOpt,
  url: zOpt.refine((v) => !v || /^https?:\/\//.test(v), "havola http(s):// bilan boshlansin"),
  locationName: z.string().trim().max(120).optional().transform((v) => (v ? v : null)),
  locationId: z.string().trim().optional().transform((v) => (v && /^\d{3,25}$/.test(v) ? v : null)),
  views: zInt,
  likes: zInt,
  saves: zInt,
  leads: zInt,
});

class StaleError extends Error {}

/** Postni saqlash. Tasdiqlangan post o'zgarsa — qayta tasdiqlash kerak (matn tasdiqlanganidan farq qilmasin). */
export async function saveContent(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const { scheduledAt, channels, media, ...d } = r.data;
  const when = scheduledAt ? new Date(scheduledAt) : null; // datetime-local — server vaqti Toshkent
  const data = {
    ...d,
    channels: channels ?? [],
    scheduledAt: when,
    publishDate: when ? new Date(`${scheduledAt.slice(0, 10)}T00:00:00Z`) : null,
  };
  const mediaIds = [...new Set(media ?? [])];
  if (mediaIds.length) {
    const found = await db.smmMedia.count({ where: { id: { in: mediaIds } } });
    if (found !== mediaIds.length) return { error: "Tanlangan media topilmadi — sahifani yangilang" };
  }

  let contentId = id;
  if (id) {
    const before = await db.marketingContent.findUnique({ where: { id }, include: { media: true } });
    if (!before) return { error: "Post topilmadi" };
    // «Chiqdi» holatini tarmoqqa chiqargan nashr dvigateli qo'yadi; qo'lda — faqat tarmoqsiz (tashqarida chiqqan) post uchun
    if (data.status === "PUBLISHED" && before.status !== "PUBLISHED" && data.channels.length) return { error: "«Chiqdi» holati tarmoqqa chiqqanda o'zi qo'yiladi — tasdiqlash va nashr orqali chiqaring" };
    const changed = ["caption", "captionUz", "hashtags", "scheduledAt", "channels", "locationId"].some((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((data as Record<string, unknown>)[k]))
      || JSON.stringify(before.media.map((m) => m.mediaId).sort()) !== JSON.stringify([...mediaIds].sort());
    // Tasdiqlashda yoki tasdiqlangan post o'zgarsa — qoralamaga qaytadi: direktor ko'rmagan matn chiqib ketmasin
    // Chiqqan post ham: yangi tarmoq qo'shilsa yoki matn o'zgarsa, qolgan nashrlar faqat qayta tasdiqdan keyin chiqadi
    const reapprove = (before.approval === "APPROVED" || before.approval === "PENDING") && changed;
    const reset = reapprove
      ? { approval: "DRAFT" as const, approvalNote: before.approval === "APPROVED" ? "Tasdiqdan keyin o'zgartirildi — qayta tasdiqlash kerak" : "Tasdiqlashga yuborilgandan keyin o'zgartirildi — qayta yuboring", approvedAt: null, approvedById: null, approvedByName: null }
      : {};
    let after;
    try {
      after = await db.$transaction(async (tx) => {
        // Shartli yozuv: o'qish va yozish orasida post tasdiqlangan/o'zgargan bo'lsa — saqlanmaydi
        const u = await tx.marketingContent.updateMany({ where: { id, updatedAt: before.updatedAt }, data: { ...data, ...reset } });
        if (u.count === 0) throw new StaleError();
        await tx.marketingContentMedia.deleteMany({ where: { contentId: id } });
        if (mediaIds.length) await tx.marketingContentMedia.createMany({ data: mediaIds.map((mediaId, sort) => ({ contentId: id, mediaId, sort })) });
        return tx.marketingContent.findUniqueOrThrow({ where: { id } });
      });
    } catch (e) {
      if (e instanceof StaleError) return { error: "Post shu orada o'zgardi (tasdiqlandi yoki boshqa xodim saqladi) — sahifani yangilab qayta kiriting" };
      throw e;
    }
    await audit(db, s.userId, before.status !== after.status ? "STATUS_CHANGE" : "UPDATE", "MarketingContent", id, before, after);
  } else {
    if (data.status === "PUBLISHED" && data.channels.length) return { error: "«Chiqdi» holati tarmoqqa chiqqanda o'zi qo'yiladi — tasdiqlash va nashr orqali chiqaring" };
    const created = await db.marketingContent.create({
      data: { ...data, createdBy: s.fullName, media: { create: mediaIds.map((mediaId, sort) => ({ mediaId, sort })) } },
    });
    await audit(db, s.userId, "CREATE", "MarketingContent", created.id, undefined, created);
    contentId = created.id;
  }
  revalidatePath("/marketing", "layout");
  redirect(`/marketing/kontent/${contentId}?saqlandi=1`);
}

/* ───────── Tasdiqlash oqimi ───────── */

export async function submitForApproval(id: string): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  const r = await submitContent(id, { userId: s.userId, name: s.fullName });
  if (!r.ok) return { error: r.error };
  revalidatePath("/marketing", "layout");
  return { ok: true, note: r.note };
}

/** `version` — direktor ko'rgan postning `updatedAt` qiymati: shundan keyin o'zgargan post tasdiqlanmaydi */
export async function approveContent(id: string, version: string): Promise<ActionState> {
  const s = await requireAction("marketing", "publish");
  const r = await approveContentLib(id, new Date(version), { userId: s.userId, name: s.fullName });
  if (!r.ok) return { error: r.error };
  revalidatePath("/marketing", "layout");
  return { ok: true, note: r.note };
}

export async function rejectContent(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "publish");
  const r0 = parseForm(z.object({ note: zStr("rad etish sababini yozing").pipe(z.string().max(500)) }), fd);
  if ("error" in r0) return { error: r0.error };
  const r = await rejectContentLib(id, r0.data.note, { userId: s.userId, name: s.fullName });
  if (!r.ok) return { error: r.error };
  revalidatePath("/marketing", "layout");
  return { ok: true };
}

/** Hozir chiqarish (yoki xato bo'lgan tarmoqlarni qayta yuborish) */
export async function publishNow(id: string): Promise<ActionState> {
  const s = await requireAction("marketing", "publish");
  try {
    const out = await publishContent(id, s.userId);
    revalidatePath("/marketing", "layout");
    const failed = out.filter((o) => o.status === "FAILED");
    if (failed.length) return { error: failed.map((f) => `${f.channel}: ${f.message}`).join("; ") };
    const sim = out.filter((o) => o.status === "SIMULATED");
    return { ok: true, note: sim.length ? `Sinov: ${sim.map((o) => o.message).join("; ")}` : "Chiqarildi" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Nashr xatosi" };
  }
}

/* ───────── AI ───────── */

export type AiState = ({ ok?: boolean; error?: string } & Partial<PostTextT>) | undefined;

/** Formadagi joriy qiymatlardan AI natija — formaga qaytariladi (bazaga yozilmaydi, xodim tekshirib saqlaydi) */
const aiInput = z.object({
  title: z.string().max(300),
  type: z.string().max(20),
  rubric: z.string().max(120).optional(),
  hook: z.string().max(2000).optional(),
  script: z.string().max(20_000).optional(),
  caption: z.string().max(5000).optional(),
});

export async function aiWrite(kind: "script" | "caption" | "translate", raw: z.input<typeof aiInput>): Promise<AiState> {
  const s = await requireAction("marketing", "agent");
  if (!aiReady()) return { error: "AI ulanmagan — administratorga murojaat qiling" };
  const p = aiInput.safeParse(raw);
  if (!p.success) return { error: "Matn juda uzun — qisqartirib qayta urinib ko'ring" };
  if (!aiAllowed(s.userId)) return { error: "AI so'rovlari chegarasi — birozdan keyin qayta urinib ko'ring" };
  const input = p.data;
  try {
    if (kind === "script") {
      if (!input.title.trim()) return { error: "Avval sarlavha yoki g'oyani yozing" };
      return { ok: true, ...(await writeScript({ title: input.title, rubric: input.rubric, brief: input.script, type: input.type })) };
    }
    if (kind === "caption") {
      if (!input.title.trim() && !input.script?.trim()) return { error: "Avval sarlavha yoki ssenariy yozing" };
      return { ok: true, ...(await writeCaption({ title: input.title, script: input.script, hook: input.hook })) };
    }
    if (!input.caption?.trim()) return { error: "Avval ruscha izohni yozing" };
    return { ok: true, captionUz: await translateCaption(input.caption) };
  } catch (e) {
    return { error: aiErrorText(e) };
  }
}

/** AI oylik reja: qoralama postlar yaratiladi (tasdiqlanmaydi, hech qayerga chiqmaydi) */
export async function aiPlanMonth(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  await requireAction("marketing", "agent");
  if (!aiReady()) return { error: "AI ulanmagan — administratorga murojaat qiling" };
  if (!aiAllowed(s.userId)) return { error: "AI so'rovlari chegarasi — birozdan keyin qayta urinib ko'ring" };
  const r = parseForm(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, "oy noto'g'ri"),
    count: z.coerce.number().int().min(1, "kamida 1 ta").max(16, "ko'pi bilan 16 ta"),
    focus: zOpt,
  }), fd);
  if ("error" in r) return { error: r.error };
  const [y, m] = r.data.month.split("-").map(Number) as [number, number];
  try {
    const plan = await planMonth({ year: y, month: m, count: r.data.count, focus: r.data.focus });
    let n = 0;
    for (const p of plan.posts.slice(0, r.data.count)) {
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(p.date) && /^\d{2}:\d{2}$/.test(p.time);
      const when = ok ? new Date(`${p.date}T${p.time}`) : null;
      const c = await db.marketingContent.create({
        data: {
          title: p.title.slice(0, 160), type: p.type, rubric: p.rubric.slice(0, 80), status: "SCRIPT", hook: p.hook, script: p.script,
          caption: p.caption.slice(0, 2200), captionUz: p.captionUz.slice(0, 2200), hashtags: p.hashtags, channels: ["INSTAGRAM", "TELEGRAM"],
          scheduledAt: when && !Number.isNaN(when.getTime()) ? when : null, publishDate: ok ? new Date(`${p.date}T00:00:00Z`) : null,
          createdBy: `AI reja (${s.fullName})`,
        },
      });
      await audit(db, s.userId, "CREATE", "MarketingContent", c.id, undefined, { title: c.title, ai: true });
      n++;
    }
    revalidatePath("/marketing", "layout");
    return { ok: true, note: `${n} ta qoralama post yaratildi — tekshirib, media biriktiring va tasdiqlashga yuboring` };
  } catch (e) {
    return { error: aiErrorText(e) };
  }
}
