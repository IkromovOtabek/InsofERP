"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { BI_ROLES } from "../../shell";

const PATH = "/bi-tahlil/ai/telegram";
const CODE_TTL_MIN = 15;

export type CodeState = { error?: string; code?: string; expiresAt?: string } | undefined;

/** Bir martalik 6 xonali kod — foydalanuvchi uni botga yuboradi. */
export async function createLinkCode(): Promise<CodeState> {
  const s = await requireSession([...BI_ROLES]);
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000);

  // eski ishlatilmagan kodlarni bekor qilamiz — bir vaqtda bitta amaldagi kod bo'lsin
  await db.telegramLinkCode.deleteMany({ where: { userId: s.userId, usedAt: null } });

  for (let i = 0; i < 5; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    try {
      await db.telegramLinkCode.create({ data: { code, userId: s.userId, expiresAt } });
      revalidatePath(PATH);
      return { code, expiresAt: expiresAt.toISOString() };
    } catch { /* kod band — qayta urinamiz */ }
  }
  return { error: "Kod yaratilmadi — qayta urinib ko'ring." };
}

/** Chatni uzish: o'zinikini har kim, birovnikini faqat direktor. */
export async function unlinkAccount(id: string) {
  const s = await requireSession([...BI_ROLES]);
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
