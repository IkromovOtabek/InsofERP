"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, type ActionState } from "@/lib/action";
import { connectWebhookOnly, connectWithToken, disconnectAmo, resubscribeWebhook, saveOAuthClient, saveStages, saveWebhookStage } from "@/lib/amocrm/connect";
import { normalizeDomain } from "@/lib/amocrm/store";
import { amoTick, dismissDeal, restoreDeal } from "@/lib/amocrm/sync";

const done = (note?: string): ActionState => { revalidatePath("/amocrm"); return { ok: true, note }; };
const fail = (e: unknown): ActionState => ({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
const actorOf = (s: { userId: string; fullName: string }) => ({ userId: s.userId, name: s.fullName });

const domainField = zStr("hisob manzilini kiriting").transform((v, ctx) => {
  const d = normalizeDomain(v);
  if (!d) ctx.addIssue({ code: "custom", message: "manzil: kompaniya.amocrm.ru (yoki kompaniya.kommo.com)" });
  return d ?? "";
});

export async function connectTokenAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("sales", "amocrm_settings");
  const r = parseForm(z.object({ domain: domainField, token: zStr("tokenni kiriting").pipe(z.string().min(40, "token juda qisqa").max(4000)) }), fd);
  if ("error" in r) return { error: r.error };
  try {
    const name = await connectWithToken(r.data.domain, r.data.token.replace(/\s+/g, ""), actorOf(s));
    return done(`Ulandi: ${name}. Endi voronka va bosqichlarni tanlang.`);
  } catch (e) { return fail(e); }
}

/**
 * OAuth: kalitlar saqlanadi, ruxsat oynasiga brauzer o'zi o'tadi (forma `ok` dan keyin to'liq navigatsiya).
 * Server action ichidagi `redirect()` bu yerda yaramaydi: Next yo'naltirishni serverda bajaradi —
 * state cookie brauzerga yetmaydi va amoCRM oynasi ochilmaydi.
 */
export async function connectOAuthAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("sales", "amocrm_settings");
  const r = parseForm(z.object({
    domain: domainField,
    clientId: zStr("client_id kiriting").pipe(z.string().regex(/^[0-9a-f-]{20,64}$/i, "client_id — «Integratsiya ID» (uuid)")),
    clientSecret: zStr("secret kiriting").pipe(z.string().min(20, "secret juda qisqa").max(200)),
  }), fd);
  if ("error" in r) return { error: r.error };
  try {
    await saveOAuthClient(r.data.domain, r.data.clientId.trim(), r.data.clientSecret.trim(), actorOf(s));
    return { ok: true, note: "amoCRM ruxsat oynasi ochilmoqda…" };
  } catch (e) { return fail(e); }
}

const stage = z.string().optional().transform((v) => (v && /^\d+$/.test(v) ? Number(v) : null));

/** API'siz (bir tomonlama) ulash: faqat hisob manzili, webhook manzilini amoCRM'ga admin qo'yadi */
export async function connectWebhookAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("sales", "amocrm_settings");
  const r = parseForm(z.object({ domain: domainField }), fd);
  if ("error" in r) return { error: r.error };
  try {
    await connectWebhookOnly(r.data.domain, actorOf(s));
    return done("Webhook manzili tayyor — uni amoCRM'ga qo'ying");
  } catch (e) { return fail(e); }
}

const stageId = z.string().optional().transform((v, ctx) => {
  const t = (v ?? "").replace(/\s+/g, "");
  if (!t) return null;
  if (!/^\d{1,12}$/.test(t)) { ctx.addIssue({ code: "custom", message: "bosqich ID — faqat raqam" }); return null; }
  return Number(t);
});

export async function saveWebhookStageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("sales", "amocrm_settings");
  const r = parseForm(z.object({ stageToErp: stageId, pipelineId: stageId }), fd);
  if ("error" in r) return { error: r.error };
  try {
    await saveWebhookStage(r.data.stageToErp, r.data.pipelineId, actorOf(s));
    return done(r.data.stageToErp ? "Saqlandi: faqat shu bosqichga o'tgan sdelkalar ERP'ga tushadi" : "Saqlandi: webhook yuborgan har sdelka ERP'ga tushadi");
  } catch (e) { return fail(e); }
}

export async function saveStagesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("sales", "amocrm_settings");
  const r = parseForm(z.object({
    pipelineId: stage, stageNewLead: stage, stageToErp: stage, stageConfirmed: stage, stageDelivered: stage, stageClosed: stage, stageCancelled: stage,
    pushLeads: z.string().optional().transform((v) => v === "on"),
  }), fd);
  if ("error" in r) return { error: r.error };
  try {
    await saveStages(r.data, actorOf(s));
    return done("Saqlandi");
  } catch (e) { return fail(e); }
}

export async function disconnectAction(): Promise<ActionState> {
  const s = await requireAction("sales", "amocrm_settings");
  try { await disconnectAmo(actorOf(s)); return done("amoCRM uzildi"); } catch (e) { return fail(e); }
}

export async function webhookAction(): Promise<ActionState> {
  await requireAction("sales", "amocrm_settings");
  const ok = await resubscribeWebhook();
  revalidatePath("/amocrm");
  return ok ? { ok: true, note: "Webhook o'rnatildi" } : { error: "Webhook o'rnatilmadi: amoCRM ERP manziliga (APP_URL) yeta olmayapti. 5 daqiqalik tekshiruv baribir ishlaydi." };
}

export async function syncNowAction(): Promise<ActionState> {
  await requireAction("sales", "amocrm");
  try {
    const r = await amoTick({ force: true });
    if (!r) return { error: "amoCRM ulanmagan yoki token yaroqsiz — Sozlamalarni tekshiring" };
    return done(`Yuborilgan arizalar: ${r.pushed}, ERP'ga tushgan kelishuvlar: ${r.pulled}, yangilangan sdelkalar: ${r.synced}`);
  } catch (e) { return fail(e); }
}

export async function dismissAction(id: string): Promise<ActionState> {
  const s = await requireAction("sales", "amocrm");
  const r = await dismissDeal(id, s.userId);
  return r.ok ? done() : { error: r.error };
}

export async function restoreAction(id: string): Promise<ActionState> {
  const s = await requireAction("sales", "amocrm");
  const r = await restoreDeal(id, s.userId);
  return r.ok ? done() : { error: r.error };
}
