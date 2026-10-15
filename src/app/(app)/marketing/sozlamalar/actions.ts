"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma";
import { requireAction } from "@/lib/auth";
import { parseForm, zDec, zOpt, zStr, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { marketingSettings } from "@/lib/smm/boosts";
import { checkAccount, connectMeta, connectTelegram, disconnect, setPrimary } from "@/lib/smm/accounts";
import { resetSmmCreds } from "@/lib/smm/config";
import { searchPlaces } from "@/lib/smm/meta";
import { syncCompetitor } from "@/lib/smm/insights";

const done = (note?: string): ActionState => { revalidatePath("/marketing", "layout"); return { ok: true, note }; };
const fail = (e: unknown): ActionState => ({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
const actorOf = (s: { userId: string; fullName: string }) => ({ userId: s.userId, name: s.fullName });

/* ───────── Profillar ───────── */

export async function connectMetaManual(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "settings");
  const r = parseForm(z.object({ token: zStr("tokenni kiriting").pipe(z.string().min(20, "token juda qisqa").max(1000)) }), fd);
  if ("error" in r) return { error: r.error };
  try {
    const n = await connectMeta(r.data.token.replace(/\s+/g, ""), "MANUAL", actorOf(s));
    return done(`Ulandi: Instagram — ${n.instagram}, Facebook sahifa — ${n.facebook}`);
  } catch (e) { return fail(e); }
}

export async function connectTelegramAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "settings");
  const r = parseForm(z.object({
    token: zOpt,
    chat: zStr("kanalni kiriting").pipe(z.string().regex(/^(@[A-Za-z0-9_]{4,64}|-100\d{5,20})$/, "kanal: @kanal_nomi yoki -100… ko'rinishida")),
  }), fd);
  if ("error" in r) return { error: r.error };
  try {
    await connectTelegram(r.data.token ?? "", r.data.chat, actorOf(s));
    return done("Telegram kanal ulandi");
  } catch (e) { return fail(e); }
}

export async function accountAction(id: string, op: "primary" | "disconnect" | "check"): Promise<ActionState> {
  const s = await requireAction("marketing", "settings");
  try {
    if (op === "primary") { await setPrimary(id, actorOf(s)); return done("Asosiy profil o'zgardi"); }
    if (op === "disconnect") { await disconnect(id, actorOf(s)); return done("Profil uzildi"); }
    const r = await checkAccount(id);
    revalidatePath("/marketing", "layout");
    return r.ok ? { ok: true, note: "Profil ishlayapti" } : { error: r.error };
  } catch (e) { return fail(e); }
}

/* ───────── Brend profili (AI shunga tayanadi) ───────── */

const brandSchema = z.object({
  brandAbout: z.string().trim().max(4000).optional().transform((v) => v || null),
  brandTone: z.string().trim().max(1000).optional().transform((v) => v || null),
  audience: z.string().trim().max(2000).optional().transform((v) => v || null),
  languages: z.enum(["ru,uz", "uz,ru", "ru", "uz"]),
  defaultHashtags: z.string().trim().max(500).optional().transform((v) => v || null),
});

export async function saveBrand(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  const r = parseForm(brandSchema, fd);
  if ("error" in r) return { error: r.error };
  if (r.data.defaultHashtags && (r.data.defaultHashtags.match(/#[^\s#]+/g) ?? []).length > 15) return { error: "Doimiy heshteglar 15 tadan oshmasin (Instagram'da jami 30 ta)" };
  const before = await marketingSettings();
  const after = await db.marketingSettings.update({ where: { id: "main" }, data: r.data });
  await audit(db, s.userId, "UPDATE", "MarketingSettings", "main", before, after);
  return done("Saqlandi");
}

/* ───────── Joylashuvlar ───────── */

export type Place = { name: string; locationId?: string | null };

export async function findPlaces(q: string): Promise<{ items?: { id: string; name: string; address?: string }[]; error?: string }> {
  await requireAction("marketing", "content");
  const term = q.trim().slice(0, 100);
  if (term.length < 3) return { error: "Kamida 3 harf yozing" };
  try { return { items: await searchPlaces(term) }; } catch (e) { return { error: e instanceof Error ? e.message : "Qidirib bo'lmadi" }; }
}

export async function saveLocations(list: Place[]): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  const p = z.array(z.object({ name: z.string().trim().min(2, "joy nomi kerak").max(120), locationId: z.string().regex(/^\d{3,25}$/).nullish() })).max(20, "ko'pi bilan 20 ta joy").safeParse(list);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" };
  const before = await marketingSettings();
  const after = await db.marketingSettings.update({ where: { id: "main" }, data: { locations: p.data } });
  await audit(db, s.userId, "UPDATE", "MarketingSettings", "main", { locations: before.locations }, { locations: after.locations });
  return done("Joylashuvlar saqlandi");
}

/* ───────── Raqobatchilar ───────── */

export async function addCompetitor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  const r = parseForm(z.object({ username: zStr("Instagram nomini kiriting").transform((v) => v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "").toLowerCase()).pipe(z.string().regex(/^[a-z0-9._]{2,30}$/, "Instagram nomi noto'g'ri")) }), fd);
  if ("error" in r) return { error: r.error };
  if ((await db.smmCompetitor.count()) >= 15) return { error: "Ko'pi bilan 15 ta raqobatchi" };
  try {
    const c = await db.smmCompetitor.create({ data: { username: r.data.username } });
    await audit(db, s.userId, "CREATE", "SmmCompetitor", c.id, undefined, c);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Bu profil ro'yxatda bor" };
    throw e;
  }
  // Ko'rsatkichlarni darhol olishga urinamiz (profil ulanmagan bo'lsa — keyin avtomatik)
  await syncCompetitor(r.data.username).catch(() => undefined);
  return done("Qo'shildi");
}

export async function removeCompetitor(id: string): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  const c = await db.smmCompetitor.findUnique({ where: { id } });
  if (!c) return { error: "Topilmadi" };
  await db.smmCompetitor.delete({ where: { id } });
  await audit(db, s.userId, "DELETE", "SmmCompetitor", id, c, undefined);
  return done();
}

/* ───────── Reklama kabineti va limitlar ───────── */

export async function saveAds(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "settings");
  const r = parseForm(z.object({
    adAccountId: zOpt.refine((v) => !v || /^(act_)?\d{5,25}$/.test(v), "reklama kabineti: act_123… yoki raqam"),
    leadFormId: zOpt.refine((v) => !v || /^\d{5,25}$/.test(v), "Lead forma id — raqam"),
    adCurrency: z.enum(["USD", "EUR", "UZS", "RUB", "KZT"], { message: "valyutani tanlang" }),
    boostDailyCap: zDec(0),
    boostMonthlyCap: zDec(0),
  }), fd);
  if ("error" in r) return { error: r.error };
  if (r.data.boostDailyCap > r.data.boostMonthlyCap) return { error: "Kunlik limit oylikdan katta bo'lmasin" };
  const before = await marketingSettings();
  const after = await db.marketingSettings.update({
    where: { id: "main" },
    data: {
      adAccountId: r.data.adAccountId ? (r.data.adAccountId.startsWith("act_") ? r.data.adAccountId : `act_${r.data.adAccountId}`) : null,
      leadFormId: r.data.leadFormId, adCurrency: r.data.adCurrency,
      boostDailyCap: new Prisma.Decimal(r.data.boostDailyCap), boostMonthlyCap: new Prisma.Decimal(r.data.boostMonthlyCap),
    },
  });
  await audit(db, s.userId, "UPDATE", "MarketingSettings", "main", before, after);
  resetSmmCreds();
  return done("Saqlandi");
}
