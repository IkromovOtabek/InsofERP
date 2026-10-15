import type { SmmApproval, SmmBoostObjective, SmmBoostStatus, SmmChannel, SmmPublicationStatus } from "@/generated/prisma";
import type { BadgeColor } from "@/components/ui";

export const CHANNELS: SmmChannel[] = ["INSTAGRAM", "TELEGRAM", "FACEBOOK"];

export const CHANNEL_LABEL: Record<SmmChannel, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TELEGRAM: "Telegram" };

export const APPROVAL: Record<SmmApproval, { label: string; color: BadgeColor }> = {
  DRAFT: { label: "Qoralama", color: "slate" },
  PENDING: { label: "Tasdiq kutilmoqda", color: "amber" },
  APPROVED: { label: "Tasdiqlangan", color: "green" },
  REJECTED: { label: "Rad etilgan", color: "red" },
};

export const PUB_STATUS: Record<SmmPublicationStatus, { label: string; color: BadgeColor }> = {
  PENDING: { label: "Navbatda", color: "slate" },
  PUBLISHING: { label: "Yuborilmoqda", color: "blue" },
  PUBLISHED: { label: "Chiqdi", color: "green" },
  FAILED: { label: "Xato", color: "red" },
  SIMULATED: { label: "Sinov (yuborilmadi)", color: "violet" },
};

export const BOOST_OBJECTIVE: Record<SmmBoostObjective, { label: string; hint: string }> = {
  REACH: { label: "Ko'proq odam ko'rsin", hint: "Qamrov — brendni tanitish" },
  MESSAGES: { label: "Direct'ga yozishsin", hint: "Instagram Direct xabarlari" },
  LEADS: { label: "Ariza qoldirishsin", hint: "Lead forma → Sayt arizalari" },
};

export const BOOST_STATUS: Record<SmmBoostStatus, { label: string; color: BadgeColor }> = {
  PENDING_APPROVAL: { label: "Tasdiq kutilmoqda", color: "amber" },
  REJECTED: { label: "Rad etilgan", color: "red" },
  LAUNCHING: { label: "Ishga tushmoqda", color: "blue" },
  ACTIVE: { label: "Faol", color: "green" },
  PAUSED: { label: "To'xtatilgan", color: "slate" },
  COMPLETED: { label: "Tugagan", color: "slate" },
  FAILED: { label: "Xato", color: "red" },
  SIMULATED: { label: "Sinov (pul sarflanmadi)", color: "violet" },
};

/** Oylik limitga kiradigan holatlar (rad etilgan, xato va sinov kirmaydi) */
export const BOOST_COUNTED: SmmBoostStatus[] = ["PENDING_APPROVAL", "LAUNCHING", "ACTIVE", "PAUSED", "COMPLETED"];
