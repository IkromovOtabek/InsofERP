/**
 * Meta Graph API: Instagram va Facebook sahifaga nashr, statistika, profil tahlili, raqobatchilar,
 * «Meta bilan ulash» (OAuth) va target (Marketing API).
 *
 * Instagram faylni o'zi yuklab oladi — `publicMediaUrl` (muddatli imzolangan havola). Video (Reels) avval
 * qayta ishlanadi: konteyner holati FINISHED bo'lguncha kutiladi, keyin nashr qilinadi.
 * Target: mavjud Instagram postidan reklama (creative: source_instagram_media_id) — kampaniya, ad set va
 * reklama avval PAUSED yaratiladi, hammasi muvaffaqiyatli bo'lsa birga ACTIVE qilinadi.
 * Token so'rov sarlavhasida yuboriladi (URL'ga yozilmaydi — loglarga tushmasin).
 */
import type { SmmBoostObjective } from "@/generated/prisma";
import { graphVersion, metaApp, smmCreds } from "./config";
import type { PublishResult } from "./telegram";

type Json = Record<string, unknown>;

export class MetaError extends Error {
  constructor(message: string, readonly code?: number) { super(message); }
  /** Token muddati tugagan yoki bekor qilingan — profilni qayta ulash kerak */
  get expired() { return this.code === 190; }
}

async function graph<T = Json>(pathPart: string, params: Json, method: "GET" | "POST", token: string): Promise<T> {
  if (!token) throw new MetaError("Meta: profil ulanmagan — Marketing → Sozlamalar'da ulang");
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${pathPart.replace(/^\//, "")}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (method === "GET") url.searchParams.set(k, s);
    else body.set(k, s);
  }
  const headers = { Authorization: `Bearer ${token}` };
  const res = await fetch(url, method === "GET" ? { headers, signal: AbortSignal.timeout(30_000) } : { method, headers, body, signal: AbortSignal.timeout(60_000) });
  const j = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string; error_user_msg?: string; code?: number } };
  if (!res.ok || j.error) {
    const code = j.error?.code;
    const msg = code === 190 ? "token muddati tugagan yoki bekor qilingan — profilni qayta ulang"
      : code === 4 || code === 17 || code === 32 || code === 613 ? "Meta so'rovlar chegarasi — birozdan keyin qayta urinib ko'ring"
      : j.error?.error_user_msg || j.error?.message || `HTTP ${res.status}`;
    throw new MetaError(`Meta: ${msg}`, code);
  }
  return j as T;
}

/** Ulash va tekshirish uchun — aniq token bilan (bazadagi asosiy profil emas) */
export const graphWith = <T = Json>(token: string, pathPart: string, params: Json = {}) => graph<T>(pathPart, params, "GET", token);

export type MetaMedia = { kind: "IMAGE" | "VIDEO"; url: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Konteyner tayyor bo'lguncha kutish (video qayta ishlanadi) — ko'pi bilan ~5 daqiqa */
async function waitContainer(id: string, token: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const s = await graph<{ status_code?: string; status?: string }>(id, { fields: "status_code,status" }, "GET", token);
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram: media qayta ishlanmadi (${s.status ?? s.status_code})`);
    await sleep(5000);
  }
  throw new Error("Instagram: video qayta ishlash juda uzoq davom etdi — keyinroq qayta urinib ko'ring");
}

export async function publishInstagram(caption: string, media: MetaMedia[], opts: { locationId?: string | null } = {}): Promise<PublishResult> {
  const { igUserId: ig, igToken: token } = await smmCreds();
  if (media.length === 0) throw new Error("Instagram: kamida bitta rasm yoki video kerak");
  const location_id = opts.locationId || undefined;
  let creationId: string;
  if (media.length === 1) {
    const m = media[0]!;
    const c = await graph<{ id: string }>(`${ig}/media`, m.kind === "VIDEO"
      ? { media_type: "REELS", video_url: m.url, caption, share_to_feed: true, location_id }
      : { image_url: m.url, caption, location_id }, "POST", token);
    creationId = c.id;
  } else {
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const c = await graph<{ id: string }>(`${ig}/media`, m.kind === "VIDEO"
        ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: true }
        : { image_url: m.url, is_carousel_item: true }, "POST", token);
      if (m.kind === "VIDEO") await waitContainer(c.id, token);
      children.push(c.id);
    }
    const c = await graph<{ id: string }>(`${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption, location_id }, "POST", token);
    creationId = c.id;
  }
  await waitContainer(creationId, token);
  const pub = await graph<{ id: string }>(`${ig}/media_publish`, { creation_id: creationId }, "POST", token);
  const info = await graph<{ permalink?: string }>(pub.id, { fields: "permalink" }, "GET", token).catch(() => ({ permalink: undefined }));
  return { externalId: pub.id, permalink: info.permalink ?? null };
}

