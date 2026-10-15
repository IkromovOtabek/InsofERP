/**
 * SMM sozlamalari — korxona muhitida (`tenants/<slug>.env`), maxfiy kalitlar bazaga yozilmaydi.
 *
 *   SMM_TELEGRAM_CHAT_ID   kanal: @kanal_nomi yoki -100…; bot kanalda admin bo'lishi shart
 *   SMM_TELEGRAM_BOT_TOKEN (ixtiyoriy) alohida bot; bo'lmasa TELEGRAM_BOT_TOKEN
 *   META_ACCESS_TOKEN      tizim foydalanuvchisi tokeni (instagram_content_publish, pages_manage_posts, ads_management, …)
 *   META_PAGE_ACCESS_TOKEN (ixtiyoriy) sahifa tokeni — Facebook sahifaga nashr uchun; bo'lmasa META_ACCESS_TOKEN
 *   META_IG_USER_ID        Instagram Business hisob id
 *   META_PAGE_ID           Facebook sahifa id
 *   META_AD_ACCOUNT_ID     reklama kabineti: act_… (target uchun)
 *   META_LEAD_FORM_ID      (ixtiyoriy) Lead Ads formasi — «Ariza» maqsadli target uchun
 *   META_GRAPH_VERSION     standart v23.0
 *   SMM_DRY_RUN=1          tarmoqqa hech narsa yubormaslik (sinov) — test rejimida doim yoqiq
 */
import type { SmmChannel } from "@/generated/prisma";
import { isTestMode } from "@/lib/test-mode";

const env = (k: string) => (process.env[k] ?? "").trim();

export const smmEnv = {
  tgToken: () => env("SMM_TELEGRAM_BOT_TOKEN") || env("TELEGRAM_BOT_TOKEN"),
  tgChat: () => env("SMM_TELEGRAM_CHAT_ID"),
  metaToken: () => env("META_ACCESS_TOKEN"),
  pageToken: () => env("META_PAGE_ACCESS_TOKEN") || env("META_ACCESS_TOKEN"),
  igUserId: () => env("META_IG_USER_ID"),
  pageId: () => env("META_PAGE_ID"),
  adAccount: () => {
    const v = env("META_AD_ACCOUNT_ID");
    return v && !v.startsWith("act_") ? `act_${v}` : v;
  },
  leadFormId: () => env("META_LEAD_FORM_ID"),
  graphVersion: () => env("META_GRAPH_VERSION") || "v23.0",
};

/** Sinov rejimi: tarmoqqa yuborilmaydi, natija SIMULATED bo'ladi */
export const smmDryRun = () => isTestMode() || env("SMM_DRY_RUN") === "1";

/** Tarmoq uchun kalitlar to'liqmi */
export function channelReady(ch: SmmChannel): boolean {
  if (ch === "TELEGRAM") return !!(smmEnv.tgToken() && smmEnv.tgChat());
  if (ch === "INSTAGRAM") return !!(smmEnv.metaToken() && smmEnv.igUserId());
  return !!(smmEnv.pageToken() && smmEnv.pageId());
}

export const adsReady = () => !!(smmEnv.metaToken() && smmEnv.adAccount() && smmEnv.pageId() && smmEnv.igUserId());

/** Sozlamalar sahifasi uchun: qaysi kalit yetishmaydi (qiymatlar ko'rsatilmaydi) */
export function missingKeys(): Record<SmmChannel | "ADS", string[]> {
  const miss = (pairs: [string, string][]) => pairs.filter(([, v]) => !v).map(([k]) => k);
  return {
    TELEGRAM: miss([["TELEGRAM_BOT_TOKEN", smmEnv.tgToken()], ["SMM_TELEGRAM_CHAT_ID", smmEnv.tgChat()]]),
    INSTAGRAM: miss([["META_ACCESS_TOKEN", smmEnv.metaToken()], ["META_IG_USER_ID", smmEnv.igUserId()]]),
    FACEBOOK: miss([["META_PAGE_ACCESS_TOKEN / META_ACCESS_TOKEN", smmEnv.pageToken()], ["META_PAGE_ID", smmEnv.pageId()]]),
    ADS: miss([["META_ACCESS_TOKEN", smmEnv.metaToken()], ["META_AD_ACCOUNT_ID", smmEnv.adAccount()], ["META_PAGE_ID", smmEnv.pageId()], ["META_IG_USER_ID", smmEnv.igUserId()]]),
  };
}
