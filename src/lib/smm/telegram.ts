/**
 * Telegram kanalga nashr (Bot API). Bot kanalda administrator bo'lishi kerak.
 * Fayl botga to'g'ridan-to'g'ri yuklanadi (multipart) — ommaviy havola shart emas. Video ≤ 50 MB (Bot API chegarasi).
 */
import { readFile, stat } from "node:fs/promises";
import { smmCreds } from "./config";

export type PostMedia = { kind: "IMAGE" | "VIDEO"; file: string; mime: string; name: string };
export type PublishResult = { externalId: string; permalink: string | null };

const CAPTION_MAX = 1024; // media izohi chegarasi
const TEXT_MAX = 4096;
const VIDEO_MAX = 50 * 1024 * 1024;

async function tg<T>(method: string, body: FormData | Record<string, unknown>, token?: string): Promise<T> {
  const url = `https://api.telegram.org/bot${token ?? (await smmCreds()).tgToken}/${method}`;
  const res = await fetch(url, body instanceof FormData
    ? { method: "POST", body, signal: AbortSignal.timeout(120_000) }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
  if (!j?.ok) throw new Error(`Telegram: ${j?.description ?? `HTTP ${res.status}`}`);
  return j.result as T;
}

/** Sozlamalarda ulashda tekshiruv: bot ishlaydimi va kanalda admin(post yozish huquqi)mi */
export async function verifyTelegram(token: string, chat: string): Promise<{ title: string; username?: string; chatId: string; members?: number }> {
  const me = await tg<{ id: number }>("getMe", {}, token);
  const c = await tg<{ id: number; title?: string; username?: string }>("getChat", { chat_id: chat }, token);
  const m = await tg<{ status: string; can_post_messages?: boolean }>("getChatMember", { chat_id: c.id, user_id: me.id }, token);
  if (m.status !== "administrator" && m.status !== "creator") throw new Error("Telegram: bot kanalda administrator emas — botni kanalga admin qilib qo'shing");
  if (m.status === "administrator" && m.can_post_messages === false) throw new Error("Telegram: botga «Xabar joylash» huquqi berilmagan");
  const members = await tg<number>("getChatMemberCount", { chat_id: c.id }, token).catch(() => undefined);
  return { title: c.title ?? chat, username: c.username, chatId: c.username ? `@${c.username}` : String(c.id), members };
}

/** Kanal obunachilari soni (kunlik statistika uchun) */
export async function telegramMembers(): Promise<number | undefined> {
  const { tgChat } = await smmCreds();
  return tg<number>("getChatMemberCount", { chat_id: tgChat }).catch(() => undefined);
}

async function blob(m: PostMedia): Promise<Blob> {
  return new Blob([new Uint8Array(await readFile(m.file))], { type: m.mime });
}

function permalink(chat: string, messageId: number): string | null {
  if (chat.startsWith("@")) return `https://t.me/${chat.slice(1)}/${messageId}`;
  if (chat.startsWith("-100")) return `https://t.me/c/${chat.slice(4)}/${messageId}`;
  return null;
}

export async function publishTelegram(text: string, media: PostMedia[]): Promise<PublishResult> {
  const chat = (await smmCreds()).tgChat;
  for (const m of media) {
    if (m.kind === "VIDEO" && (await stat(m.file)).size > VIDEO_MAX) throw new Error("Telegram: video 50 MB dan katta (bot chegarasi) — siqilgan nusxa yuklang");
  }
  const longText = text.length > CAPTION_MAX;
  const caption = longText ? undefined : text;
  let firstId: number;

  if (media.length === 0) {
    const r = await tg<{ message_id: number }>("sendMessage", { chat_id: chat, text: text.slice(0, TEXT_MAX), disable_web_page_preview: true });
    return { externalId: String(r.message_id), permalink: permalink(chat, r.message_id) };
  }
  if (media.length === 1) {
    const m = media[0]!;
    const fd = new FormData();
    fd.set("chat_id", chat);
    fd.set(m.kind === "VIDEO" ? "video" : "photo", await blob(m), m.name);
    if (caption) fd.set("caption", caption);
    if (m.kind === "VIDEO") fd.set("supports_streaming", "true");
    const r = await tg<{ message_id: number }>(m.kind === "VIDEO" ? "sendVideo" : "sendPhoto", fd);
    firstId = r.message_id;
  } else {
    const fd = new FormData();
    fd.set("chat_id", chat);
    const group = media.slice(0, 10).map((m, i) => ({ type: m.kind === "VIDEO" ? "video" : "photo", media: `attach://f${i}`, ...(i === 0 && caption ? { caption } : {}) }));
    fd.set("media", JSON.stringify(group));
    for (let i = 0; i < group.length; i++) fd.set(`f${i}`, await blob(media[i]!), media[i]!.name);
    const r = await tg<{ message_id: number }[]>("sendMediaGroup", fd);
    firstId = r[0]!.message_id;
  }
  // Uzun matn media izohiga sig'maydi — keyingi xabar bo'lib chiqadi
  // Media chiqib bo'ldi: bu qadam yiqilsa butun nashr xato deb belgilanmaydi (aks holda «Qayta urinish» mediani takrorlaydi)
  if (longText) {
    await tg("sendMessage", { chat_id: chat, text: text.slice(0, TEXT_MAX), disable_web_page_preview: true, reply_to_message_id: firstId })
      .catch((e) => console.error("[smm] telegram matn", e instanceof Error ? e.message : e));
  }
  return { externalId: String(firstId), permalink: permalink(chat, firstId) };
}