export async function publishFacebook(text: string, media: MetaMedia[]): Promise<PublishResult> {
  const { pageId: page, pageToken: token } = await smmCreds();
  const videos = media.filter((m) => m.kind === "VIDEO");
  const photos = media.filter((m) => m.kind === "IMAGE");
  let id: string;
  if (media.length === 0) {
    id = (await graph<{ id: string }>(`${page}/feed`, { message: text }, "POST", token)).id;
  } else if (videos.length) {
    // Facebook bitta postga video va rasmni birga qo'ymaydi — birinchi video chiqadi (Reels uchun odatiy holat)
    if (videos.length > 1 || photos.length) throw new Error("Facebook: bitta postda bir nechta video yoki video + rasm bo'lmaydi — bitta video qoldiring");
    id = (await graph<{ id: string }>(`${page}/videos`, { file_url: videos[0]!.url, description: text }, "POST", token)).id;
  } else if (photos.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(`${page}/photos`, { url: photos[0]!.url, caption: text }, "POST", token);
    id = r.post_id ?? r.id;
  } else {
    // Bir nechta rasm: avval nashrsiz yuklanadi, keyin bitta postga biriktiriladi
    const ids: string[] = [];
    for (const m of photos.slice(0, 10)) ids.push((await graph<{ id: string }>(`${page}/photos`, { url: m.url, published: false }, "POST", token)).id);
    id = (await graph<{ id: string }>(`${page}/feed`, { message: text, attached_media: ids.map((x) => ({ media_fbid: x })) }, "POST", token)).id;
  }
  const info = await graph<{ permalink_url?: string }>(id, { fields: "permalink_url" }, "GET", token).catch(() => ({ permalink_url: undefined }));
  return { externalId: id, permalink: info.permalink_url ?? null };
}

export type PostStats = { views?: number; reach?: number; likes?: number; comments?: number; shares?: number; saves?: number; avgWatchSec?: number };

type Insight = { data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] };
const insightValue = (r: Insight) => { const d = r.data?.[0]; return d?.total_value?.value ?? d?.values?.[0]?.value; };

export async function instagramStats(mediaId: string, reels = false): Promise<PostStats> {
  const { igToken: token } = await smmCreds();
  const base = await graph<{ like_count?: number; comments_count?: number }>(mediaId, { fields: "like_count,comments_count" }, "GET", token);
  const out: PostStats = { likes: base.like_count, comments: base.comments_count };
  // Metrikalar media turiga qarab farq qiladi — mos kelmasa butun so'rov rad etiladi, shuning uchun alohida
  const metrics = ["reach", "views", "saved", "shares", ...(reels ? ["ig_reels_avg_watch_time"] : [])];
  for (const metric of metrics) {
    try {
      const v = insightValue(await graph<Insight>(`${mediaId}/insights`, { metric }, "GET", token));
      if (typeof v !== "number") continue;
      if (metric === "reach") out.reach = v;
      if (metric === "views") out.views = v;
      if (metric === "saved") out.saves = v;
      if (metric === "shares") out.shares = v;
      if (metric === "ig_reels_avg_watch_time") out.avgWatchSec = Math.round(v / 10) / 100; // ms → s
    } catch { /* bu tur uchun metrika yo'q */ }
  }
  return out;
}

