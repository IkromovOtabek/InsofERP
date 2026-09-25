/**
 * Telegram Bot API — yupqa klient (kutubxonasiz, faqat fetch).
 * Token: TELEGRAM_BOT_TOKEN (@BotFather dan olinadi).
 */

const API = "https://api.telegram.org";

export const botToken = () => process.env.TELEGRAM_BOT_TOKEN ?? "";
export const botEnabled = () => Boolean(botToken());

export class TelegramError extends Error {
  constructor(public method: string, public code: number, message: string) {
    super(`${method}: ${code} ${message}`);
  }
}

async function call<T>(method: string, body?: unknown): Promise<T> {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN yo'q");
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  const json = (await res.json()) as { ok: boolean; result?: T; error_code?: number; description?: string };
  if (!json.ok) throw new TelegramError(method, json.error_code ?? res.status, json.description ?? "noma'lum xato");
  return json.result as T;
}

/* ───────────── Update turlari (faqat kerakli maydonlar) ───────────── */

export type TgChat = { id: number; type: string };
export type TgUser = { id: number; is_bot: boolean; first_name?: string; username?: string };
export type TgVoice = { file_id: string; duration: number; mime_type?: string; file_size?: number };
/** Foydalanuvchi "Telefon raqamimni yuborish" tugmasini bosganda keladi. */
export type TgContact = { phone_number: string; user_id?: number; first_name?: string };
export type TgAudio = TgVoice & { file_name?: string };
export type TgMessage = {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  voice?: TgVoice;
  audio?: TgAudio;
  video_note?: TgVoice;
  contact?: TgContact;
};
export type TgUpdate = { update_id: number; message?: TgMessage; edited_message?: TgMessage };

/* ───────────── Amallar ───────────── */

/** Telegram xabari 4096 belgidan uzun bo'la olmaydi — bo'laklab yuboramiz. */
function chunks(text: string, size = 3800): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const cut = rest.lastIndexOf("\n", size);
    const i = cut > size * 0.5 ? cut : size;
    out.push(rest.slice(0, i));
    rest = rest.slice(i).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Chat ostidagi tugmalar. `contact` — Telegram o'zi tasdiqlagan raqamni yuborish tugmasi
 * (hisobni ulash uchun), `remove` — ulangandan keyin tugmani olib tashlash.
 */
const replyMarkup = (k: "contact" | "remove" | undefined) =>
  k === "contact"
    ? { keyboard: [[{ text: "📱 Telefon raqamimni yuborish", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
    : k === "remove"
      ? { remove_keyboard: true }
      : undefined;

export async function sendMessage(chatId: number | string, text: string, opts?: { markdown?: boolean; replyTo?: number; keyboard?: "contact" | "remove" }) {
  let last: TgMessage | undefined;
  const parts = chunks(text);
  for (const [i, part] of parts.entries()) {
    // Tugmalar faqat oxirgi bo'lakka — bo'lingan xabarda klaviatura takrorlanmasin
    const markup = i === parts.length - 1 ? replyMarkup(opts?.keyboard) : undefined;
    last = await call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text: part,
      parse_mode: opts?.markdown === false ? undefined : "Markdown",
      link_preview_options: { is_disabled: true },
      reply_to_message_id: opts?.replyTo,
      reply_markup: markup,
    }).catch((e) => {
      // Markdown buzilgan bo'lsa — oddiy matn bilan qayta urinamiz
      if (e instanceof TelegramError && e.code === 400) {
        return call<TgMessage>("sendMessage", { chat_id: chatId, text: part, link_preview_options: { is_disabled: true }, reply_markup: markup });
      }
      throw e;
    });
  }
  return last;
}

/** "yozmoqda…" holati — uzoq javoblarda foydalanuvchi kutayotganini bilishi uchun. */
export async function sendChatAction(chatId: number | string, action: "typing" | "upload_voice" = "typing") {
  try { await call("sendChatAction", { chat_id: chatId, action }); } catch { /* muhim emas */ }
}

/** Fayl mazmunini yuklab olish (ovozli xabar uchun). Telegram limiti — 20 MB. */
export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const f = await call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!f.file_path) throw new Error("Fayl yo'li olinmadi");
  const res = await fetch(`${API}/file/bot${botToken()}/${f.file_path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fayl yuklanmadi: ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), path: f.file_path };
}

export type BotInfo = { id: number; username?: string; first_name?: string };
export const getMe = () => call<BotInfo>("getMe");

/**
 * Bot nomi (`t.me/...` havolasi uchun). Natija jarayon xotirasida saqlanadi —
 * bot nomi o'zgarmaydi, har sahifada Telegram'ga so'rov yuborish shart emas.
 * Xato bo'lsa keshlanmaydi: keyingi urinish yana so'raydi.
 */
let botName: string | null = null;
export async function botUsername(): Promise<string | null> {
  if (botName) return botName;
  if (!botEnabled()) return null;
  botName = await getMe().then((b) => b.username ?? null).catch(() => null);
  return botName;
}

export const setWebhook = (url: string, secret?: string) =>
  call<boolean>("setWebhook", {
    url,
    secret_token: secret || undefined,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });

export const deleteWebhook = () => call<boolean>("deleteWebhook", { drop_pending_updates: true });

export const getWebhookInfo = () =>
  call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>("getWebhookInfo");

/** Long polling (lokal ishlab chiqish uchun — webhook o'rniga). */
export const getUpdates = (offset: number, timeout = 30) =>
  call<TgUpdate[]>("getUpdates", { offset, timeout, allowed_updates: ["message"] });

/** Bot buyruqlari menyusi (Telegram'dagi "/" tugmasi). */
export const setMyCommands = (commands: { command: string; description: string }[]) =>
  call<boolean>("setMyCommands", { commands });
