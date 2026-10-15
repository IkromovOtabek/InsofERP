/**
 * SMM kalitlari. Asosiy manba — Marketing → Sozlamalar'da ulangan profillar (`SmmAccount`, token shifrlangan).
 * Profil ulanmagan bo'lsa — korxona muhitidan (`tenants/<slug>.env`, eski usul):
 *
 *   SMM_TELEGRAM_CHAT_ID   kanal: @kanal_nomi yoki -100…; bot kanalda admin bo'lishi shart
 *   SMM_TELEGRAM_BOT_TOKEN (ixtiyoriy) alohida bot; bo'lmasa TELEGRAM_BOT_TOKEN
 *   META_ACCESS_TOKEN      tizim foydalanuvchisi tokeni (instagram_content_publish, pages_manage_posts, ads_management, …)
 *   META_PAGE_ACCESS_TOKEN (ixtiyoriy) sahifa tokeni — Facebook sahifaga nashr uchun; bo'lmasa META_ACCESS_TOKEN
 *   META_IG_USER_ID        Instagram Business hisob id
 *   META_PAGE_ID           Facebook sahifa id
 *   META_AD_ACCOUNT_ID     reklama kabineti: act_… (target uchun; Sozlamalar'da ham kiritiladi)
 *   META_LEAD_FORM_ID      (ixtiyoriy) Lead Ads formasi
 *   META_GRAPH_VERSION     standart v23.0
 *   META_APP_ID / META_APP_SECRET — «Meta bilan ulash» tugmasi (OAuth) uchun Meta Developer ilovasi
 *   SMM_DRY_RUN=1          tarmoqqa hech narsa yubormaslik (sinov) — test rejimida doim yoqiq
 */
import type { SmmChannel } from "@/generated/prisma";
import { db } from "@/lib/db";
import { isTestMode } from "@/lib/test-mode";
import { unseal } from "./vault";

const env = (k: string) => (process.env[k] ?? "").trim();
const act = (v: string | null | undefined) => (v && !v.startsWith("act_") ? `act_${v}` : v ?? "");

export type SmmCreds = {
  tgToken: string; tgChat: string;
  igUserId: string; igToken: string;
  pageId: string; pageToken: string;
  adToken: string; adAccount: string; leadFormId: string;
  graphVersion: string;
};

export const graphVersion = () => env("META_GRAPH_VERSION") || "v23.0";
export const metaAppReady = () => !!(env("META_APP_ID") && env("META_APP_SECRET"));
export const metaApp = () => ({ id: env("META_APP_ID"), secret: env("META_APP_SECRET") });

let cache: { at: number; v: SmmCreds } | null = null;
const TTL = 15_000;

/** Sozlamalar o'zgarganda (ulash/uzish) — keshni tozalash */
export function resetSmmCreds() { cache = null; }

/** Joriy kalitlar: bazadagi asosiy profillar, bo'lmasa muhit o'zgaruvchilari */
export async function smmCreds(): Promise<SmmCreds> {
  if (cache && Date.now() - cache.at < TTL) return cache.v;
  const [accounts, settings] = await Promise.all([
    db.smmAccount.findMany({ where: { isPrimary: true, status: { in: ["ACTIVE", "ERROR"] } } }),
    db.marketingSettings.findUnique({ where: { id: "main" }, select: { adAccountId: true, leadFormId: true } }),
  ]);
  const by = (ch: SmmChannel) => accounts.find((a) => a.channel === ch);
  const ig = by("INSTAGRAM"), fb = by("FACEBOOK"), tg = by("TELEGRAM");
  const igToken = unseal(ig?.tokenEnc);
  const fbToken = unseal(fb?.tokenEnc);
  const tgToken = unseal(tg?.tokenEnc);
  const userToken = unseal(ig?.userTokenEnc) || unseal(fb?.userTokenEnc);
  const metaEnv = env("META_ACCESS_TOKEN");
  const v: SmmCreds = {
    tgToken: (tg && tgToken) || env("SMM_TELEGRAM_BOT_TOKEN") || env("TELEGRAM_BOT_TOKEN"),
    tgChat: (tg && tgToken ? tg.externalId : "") || env("SMM_TELEGRAM_CHAT_ID"),
    igUserId: (ig && igToken ? ig.externalId : "") || env("META_IG_USER_ID"),
    igToken: igToken || metaEnv,
    pageId: (fb && fbToken ? fb.externalId : "") || ig?.pageId || env("META_PAGE_ID"),
    pageToken: fbToken || igToken || env("META_PAGE_ACCESS_TOKEN") || metaEnv,
    adToken: userToken || metaEnv,
    adAccount: act(settings?.adAccountId || env("META_AD_ACCOUNT_ID")),
    leadFormId: settings?.leadFormId || env("META_LEAD_FORM_ID"),
    graphVersion: graphVersion(),
  };
  cache = { at: Date.now(), v };
  return v;
}

/** Sinov rejimi: tarmoqqa yuborilmaydi, natija SIMULATED bo'ladi */
export const smmDryRun = () => isTestMode() || env("SMM_DRY_RUN") === "1";

/** Tarmoq uchun kalitlar to'liqmi */
export async function channelReady(ch: SmmChannel): Promise<boolean> {
  const c = await smmCreds();
  if (ch === "TELEGRAM") return !!(c.tgToken && c.tgChat);
  if (ch === "INSTAGRAM") return !!(c.igToken && c.igUserId);
  return !!(c.pageToken && c.pageId);
}

export async function adsReady(): Promise<boolean> {
  const c = await smmCreds();
  return !!(c.adToken && c.adAccount && c.pageId && c.igUserId);
}

/** Qaysi tarmoq ulanmagan (sahifalarda ogohlantirish uchun; kalit qiymatlari ko'rsatilmaydi) */
export async function missingChannels(): Promise<Record<SmmChannel | "ADS", boolean>> {
  const [tg, ig, fb, ads] = await Promise.all([channelReady("TELEGRAM"), channelReady("INSTAGRAM"), channelReady("FACEBOOK"), adsReady()]);
  return { TELEGRAM: !tg, INSTAGRAM: !ig, FACEBOOK: !fb, ADS: !ads };
}
