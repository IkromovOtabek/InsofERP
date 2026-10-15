/**
 * Meta Graph API: Instagram va Facebook sahifaga nashr, statistika va target (Marketing API).
 *
 * Instagram faylni o'zi yuklab oladi — `publicMediaUrl` (muddatli imzolangan havola). Video (Reels) avval
 * qayta ishlanadi: konteyner holati FINISHED bo'lguncha kutiladi, keyin nashr qilinadi.
 * Target: mavjud Instagram postidan reklama (creative: source_instagram_media_id) — kampaniya, ad set va
 * reklama avval PAUSED yaratiladi, hammasi muvaffaqiyatli bo'lsa birga ACTIVE qilinadi.
 */
import type { SmmBoostObjective } from "@/generated/prisma";
import { smmEnv } from "./config";
import type { PublishResult } from "./telegram";

type Json = Record<string, unknown>;

async function graph<T = Json>(pathPart: string, params: Json = {}, method: "GET" | "POST" = "GET", token = smmEnv.metaToken()): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${smmEnv.graphVersion()}/${pathPart.replace(/^\//, "")}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, access_token: token })) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (method === "GET") url.searchParams.set(k, s);
    else body.set(k, s);
  }
  const res = await fetch(url, method === "GET" ? { signal: AbortSignal.timeout(30_000) } : { method, body, signal: AbortSignal.timeout(60_000) });
  const j = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string; error_user_msg?: string } };
  if (!res.ok || j.error) throw new Error(`Meta: ${j.error?.error_user_msg || j.error?.message || `HTTP ${res.status}`}`);
  return j as T;
}

export type MetaMedia = { kind: "IMAGE" | "VIDEO"; url: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Konteyner tayyor bo'lguncha kutish (video qayta ishlanadi) — ko'pi bilan ~5 daqiqa */
async function waitContainer(id: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const s = await graph<{ status_code?: string; status?: string }>(id, { fields: "status_code,status" });
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram: media qayta ishlanmadi (${s.status ?? s.status_code})`);
    await sleep(5000);
  }
  throw new Error("Instagram: video qayta ishlash juda uzoq davom etdi — keyinroq qayta urinib ko'ring");
}

export async function publishInstagram(caption: string, media: MetaMedia[]): Promise<PublishResult> {
  const ig = smmEnv.igUserId();
  if (media.length === 0) throw new Error("Instagram: kamida bitta rasm yoki video kerak");
  let creationId: string;
  if (media.length === 1) {
    const m = media[0]!;
    const c = await graph<{ id: string }>(`${ig}/media`, m.kind === "VIDEO"
      ? { media_type: "REELS", video_url: m.url, caption, share_to_feed: true }
      : { image_url: m.url, caption }, "POST");
    creationId = c.id;
  } else {
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const c = await graph<{ id: string }>(`${ig}/media`, m.kind === "VIDEO"
        ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: true }
        : { image_url: m.url, is_carousel_item: true }, "POST");
      if (m.kind === "VIDEO") await waitContainer(c.id);
      children.push(c.id);
    }
    const c = await graph<{ id: string }>(`${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption }, "POST");
    creationId = c.id;
  }
  await waitContainer(creationId);
  const pub = await graph<{ id: string }>(`${ig}/media_publish`, { creation_id: creationId }, "POST");
  const info = await graph<{ permalink?: string }>(pub.id, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
  return { externalId: pub.id, permalink: info.permalink ?? null };
}

export async function publishFacebook(text: string, media: MetaMedia[]): Promise<PublishResult> {
  const page = smmEnv.pageId();
  const token = smmEnv.pageToken();
  let id: string;
  if (media.length === 0) {
    id = (await graph<{ id: string }>(`${page}/feed`, { message: text }, "POST", token)).id;
  } else if (media.length === 1 && media[0]!.kind === "VIDEO") {
    id = (await graph<{ id: string }>(`${page}/videos`, { file_url: media[0]!.url, description: text }, "POST", token)).id;
  } else if (media.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(`${page}/photos`, { url: media[0]!.url, caption: text }, "POST", token);
    id = r.post_id ?? r.id;
  } else {
    // Bir nechta rasm: avval nashrsiz yuklanadi, keyin bitta postga biriktiriladi (video bu usulda bo'lmaydi)
    const photos = media.filter((m) => m.kind === "IMAGE").slice(0, 10);
    const ids: string[] = [];
    for (const m of photos) ids.push((await graph<{ id: string }>(`${page}/photos`, { url: m.url, published: false }, "POST", token)).id);
    id = (await graph<{ id: string }>(`${page}/feed`, { message: text, attached_media: ids.map((x) => ({ media_fbid: x })) }, "POST", token)).id;
  }
  const info = await graph<{ permalink_url?: string }>(id, { fields: "permalink_url" }, "GET", token).catch(() => ({ permalink_url: undefined }));
  return { externalId: id, permalink: info.permalink_url ?? null };
}

export type PostStats = { views?: number; reach?: number; likes?: number; comments?: number; shares?: number; saves?: number };

export async function instagramStats(mediaId: string): Promise<PostStats> {
  const base = await graph<{ like_count?: number; comments_count?: number }>(mediaId, { fields: "like_count,comments_count" });
  const out: PostStats = { likes: base.like_count, comments: base.comments_count };
  // Metrikalar media turiga qarab farq qiladi — mos kelmasa butun so'rov rad etiladi, shuning uchun alohida
  for (const metric of ["reach", "views", "saved", "shares"]) {
    try {
      const r = await graph<{ data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`${mediaId}/insights`, { metric });
      const d = r.data?.[0];
      const v = d?.total_value?.value ?? d?.values?.[0]?.value;
      if (typeof v === "number") {
        if (metric === "reach") out.reach = v;
        if (metric === "views") out.views = v;
        if (metric === "saved") out.saves = v;
        if (metric === "shares") out.shares = v;
      }
    } catch { /* bu tur uchun metrika yo'q */ }
  }
  return out;
}

