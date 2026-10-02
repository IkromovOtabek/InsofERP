"use server";

import { requireSession } from "@/lib/auth";
import { aiAnswer, type Answer } from "@/lib/bi/ai";
import * as store from "@/lib/bi/ai-chat";
import { decode, encodeAnswer, type StoredMsg, type ChatListItem } from "./shared";

const ROLES = ["DIRECTOR", "FINANCE", "ACCOUNTING"] as const;

/** Har bir action boshida: sessiya + rol (mavjud /api/ai bilan bir xil), joriy userId qaytadi. */
async function uid(): Promise<string> {
  const s = await requireSession([...ROLES]);
  return s.userId;
}

export async function listChatsAction(): Promise<ChatListItem[]> {
  const cs = await store.listChats(await uid());
  return cs.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() }));
}

export async function loadChatAction(chatId: string): Promise<StoredMsg[] | null> {
  const msgs = await store.getChatMessages(await uid(), chatId);
  return msgs ? msgs.map(decode) : null;
}

export async function deleteChatAction(chatId: string): Promise<boolean> {
  return store.deleteChat(await uid(), chatId);
}

export async function renameChatAction(chatId: string, title: string): Promise<boolean> {
  return store.renameChat(await uid(), chatId, title.slice(0, 120));
}

/**
 * Savol yuborish: suhbat bo'lmasa yaratiladi; user savoli va AI javobi AiMessage sifatida saqlanadi.
 * Qaytadi: (yangi) chatId, yangilangan sarlavha, saqlangan user va assistant xabarlari.
 */
export async function sendAction(
  chatId: string | null,
  question: string,
  sp: Record<string, string | undefined>,
): Promise<{ chatId: string; title: string; user: StoredMsg; answer: StoredMsg } | { error: string }> {
  const userId = await uid();
  const q = question.trim().slice(0, 300);
  if (!q) return { error: "EMPTY" };

  const id = chatId ?? (await store.createChat(userId)).id;

  const userMsg = await store.addMessage(userId, id, "user", q);
  if (!userMsg) return { error: "NOT_FOUND" };

  let answer: Answer;
  try {
    answer = await aiAnswer(q, sp);
  } catch {
    answer = { key: "err", text: "Javob berishda xato yuz berdi. Qaytadan urinib ko'ring." };
  }
  const aiMsg = await store.addMessage(userId, id, "assistant", encodeAnswer(answer));
  if (!aiMsg) return { error: "NOT_FOUND" };

  const cs = await store.listChats(userId);
  const chat = cs.find((c) => c.id === id);
  return { chatId: id, title: chat?.title ?? store.makeTitle(q), user: decode(userMsg), answer: decode(aiMsg) };
}
