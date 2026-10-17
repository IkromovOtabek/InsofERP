"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, type ActionState } from "@/lib/action";
import { connectWithToken, disconnectAmo, resubscribeWebhook, saveOAuthClient, saveStages } from "@/lib/amocrm/connect";
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

/** OAuth: kalitlar saqlanadi va amoCRM ruxsat oynasiga o'tiladi */
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
  } catch (e) { return fail(e); }
  redirect("/api/amocrm/oauth");
}

const stage = z.string().optional().transform((v) => (v && /^\d+$/.test(v) ? Number(v) : null));

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