export async function facebookStats(postId: string): Promise<PostStats> {
  const { pageToken } = await smmCreds();
  const r = await graph<{ shares?: { count: number }; reactions?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } } }>(
    postId, { fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" }, "GET", pageToken);
  // shares — faqat oddiy postda bor (video tugunida so'ralsa butun so'rov rad etiladi)
  const sh = await graph<{ shares?: { count: number } }>(postId, { fields: "shares" }, "GET", pageToken).catch(() => ({ shares: undefined }));
  return { shares: sh.shares?.count, likes: r.reactions?.summary?.total_count, comments: r.comments?.summary?.total_count };
}

/* ───────── Profil tahlili ───────── */

export type IgProfile = { id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number; media_count?: number };

export async function igProfile(token: string, igId: string): Promise<IgProfile> {
  return graph<IgProfile>(igId, { fields: "id,username,name,profile_picture_url,followers_count,media_count" }, "GET", token);
}

export type IgDay = { followers?: number; reach?: number; views?: number; profileViews?: number; websiteClicks?: number; interactions?: number };

/** Bitta kun uchun profil ko'rsatkichlari (`day` — mahalliy sana boshi) */
export async function igAccountDay(day: Date): Promise<IgDay> {
  const { igUserId: ig, igToken: token } = await smmCreds();
  const since = Math.floor(day.getTime() / 1000);
  const until = since + 86_400;
  const out: IgDay = {};
  const map: Record<string, keyof IgDay> = { reach: "reach", views: "views", profile_views: "profileViews", website_clicks: "websiteClicks", total_interactions: "interactions" };
  for (const [metric, key] of Object.entries(map)) {
    try {
      const v = insightValue(await graph<Insight>(`${ig}/insights`, { metric, period: "day", metric_type: "total_value", since, until }, "GET", token));
      if (typeof v === "number") out[key] = v;
    } catch { /* metrika bu profil uchun yo'q */ }
  }
  out.followers = (await igProfile(token, ig)).followers_count;
  return out;
}

export type IgMediaItem = { id: string; media_type: string; media_product_type?: string; caption?: string; permalink?: string; thumbnail_url?: string; media_url?: string; timestamp: string; like_count?: number; comments_count?: number };

/** Profildagi so'nggi postlar (sahifalab, ko'pi bilan `max` ta) */
export async function igRecentMedia(max = 100): Promise<IgMediaItem[]> {
  const { igUserId: ig, igToken: token } = await smmCreds();
  const out: IgMediaItem[] = [];
  let after: string | undefined;
  while (out.length < max) {
    const r = await graph<{ data: IgMediaItem[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${ig}/media`, {
      fields: "id,media_type,media_product_type,caption,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count", limit: 50, after,
    }, "GET", token);
    out.push(...r.data);
    if (!r.paging?.next || !r.paging.cursors?.after) break;
    after = r.paging.cursors.after;
  }
  return out.slice(0, max);
}

export type Competitor = { username: string; name?: string; followers_count?: number; media_count?: number; media?: { data: { caption?: string; like_count?: number; comments_count?: number; permalink?: string; media_type?: string; timestamp?: string }[] } };

/** Raqobatchining ochiq ko'rsatkichlari (faqat Business/Creator profillar uchun ishlaydi) */
export async function competitorInfo(username: string): Promise<Competitor> {
  const { igUserId: ig, igToken: token } = await smmCreds();
  const u = username.replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "");
  const r = await graph<{ business_discovery?: Competitor }>(ig, {
    fields: `business_discovery.username(${u}){username,name,followers_count,media_count,media.limit(24){caption,like_count,comments_count,permalink,media_type,timestamp}}`,
  }, "GET", token);
  if (!r.business_discovery) throw new Error("Profil topilmadi yoki u Business/Creator emas");
  return r.business_discovery;
}

/** Joylashuv qidirish (Instagram postiga qo'yiladigan joy — Facebook sahifa id) */
export async function searchPlaces(q: string): Promise<{ id: string; name: string; address?: string }[]> {
  const { pageToken } = await smmCreds();
  const r = await graph<{ data: { id: string; name: string; location?: { city?: string; street?: string } }[] }>("pages/search", {
    q, fields: "id,name,location", limit: 10,
  }, "GET", pageToken);
  return r.data.map((p) => ({ id: p.id, name: p.name, address: [p.location?.city, p.location?.street].filter(Boolean).join(", ") || undefined }));
}

/* ───────── «Meta bilan ulash» (OAuth) ───────── */

export const OAUTH_SCOPES = [
  "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "instagram_manage_comments",
  "pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_read_user_content",
  "business_management", "ads_management", "ads_read", "leads_retrieval",
];

export function oauthUrl(redirectUri: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  u.searchParams.set("client_id", metaApp().id);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", OAUTH_SCOPES.join(","));
  return u.toString();
}

async function tokenCall(params: Record<string, string>): Promise<{ access_token: string; expires_in?: number }> {
  const u = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
  for (const [k, v] of Object.entries({ ...params, client_id: metaApp().id, client_secret: metaApp().secret })) u.searchParams.set(k, v);
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!j.access_token) throw new Error(`Meta: ${j.error?.message ?? "token olinmadi"}`);
  return { access_token: j.access_token, expires_in: j.expires_in };
}

/** Kod → uzoq muddatli (≈60 kun) foydalanuvchi tokeni */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ token: string; expiresAt: Date | null }> {
  const short = await tokenCall({ code, redirect_uri: redirectUri });
  const long = await tokenCall({ grant_type: "fb_exchange_token", fb_exchange_token: short.access_token });
  return { token: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null };
}

/** Uzoq muddatli tokenni yangilash (muddati tugashidan oldin) */
export async function refreshUserToken(token: string): Promise<{ token: string; expiresAt: Date | null }> {
  const r = await tokenCall({ grant_type: "fb_exchange_token", fb_exchange_token: token });
  return { token: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null };
}

export type MetaPage = {
  id: string; name: string; access_token: string; picture?: { data?: { url?: string } }; followers_count?: number;
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number };
};

/** Foydalanuvchi boshqaradigan sahifalar va ularga bog'langan Instagram profillari (sahifa tokeni muddatsiz) */
export async function userPages(userToken: string): Promise<MetaPage[]> {
  const r = await graph<{ data: MetaPage[] }>("me/accounts", {
    fields: "id,name,access_token,picture{url},followers_count,instagram_business_account{id,username,name,profile_picture_url,followers_count}", limit: 50,
  }, "GET", userToken);
  return r.data;
}

/* ───────── Target (Marketing API) ───────── */

const OBJECTIVE: Record<SmmBoostObjective, { objective: string; optimization: string; extra?: Json }> = {
  REACH: { objective: "OUTCOME_AWARENESS", optimization: "REACH" },
  MESSAGES: { objective: "OUTCOME_ENGAGEMENT", optimization: "CONVERSATIONS", extra: { destination_type: "INSTAGRAM_DIRECT" } },
  LEADS: { objective: "OUTCOME_LEADS", optimization: "LEAD_GENERATION", extra: { destination_type: "ON_AD" } },
};

export type BoostLaunch = { campaignId: string; adSetId: string; adId: string };

// Meta byudjetni valyutaning minimal birligida oladi; bu valyutalarda kasr qism yo'q (offset 1)
const ZERO_DECIMAL = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
const minor = (amount: number, currency: string) => Math.round(amount * (ZERO_DECIMAL.has(currency) ? 1 : 100));

/**
 * `saved` — har bir obyekt yaratilishi bilan id larni bazaga yozish uchun: keyingi qadam xato bersa ham
 * Meta'da qolgan kampaniya ERP'dan ko'rinadi va to'xtatiladi.
 */
export async function launchBoost(p: {
  name: string; igMediaId: string; objective: SmmBoostObjective; targeting: Json; dailyBudget: number; currency: string; start: Date; end: Date;
  saved: (ids: Partial<BoostLaunch>) => Promise<void>;
}): Promise<BoostLaunch> {
  const c = await smmCreds();
  const act = c.adAccount;
  const token = c.adToken;
  const o = OBJECTIVE[p.objective];
  if (p.objective === "LEADS" && !c.leadFormId) throw new Error("Ariza maqsadi uchun Meta'da Lead forma yarating va Sozlamalar'da uning id sini kiriting");
  // Kabinet valyutasi sozlamadagidan farq qilsa — limitlar boshqa birlikda bo'lib ketadi
  const accCur = (await graph<{ currency?: string }>(act, { fields: "currency" }, "GET", token)).currency;
  if (accCur && accCur !== p.currency) throw new Error(`Reklama kabineti valyutasi ${accCur}, sozlamalarda esa ${p.currency} — Sozlamalar'da valyutani to'g'rilang`);

  const campaign = await graph<{ id: string }>(`${act}/campaigns`, {
    name: p.name, objective: o.objective, status: "PAUSED", special_ad_categories: [], is_adset_budget_sharing_enabled: false,
  }, "POST", token);
  await p.saved({ campaignId: campaign.id });
  const adSet = await graph<{ id: string }>(`${act}/adsets`, {
    name: p.name, campaign_id: campaign.id, status: "PAUSED",
    daily_budget: minor(p.dailyBudget, p.currency), billing_event: "IMPRESSIONS", optimization_goal: o.optimization, bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    start_time: p.start.toISOString(), end_time: p.end.toISOString(),
    // Yosh/jins cheklovi bor auditoriyada Advantage+ auditoriya holati aniq berilishi shart (Graph v23+)
    targeting: { ...p.targeting, publisher_platforms: ["instagram"], instagram_positions: ["stream", "reels", "story", "explore"], targeting_automation: { advantage_audience: 0 } },
    promoted_object: p.objective === "REACH" ? undefined : { page_id: c.pageId },
    ...o.extra,
  }, "POST", token);
  await p.saved({ campaignId: campaign.id, adSetId: adSet.id });
  const creative = await graph<{ id: string }>(`${act}/adcreatives`, {
    name: p.name, object_id: c.pageId, instagram_user_id: c.igUserId, source_instagram_media_id: p.igMediaId,
    ...(p.objective === "LEADS" ? { call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: c.leadFormId } } } : {}),
  }, "POST", token);
  const ad = await graph<{ id: string }>(`${act}/ads`, { name: p.name, adset_id: adSet.id, creative: { creative_id: creative.id }, status: "PAUSED" }, "POST", token);
  await p.saved({ campaignId: campaign.id, adSetId: adSet.id, adId: ad.id });
  // Hammasi yaratildi — endi yoqamiz (yarim yaratilgan reklama pul sarflamasin)
  for (const id of [campaign.id, adSet.id, ad.id]) await graph(id, { status: "ACTIVE" }, "POST", token);
  return { campaignId: campaign.id, adSetId: adSet.id, adId: ad.id };
}

export async function setCampaignStatus(campaignId: string, status: "ACTIVE" | "PAUSED"): Promise<void> {
  await graph(campaignId, { status }, "POST", (await smmCreds()).adToken);
}

export type BoostStats = { spend: number; impressions: number; reach: number; clicks: number; results: number; effective?: string };

export async function boostStats(campaignId: string, objective: SmmBoostObjective): Promise<BoostStats> {
  const token = (await smmCreds()).adToken;
  const r = await graph<{ data?: { spend?: string; impressions?: string; reach?: string; clicks?: string; actions?: { action_type: string; value: string }[] }[] }>(
    `${campaignId}/insights`, { fields: "spend,impressions,reach,clicks,actions", date_preset: "maximum" }, "GET", token);
  const d = r.data?.[0] ?? {};
  const want = objective === "LEADS" ? ["lead", "onsite_conversion.lead_grouped"] : objective === "MESSAGES" ? ["onsite_conversion.messaging_conversation_started_7d"] : [];
  const results = (d.actions ?? []).filter((a) => want.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
  const st = await graph<{ effective_status?: string }>(campaignId, { fields: "effective_status" }, "GET", token).catch(() => ({ effective_status: undefined }));
  return { spend: Number(d.spend ?? 0), impressions: Number(d.impressions ?? 0), reach: Number(d.reach ?? 0), clicks: Number(d.clicks ?? 0), results, effective: st.effective_status };
}
