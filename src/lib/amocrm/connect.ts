/**
 * amoCRM'ni ulash va sozlash (veb: `/amocrm?tab=sozlamalar`).
 *  - TOKEN: amoCRM → Sozlamalar → Integratsiyalar → shaxsiy integratsiya → «Uzoq muddatli token»;
 *  - OAUTH: o'sha integratsiyaning client_id/secret'i, «Redirect URI» = `oauthRedirectUri()`.
 * Ulangach webhook (`status_lead`) o'rnatiladi; o'rnatilmasa (lokal muhit) 5 daqiqalik tekshiruv ishlaydi.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { AmoConnection } from "@/generated/prisma";
import { pipelines, subscribeWebhook, unsubscribeWebhook, type AmoPipeline } from "./api";
import { amo, exchangeCode } from "./client";
import { AMO_ID, getConnection, newWebhookKey, normalizeDomain, vault, webhookUrl } from "./store";

export type Actor = { userId: string; name: string };

/** Tokenlar audit jurnaliga yozilmaydi */
const safe = (c: AmoConnection | null) => c && {
  domain: c.domain, accountName: c.accountName, method: c.method, status: c.status, pipelineId: c.pipelineId,
  stageNewLead: c.stageNewLead, stageToErp: c.stageToErp, stageConfirmed: c.stageConfirmed, stageDelivered: c.stageDelivered,
  stageClosed: c.stageClosed, stageCancelled: c.stageCancelled, pushLeads: c.pushLeads, webhookOk: c.webhookOk,
};

/** Hisobni tekshirib, ulanishni saqlash va webhook o'rnatish */
async function finish(data: {
  domain: string; method: "TOKEN" | "OAUTH"; access: string; refresh?: string | null; expiresAt?: Date | null; clientId?: string | null; clientSecret?: string | null;
}, actor: Actor): Promise<string> {
  const before = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  const probe = {
    id: AMO_ID, domain: data.domain, method: data.method, accessTokenEnc: vault.seal(data.access), refreshTokenEnc: data.refresh ? vault.seal(data.refresh) : null,
    tokenExpiresAt: data.expiresAt ?? null, clientId: data.clientId ?? null, clientSecretEnc: data.clientSecret ? vault.seal(data.clientSecret) : before?.clientSecretEnc ?? null,
  };
  // Saqlashdan oldin tekshiruv: token shu hisobniki va ishlaydi (vaqtinchalik ulanish obyekti bilan)
  const acc = await amo<{ id: number; name: string }>("/api/v4/account", { probe: true }, { ...(before ?? {}), ...probe, status: "ACTIVE" } as AmoConnection);
  const webhookKey = before?.webhookKey ?? newWebhookKey();
  // Boshqa hisobga qayta ulansa — eski voronka moslamasi yaroqsiz
  const sameAccount = before?.accountId === acc.id;
  const row = {
    ...probe, accountId: acc.id, accountName: acc.name, webhookKey, status: "ACTIVE" as const, lastError: null,
    connectedById: actor.userId, connectedByName: actor.name,
    ...(sameAccount ? {} : { pipelineId: null, stageNewLead: null, stageToErp: null, stageConfirmed: null, stageDelivered: null, stageClosed: null, stageCancelled: null, lastPullAt: null }),
  };
  const c = await db.amoConnection.upsert({ where: { id: AMO_ID }, create: row, update: { ...row, ...(before?.status === "DISCONNECTED" ? { createdAt: new Date() } : {}) } });
  let webhookOk = false;
  try { await subscribeWebhook(webhookUrl(webhookKey), c); webhookOk = true; } catch (e) { console.warn("[amocrm] webhook o'rnatilmadi", e instanceof Error ? e.message : e); }
  const after = await db.amoConnection.update({ where: { id: AMO_ID }, data: { webhookOk } });
  await audit(db, actor.userId, before ? "UPDATE" : "CREATE", "AmoConnection", AMO_ID, safe(before) ?? undefined, safe(after));
  return acc.name;
}

export const connectWithToken = (domain: string, token: string, actor: Actor) => finish({ domain, method: "TOKEN", access: token }, actor);

/** OAuth 1-qadam: client_id/secret saqlanadi (token hali yo'q), keyin ruxsat oynasiga yo'naltiriladi */
export async function saveOAuthClient(domain: string, clientId: string, clientSecret: string, actor: Actor): Promise<void> {
  const before = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  const row = { domain, method: "OAUTH" as const, clientId, clientSecretEnc: vault.seal(clientSecret), connectedById: actor.userId, connectedByName: actor.name };
  if (before && before.status !== "DISCONNECTED" && before.accessTokenEnc) {
    // Ishlab turgan ulanish token kelguncha buzilmasin — faqat kalitlar yangilanadi
    await db.amoConnection.update({ where: { id: AMO_ID }, data: { clientId, clientSecretEnc: row.clientSecretEnc } });
  } else {
    await db.amoConnection.upsert({
      where: { id: AMO_ID },
      create: { id: AMO_ID, ...row, webhookKey: newWebhookKey(), status: "DISCONNECTED" },
      update: { ...row, status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null },
    });
  }
}

/** OAuth 2-qadam: amoCRM qaytargan `code` (va `referer` — hisob manzili) */
export async function finishOAuth(code: string, referer: string | null, actor: Actor): Promise<string> {
  const c = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  const secret = vault.unseal(c?.clientSecretEnc);
  if (!c?.clientId || !secret) throw new Error("Avval client_id va secret kiriting");
  // amoCRM `referer` da haqiqiy hisob manzilini qaytaradi — foydalanuvchi boshqa subdomen yozgan bo'lsa ham to'g'risi olinadi
  const domain = (referer && normalizeDomain(referer)) || c.domain;
  const t = await exchangeCode(domain, c.clientId, secret, code);
  return finish({ domain, method: "OAUTH", access: t.access, refresh: t.refresh, expiresAt: t.expiresAt, clientId: c.clientId, clientSecret: secret }, actor);
}

