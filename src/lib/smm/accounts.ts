/**
 * Ijtimoiy tarmoq profillarini ulash (Marketing → Sozlamalar).
 *
 * Meta: foydalanuvchi tokeni (OAuth yoki qo'lda) → boshqariladigan sahifalar va ularga bog'langan Instagram
 * profillari topiladi; har biri `SmmAccount` bo'lib saqlanadi. Sahifa tokeni muddatsiz — nashr shu bilan,
 * foydalanuvchi tokeni (≈60 kun) — reklama uchun, muddati tugashidan oldin avtomatik yangilanadi.
 * Qo'lda sahifa tokeni berilsa ham ishlaydi (`me` — sahifaning o'zi).
 * Telegram: bot tokeni + kanal; bot kanalda admin ekani tekshiriladi.
 */
import type { SmmChannel, SmmConnectMethod } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { resetSmmCreds } from "./config";
import { seal, unseal } from "./vault";
import { graphWith, igProfile, MetaError, refreshUserToken, userPages, type MetaPage } from "./meta";
import { verifyTelegram } from "./telegram";

export type Actor = { userId: string; name: string };

/** Tarmoqda asosiy profil yo'q bo'lsa — shu profil asosiy bo'ladi */
async function upsertAccount(channel: SmmChannel, externalId: string, data: {
  name: string; username?: string | null; pictureUrl?: string | null; method: SmmConnectMethod; token: string;
  userToken?: string | null; expiresAt?: Date | null; pageId?: string | null; followers?: number | null;
}, actor: Actor): Promise<string> {
  const hasPrimary = await db.smmAccount.count({ where: { channel, isPrimary: true, status: { not: "DISCONNECTED" }, NOT: { externalId } } });
  const row = {
    name: data.name.slice(0, 200), username: data.username ?? null, pictureUrl: data.pictureUrl ?? null, method: data.method,
    tokenEnc: seal(data.token), userTokenEnc: data.userToken ? seal(data.userToken) : null, tokenExpiresAt: data.expiresAt ?? null,
    pageId: data.pageId ?? null, followers: data.followers ?? null, status: "ACTIVE" as const, lastError: null, checkedAt: new Date(),
    connectedById: actor.userId, connectedByName: actor.name,
  };
  const before = await db.smmAccount.findUnique({ where: { channel_externalId: { channel, externalId } } });
  const a = await db.smmAccount.upsert({
    where: { channel_externalId: { channel, externalId } },
    create: { channel, externalId, ...row, isPrimary: hasPrimary === 0 },
    update: { ...row, ...(hasPrimary === 0 ? { isPrimary: true } : {}) },
  });
  // Tokenlar audit jurnaliga yozilmaydi
  const safe = (x: typeof a | null) => x && { channel: x.channel, externalId: x.externalId, name: x.name, method: x.method, status: x.status, isPrimary: x.isPrimary };
  await audit(db, actor.userId, before ? "UPDATE" : "CREATE", "SmmAccount", a.id, safe(before) ?? undefined, safe(a));
  return a.id;
}

/**
 * Meta tokenidan profillarni saqlash. Foydalanuvchi/tizim tokeni — barcha sahifalar va Instagram profillari;
 * sahifa tokeni — o'sha sahifa va unga bog'langan Instagram.
 */
export async function connectMeta(token: string, method: SmmConnectMethod, actor: Actor, expiresAt?: Date | null): Promise<{ instagram: number; facebook: number }> {
  let pages: MetaPage[] = [];
  let userToken: string | null = null;
  try {
    pages = await userPages(token);
    userToken = token;
  } catch (e) {
    if (e instanceof MetaError && e.expired) throw e;
    // Sahifa tokeni: me/accounts ishlamaydi, `me` — sahifaning o'zi
    const me = await graphWith<MetaPage>(token, "me", { fields: "id,name,picture{url},followers_count,instagram_business_account{id,username,name,profile_picture_url,followers_count}" });
    pages = [{ ...me, access_token: token }];
  }
  if (!pages.length) throw new Error("Bu hisobda boshqariladigan Facebook sahifa topilmadi. Instagram Business profili Facebook sahifaga bog'langan bo'lishi kerak.");
  let instagram = 0, facebook = 0;
  for (const p of pages) {
    await upsertAccount("FACEBOOK", p.id, {
      name: p.name, pictureUrl: p.picture?.data?.url, method, token: p.access_token, userToken, expiresAt: userToken ? expiresAt : null, followers: p.followers_count,
    }, actor);
    facebook++;
    const ig = p.instagram_business_account;
    if (ig) {
      await upsertAccount("INSTAGRAM", ig.id, {
        name: ig.name || ig.username || p.name, username: ig.username, pictureUrl: ig.profile_picture_url, method, token: p.access_token,
        userToken, expiresAt: userToken ? expiresAt : null, pageId: p.id, followers: ig.followers_count,
      }, actor);
      instagram++;
    }
  }
  resetSmmCreds();
  return { instagram, facebook };
}

