import { db } from "@/lib/db";
import { botEnabled, sendMessage } from "./api";

/**
 * Xodimga Telegram bot orqali xabar yuborish.
 *
 * Nega bot: bepul va bir zumda yetib boradi. Bot ulanmagan bo'lsa oqim to'xtamaydi —
 * chaqiruvchi Telegram Gateway'ga o'tadi (`lib/password-reset.ts`, `lib/code-login.ts`).
 *
 * Kod hech qayerda jurnalga ochiq yozilmaydi: chatning o'zida qoladi.
 */
export type BotDelivery = { ok: true; chatId: string } | { ok: false; reason: "NO_BOT" | "NOT_LINKED" | "FAILED" };

/** Xodimning ulangan shaxsiy chati. Direktor uzib qo'ygan (bloklangan) chat hisobga olinmaydi. */
export async function linkedChatId(userId: string): Promise<string | null> {
  const acc = await db.telegramAccount.findFirst({
    where: { userId, isBlocked: false },
    orderBy: { linkedAt: "desc" },
    select: { chatId: true },
  });
  return acc?.chatId ?? null;
}

/** Xodimning boti ulanganmi — sahifada "kod botga keladi" deb yozish uchun. */
export const hasLinkedChat = async (userId: string) => Boolean(botEnabled() && (await linkedChatId(userId)));

async function send(userId: string, text: string): Promise<BotDelivery> {
  if (!botEnabled()) return { ok: false, reason: "NO_BOT" };
  const chatId = await linkedChatId(userId);
  if (!chatId) return { ok: false, reason: "NOT_LINKED" };
  try {
    await sendMessage(chatId, text);
    return { ok: true, chatId };
  } catch (e) {
    console.error("[telegram][notify]", e);
    return { ok: false, reason: "FAILED" };
  }
}

/** "Mening hisobim": login/parolni o'zgartirishni tasdiqlash kodi — xodimning o'z chatiga. */
export const sendAccountChangeCodeToBot = (userId: string, code: string) =>
  send(userId, [
    "*Insof ERP — login yoki parolni o'zgartirish*",
    "",
    `Kod: \`${code}\``,
    "",
    "Kod 5 daqiqa amal qiladi.",
    "Kodni hech kimga bermang. O'zgartirishni siz boshlamagan bo'lsangiz — parolingizni almashtiring va direktorga xabar bering.",
  ].join("\n"));

/** Parolni tiklash kodi — xodimning o'z chatiga. */
export const sendResetCodeToBot = (userId: string, code: string) =>
  send(userId, [
    "*Insof ERP — parolni tiklash*",
    "",
    `Kod: \`${code}\``,
    "",
    "Kod 5 daqiqa amal qiladi.",
    "Kodni hech kimga bermang — biz uni hech qachon so'ramaymiz. Parolni tiklashni siz boshlamagan bo'lsangiz, bu xabarga e'tibor bermang.",
  ].join("\n"));
