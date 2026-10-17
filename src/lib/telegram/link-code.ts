import { randomInt } from "node:crypto";
import { db } from "@/lib/db";

/** Kod amal qilish muddati, daqiqa. */
export const LINK_CODE_TTL_MIN = 15;

/**
 * Telegram botga hisobni ulash kodi — bir martalik 8 xonali (kriptografik tasodifiy), 15 daqiqa.
 * Foydalanuvchi uni botga yuboradi. Eski ishlatilmagan kodlar bekor qilinadi — bir vaqtda bitta amaldagi kod.
 * Veb (BI → Insof AI → Telegram) va mobil ilova shu funksiyani chaqiradi; ruxsat (`bi-tahlil` → `ai`) chaqiruvchida.
 */
export async function createTelegramLinkCode(userId: string): Promise<{ code: string; expiresAt: Date } | { error: string }> {
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MIN * 60_000);
  await db.telegramLinkCode.deleteMany({ where: { userId, usedAt: null } });
  for (let i = 0; i < 5; i++) {
    const code = String(randomInt(10_000_000, 100_000_000));
    try {
      await db.telegramLinkCode.create({ data: { code, userId, expiresAt } });
      return { code, expiresAt };
    } catch { /* kod band — qayta urinamiz */ }
  }
  return { error: "Kod yaratilmadi — qayta urinib ko'ring." };
}
