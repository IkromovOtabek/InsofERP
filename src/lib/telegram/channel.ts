import { db } from "@/lib/db";
import { botEnabled, getChat, getChatMember, getMe, sendMessage, TelegramError } from "./api";

/**
 * Ishlab chiqarish Telegram kanali: brigada tayinlanganda ERP boti (`TELEGRAM_BOT_TOKEN`) shu kanalga yozadi.
 * Kanal korxona bazasida (`CompanySettings.productionTgChat`) — direktor Sozlamalar → Zavod rekvizitlari'da ulaydi.
 * Bot kanalga administrator qilib qo'shilgan va «Xabar joylash» huquqi berilgan bo'lishi shart.
 */

/** "@kanal", "t.me/kanal", "https://t.me/kanal", "-100123…" → Bot API chat_id; tanilmasa — null. */
export function normalizeChat(raw: string): string | null {
  const t = raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (/^-?\d{5,}$/.test(t)) return t;
  const m = t.match(/^(?:t\.me\/|telegram\.me\/|@)?([A-Za-z][A-Za-z0-9_]{3,31})$/i);
  return m ? `@${m[1]}` : null;
}

export type ChannelCheck = { ok: true; chatId: string; title: string } | { ok: false; error: string };

/** Kanal mavjudmi va bot unda post yoza oladimi. Saqlashdan oldin va «Tekshirish» tugmasida chaqiriladi. */
export async function verifyChannel(raw: string): Promise<ChannelCheck> {
  if (!botEnabled()) return { ok: false, error: "ERP boti ulanmagan (serverda TELEGRAM_BOT_TOKEN yo'q)" };
  const chat = normalizeChat(raw);
  if (!chat) return { ok: false, error: "Kanal manzili noto'g'ri: @kanal_nomi yoki -100… raqamini kiriting (taklif havolasi t.me/+… ishlamaydi)" };
  try {
    const [me, c] = await Promise.all([getMe(), getChat(chat)]);
    const m = await getChatMember(c.id, me.id);
    if (c.type === "channel") {
      if (m.status !== "administrator" && m.status !== "creator") return { ok: false, error: "Bot kanalda administrator emas — botni kanalga admin qilib qo'shing" };
      if (m.status === "administrator" && m.can_post_messages === false) return { ok: false, error: "Botga «Xabar joylash» huquqi berilmagan" };
    } else if (m.status === "left" || m.status === "kicked") {
      return { ok: false, error: "Bot guruhga qo'shilmagan" };
    }
    return { ok: true, chatId: c.username ? `@${c.username}` : String(c.id), title: c.title ?? chat };
  } catch (e) {
    if (e instanceof TelegramError && e.code === 400) return { ok: false, error: "Kanal topilmadi — manzilni tekshiring va botni kanalga qo'shing" };
    if (e instanceof TelegramError && e.code === 403) return { ok: false, error: "Bot kanalga kira olmaydi — botni kanalga admin qilib qo'shing" };
    console.error("[telegram][channel]", e);
    return { ok: false, error: "Telegram javob bermadi — keyinroq qayta urinib ko'ring" };
  }
}

/** Ishlab chiqarish kanaliga oddiy matn (Markdown'siz: mijoz nomidagi `_`/`*` buzmasin). Kanal yo'q — jim o'tadi. */
export async function postToProductionChannel(text: string): Promise<boolean> {
  if (!botEnabled()) return false;
  const s = await db.companySettings.findUnique({ where: { id: "main" }, select: { productionTgChat: true } });
  if (!s?.productionTgChat) return false;
  await sendMessage(s.productionTgChat, text, { markdown: false });
  return true;
}
