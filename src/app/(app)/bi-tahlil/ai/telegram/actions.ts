"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession, requireAction } from "@/lib/auth";
import { createTelegramLinkCode } from "@/lib/telegram/link-code";

const PATH = "/bi-tahlil/ai/telegram";

export type CodeState = { error?: string; code?: string; expiresAt?: string } | undefined;

/** Bir martalik 8 xonali kod (kriptografik tasodifiy) — foydalanuvchi uni botga yuboradi. */
export async function createLinkCode(): Promise<CodeState> {
  const s = await requireAction("bi-tahlil", "ai");
  // Kod yaratish qoidasi — `lib/telegram/link-code.ts` (mobil ilova ham shu)
  const r = await createTelegramLinkCode(s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath(PATH);
  return { code: r.code, expiresAt: r.expiresAt.toISOString() };
}

/** Chatni uzish: o'zinikini har kim, birovnikini faqat direktor. */
export async function unlinkAccount(id: string) {
  const s = await requireAction("bi-tahlil", "ai");
  const acc = await db.telegramAccount.findUnique({ where: { id } });
  if (!acc) return;
  if (acc.userId !== s.userId && s.role !== "DIRECTOR") throw new Error("FORBIDDEN");
  await db.telegramAccount.update({ where: { id }, data: { userId: null, linkedAt: null } });
  revalidatePath(PATH);
}

/** Direktor chatni bloklaydi / blokdan chiqaradi. */
export async function toggleBlock(id: string) {
  await requireSession(["DIRECTOR"]);
  const acc = await db.telegramAccount.findUnique({ where: { id } });
  if (!acc) return;
  await db.telegramAccount.update({ where: { id }, data: { isBlocked: !acc.isBlocked } });
  revalidatePath(PATH);
}
