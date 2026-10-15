/** Marketing yorliqlari — bazasiz (mijoz komponentlari ham import qiladi; `lib/marketing.ts` bazaga ulanadi). */
import type { AdCampaignStatus, AdChannel, MarketingContentStatus, MarketingContentType } from "@/generated/prisma";
import type { BadgeColor } from "@/components/ui";

export const CONTENT_STATUS: Record<MarketingContentStatus, { label: string; color: BadgeColor }> = {
  IDEA: { label: "G'oya", color: "slate" },
  SCRIPT: { label: "Ssenariy", color: "blue" },
  FILMED: { label: "Suratga olindi", color: "violet" },
  EDITING: { label: "Montaj", color: "amber" },
  PUBLISHED: { label: "Chiqdi", color: "green" },
  CANCELLED: { label: "Bekor", color: "red" },
};
/** Kanban ustunlari (bekor qilinganlar alohida) */
export const CONTENT_FLOW: MarketingContentStatus[] = ["IDEA", "SCRIPT", "FILMED", "EDITING", "PUBLISHED"];

export const CONTENT_TYPE: Record<MarketingContentType, string> = {
  REELS: "Reels",
  POST: "Post",
  STORIES: "Stories",
  ARTICLE: "Maqola",
};

export const CHANNEL: Record<AdChannel, string> = {
  YANDEX: "Yandex",
  GOOGLE: "Google",
  INSTAGRAM: "Instagram",
  TELEGRAM: "Telegram",
  OTHER: "Boshqa",
};

export const CAMPAIGN_STATUS: Record<AdCampaignStatus, { label: string; color: BadgeColor }> = {
  DRAFT: { label: "Qoralama", color: "slate" },
  ACTIVE: { label: "Faol", color: "green" },
  PAUSED: { label: "To'xtatilgan", color: "amber" },
  FINISHED: { label: "Tugagan", color: "slate" },
};