export async function facebookStats(postId: string): Promise<PostStats> {
  const r = await graph<{ shares?: { count: number }; reactions?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } } }>(
    postId, { fields: "shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" }, "GET", smmEnv.pageToken());
  return { shares: r.shares?.count, likes: r.reactions?.summary?.total_count, comments: r.comments?.summary?.total_count };
}

/* ───────── Target (Marketing API) ───────── */

const OBJECTIVE: Record<SmmBoostObjective, { objective: string; optimization: string; extra?: Json }> = {
  REACH: { objective: "OUTCOME_AWARENESS", optimization: "REACH" },
  MESSAGES: { objective: "OUTCOME_ENGAGEMENT", optimization: "CONVERSATIONS", extra: { destination_type: "INSTAGRAM_DIRECT" } },
  LEADS: { objective: "OUTCOME_LEADS", optimization: "LEAD_GENERATION", extra: { destination_type: "ON_AD" } },
};

export type BoostLaunch = { campaignId: string; adSetId: string; adId: string };

/** Valyuta minimal birligida (sent): Meta byudjetni shunday qabul qiladi */
const minor = (amount: number) => Math.round(amount * 100);

/**
 * `saved` — har bir obyekt yaratilishi bilan id larni bazaga yozish uchun: keyingi qadam xato bersa ham
 * Meta'da qolgan kampaniya ERP'dan ko'rinadi va to'xtatiladi.
 */
export async function launchBoost(p: {
  name: string; igMediaId: string; objective: SmmBoostObjective; targeting: Json; dailyBudget: number; start: Date; end: Date;
  saved: (ids: Partial<BoostLaunch>) => Promise<void>;
}): Promise<BoostLaunch> {
  const act = smmEnv.adAccount();
  const o = OBJECTIVE[p.objective];
  if (p.objective === "LEADS" && !smmEnv.leadFormId()) throw new Error("Ariza maqsadi uchun Meta'da Lead forma yarating va META_LEAD_FORM_ID ni sozlang");

  const campaign = await graph<{ id: string }>(`${act}/campaigns`, { name: p.name, objective: o.objective, status: "PAUSED", special_ad_categories: [] }, "POST");
  await p.saved({ campaignId: campaign.id });
  const adSet = await graph<{ id: string }>(`${act}/adsets`, {
    name: p.name, campaign_id: campaign.id, status: "PAUSED",
    daily_budget: minor(p.dailyBudget), billing_event: "IMPRESSIONS", optimization_goal: o.optimization, bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    start_time: p.start.toISOString(), end_time: p.end.toISOString(),
    targeting: { ...p.targeting, publisher_platforms: ["instagram"], instagram_positions: ["stream", "reels", "story", "explore"] },
    promoted_object: p.objective === "LEADS" ? { page_id: smmEnv.pageId() } : undefined,
    ...o.extra,
  }, "POST");
  await p.saved({ campaignId: campaign.id, adSetId: adSet.id });
  const creative = await graph<{ id: string }>(`${act}/adcreatives`, {
    name: p.name, object_id: smmEnv.pageId(), instagram_user_id: smmEnv.igUserId(), source_instagram_media_id: p.igMediaId,
    ...(p.objective === "LEADS" ? { call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: smmEnv.leadFormId() } } } : {}),
  }, "POST");
  const ad = await graph<{ id: string }>(`${act}/ads`, { name: p.name, adset_id: adSet.id, creative: { creative_id: creative.id }, status: "PAUSED" }, "POST");
  await p.saved({ campaignId: campaign.id, adSetId: adSet.id, adId: ad.id });
  // Hammasi yaratildi — endi yoqamiz (yarim yaratilgan reklama pul sarflamasin)
  for (const id of [campaign.id, adSet.id, ad.id]) await graph(id, { status: "ACTIVE" }, "POST");
  return { campaignId: campaign.id, adSetId: adSet.id, adId: ad.id };
}

export async function setCampaignStatus(campaignId: string, status: "ACTIVE" | "PAUSED"): Promise<void> {
  await graph(campaignId, { status }, "POST");
}

export type BoostStats = { spend: number; impressions: number; reach: number; clicks: number; results: number; effective?: string };

export async function boostStats(campaignId: string, objective: SmmBoostObjective): Promise<BoostStats> {
  const r = await graph<{ data?: { spend?: string; impressions?: string; reach?: string; clicks?: string; actions?: { action_type: string; value: string }[] }[] }>(
    `${campaignId}/insights`, { fields: "spend,impressions,reach,clicks,actions", date_preset: "maximum" });
  const d = r.data?.[0] ?? {};
  const want = objective === "LEADS" ? ["lead", "onsite_conversion.lead_grouped"] : objective === "MESSAGES" ? ["onsite_conversion.messaging_conversation_started_7d"] : [];
  const results = (d.actions ?? []).filter((a) => want.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
  const st = await graph<{ effective_status?: string }>(campaignId, { fields: "effective_status" }).catch(() => ({ effective_status: undefined }));
  return { spend: Number(d.spend ?? 0), impressions: Number(d.impressions ?? 0), reach: Number(d.reach ?? 0), clicks: Number(d.clicks ?? 0), results, effective: st.effective_status };
}