export async function connectTelegram(token: string, chat: string, actor: Actor): Promise<string> {
  const t = token.trim() || (process.env.SMM_TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!t) throw new Error("Bot tokenini kiriting (@BotFather beradi)");
  const c = await verifyTelegram(t, chat.trim());
  const id = await upsertAccount("TELEGRAM", c.chatId, { name: c.title, username: c.username, method: "MANUAL", token: t, followers: c.members }, actor);
  resetSmmCreds();
  return id;
}

export async function setPrimary(id: string, actor: Actor): Promise<void> {
  const a = await db.smmAccount.findUniqueOrThrow({ where: { id } });
  if (a.status === "DISCONNECTED") throw new Error("Uzilgan profilni asosiy qilib bo'lmaydi — qayta ulang");
  await db.$transaction([
    db.smmAccount.updateMany({ where: { channel: a.channel, isPrimary: true }, data: { isPrimary: false } }),
    db.smmAccount.update({ where: { id }, data: { isPrimary: true } }),
  ]);
  await audit(db, actor.userId, "UPDATE", "SmmAccount", id, { isPrimary: a.isPrimary }, { isPrimary: true });
  resetSmmCreds();
}

/** Uzish: tokenlar o'chiriladi, yozuv tarix (statistika) uchun qoladi */
export async function disconnect(id: string, actor: Actor): Promise<void> {
  const a = await db.smmAccount.findUniqueOrThrow({ where: { id } });
  await db.smmAccount.update({ where: { id }, data: { status: "DISCONNECTED", isPrimary: false, tokenEnc: null, userTokenEnc: null, tokenExpiresAt: null } });
  await audit(db, actor.userId, "STATUS_CHANGE", "SmmAccount", id, { status: a.status }, { status: "DISCONNECTED" });
  resetSmmCreds();
}

/** Profil ishlayaptimi — tarmoqqa so'rov bilan tekshirish; obunachilar soni yangilanadi */
export async function checkAccount(id: string): Promise<{ ok: boolean; error?: string }> {
  const a = await db.smmAccount.findUniqueOrThrow({ where: { id } });
  const token = unseal(a.tokenEnc);
  if (!token) {
    await db.smmAccount.update({ where: { id }, data: { status: "EXPIRED", lastError: "Token o'qilmadi — qayta ulang", checkedAt: new Date() } });
    return { ok: false, error: "Token o'qilmadi — qayta ulang" };
  }
  try {
    let followers: number | undefined;
    if (a.channel === "TELEGRAM") followers = (await verifyTelegram(token, a.externalId)).members;
    else if (a.channel === "INSTAGRAM") followers = (await igProfile(token, a.externalId)).followers_count;
    else followers = (await graphWith<{ followers_count?: number }>(token, a.externalId, { fields: "followers_count" })).followers_count;
    await db.smmAccount.update({ where: { id }, data: { status: "ACTIVE", lastError: null, checkedAt: new Date(), followers: followers ?? a.followers } });
    resetSmmCreds();
    return { ok: true };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await db.smmAccount.update({ where: { id }, data: { status: e instanceof MetaError && e.expired ? "EXPIRED" : "ERROR", lastError: msg, checkedAt: new Date() } });
    resetSmmCreds();
    return { ok: false, error: msg };
  }
}

/** Muddati 10 kundan kam qolgan Meta foydalanuvchi tokenlarini yangilash (rejalashtiruvchi, kuniga bir marta) */
export async function refreshMetaTokens(now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + 10 * 86_400_000);
  const rows = await db.smmAccount.findMany({ where: { status: "ACTIVE", userTokenEnc: { not: null }, tokenExpiresAt: { lt: soon } } });
  const done = new Map<string, { token: string; expiresAt: Date | null }>();
  let n = 0;
  for (const a of rows) {
    const old = unseal(a.userTokenEnc);
    if (!old) continue;
    try {
      const fresh = done.get(old) ?? await refreshUserToken(old);
      done.set(old, fresh);
      await db.smmAccount.update({ where: { id: a.id }, data: { userTokenEnc: seal(fresh.token), tokenExpiresAt: fresh.expiresAt } });
      n++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      await db.smmAccount.update({ where: { id: a.id }, data: { lastError: `Tokenni yangilab bo'lmadi: ${msg}` } });
    }
  }
  if (n) resetSmmCreds();
  return n;
}