/**
 * API'siz ulash (bir tomonlama): faqat webhook manzili beriladi, uni amoCRM'da admin qo'yadi.
 * Ishlayotgan API ulanishi bo'lsa — uning o'rniga o'tadi (tokenlar o'chiriladi, webhook kaliti o'zgarmaydi).
 */
export async function connectWebhookOnly(domain: string, actor: Actor): Promise<void> {
  const before = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  if (before?.accessTokenEnc) await unsubscribeWebhook(webhookUrl(before.webhookKey), before).catch(() => undefined);
  const sameAccount = !!before && before.domain === domain;
  const row = {
    domain, method: "WEBHOOK" as const, status: "ACTIVE" as const, lastError: null, accountId: null, accountName: null,
    accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, clientId: null, clientSecretEnc: null, webhookOk: false,
    connectedById: actor.userId, connectedByName: actor.name,
    // API usulidagi bosqichlar shu hisobniki bo'lsa — «ERP'ga» bosqichi saqlanadi, qolganlari bu usulda ishlatilmaydi
    ...(sameAccount ? {} : { pipelineId: null, stageToErp: null }),
    stageNewLead: null, stageConfirmed: null, stageDelivered: null, stageClosed: null, stageCancelled: null, pushLeads: false,
  };
  const c = await db.amoConnection.upsert({
    where: { id: AMO_ID },
    create: { id: AMO_ID, ...row, webhookKey: newWebhookKey() },
    update: { ...row, ...(before?.status === "DISCONNECTED" ? { createdAt: new Date(), lastWebhookAt: null, lastWebhookInfo: null } : {}) },
  });
  await audit(db, actor.userId, before ? "UPDATE" : "CREATE", "AmoConnection", AMO_ID, safe(before) ?? undefined, safe(c));
}

/** Webhook usulida «ERP'ga» bosqichi ID'si (bo'sh — kelgan har sdelka; raqamli voronka triggeri uchun) */
export async function saveWebhookStage(stageToErp: number | null, pipelineId: number | null, actor: Actor): Promise<void> {
  const c = await getConnection();
  if (!c || c.method !== "WEBHOOK") throw new Error("amoCRM webhook usulida ulanmagan");
  const after = await db.amoConnection.update({ where: { id: AMO_ID }, data: { stageToErp, pipelineId } });
  await audit(db, actor.userId, "UPDATE", "AmoConnection", AMO_ID, safe(c), safe(after));
}

export async function disconnectAmo(actor: Actor): Promise<void> {
  const c = await getConnection();
  if (!c) return;
  await unsubscribeWebhook(webhookUrl(c.webhookKey), c).catch(() => undefined);
  const after = await db.amoConnection.update({
    where: { id: AMO_ID },
    // Kalit ham almashadi: eski webhook manzili endi qabul qilinmaydi
    data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, webhookOk: false, webhookKey: newWebhookKey() },
  });
  await audit(db, actor.userId, "UPDATE", "AmoConnection", AMO_ID, safe(c), safe(after));
}

export type StageSettings = {
  pipelineId: number | null; stageNewLead: number | null; stageToErp: number | null; stageConfirmed: number | null;
  stageDelivered: number | null; stageClosed: number | null; stageCancelled: number | null; pushLeads: boolean;
};

/** Voronka va bosqichlarni saqlash. Bosqich tanlangan voronkaga tegishli ekani tekshiriladi. */
export async function saveStages(s: StageSettings, actor: Actor): Promise<void> {
  const c = await getConnection();
  if (!c?.accessTokenEnc) throw new Error("amoCRM ulanmagan");
  const list = await pipelines(c);
  const p = list.find((x) => x.id === s.pipelineId);
  if (!p) throw new Error("Voronkani tanlang");
  const ids = new Set(p._embedded.statuses.map((x) => x.id));
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith("stage") && v != null && !ids.has(v as number)) throw new Error("Bosqich tanlangan voronkada yo'q — sahifani yangilab qayta tanlang");
  }
  if (!s.stageToErp) throw new Error("«ERP'ga tushadigan» bosqichni tanlang — usiz kelishuvlar ERP'ga kelmaydi");
  if (s.stageToErp && s.stageToErp === s.stageNewLead) throw new Error("Yangi ariza bosqichi va «ERP'ga» bosqichi bir xil bo'lmasin");
  const before = c;
  const after = await db.amoConnection.update({ where: { id: AMO_ID }, data: { ...s, ...(before.stageToErp !== s.stageToErp ? { lastPullAt: null } : {}) } });
  await audit(db, actor.userId, "UPDATE", "AmoConnection", AMO_ID, safe(before), safe(after));
}

/** Sozlamalar sahifasi uchun voronkalar (xato bo'lsa — matn) */
export async function pipelinesSafe(c: AmoConnection): Promise<{ list: AmoPipeline[]; error?: string }> {
  try { return { list: await pipelines(c) }; } catch (e) { return { list: [], error: e instanceof Error ? e.message : String(e) }; }
}

/** Webhook'ni qayta o'rnatish (APP_URL o'zgargan bo'lsa) */
export async function resubscribeWebhook(): Promise<boolean> {
  const c = await getConnection();
  if (!c?.accessTokenEnc) return false;
  let ok = false;
  try { await subscribeWebhook(webhookUrl(c.webhookKey), c); ok = true; } catch { ok = false; }
  await db.amoConnection.update({ where: { id: AMO_ID }, data: { webhookOk: ok } });
  return ok;
}
