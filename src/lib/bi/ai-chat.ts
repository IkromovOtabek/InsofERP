import { db } from "@/lib/db";

/**
 * BI "Tahlil" AI chat suhbatlarini saqlash qatlami.
 *
 * Har bir funksiya `userId` oladi va FAQAT shu foydalanuvchining suhbatlari bilan ishlaydi
 * (begona suhbat ko'rinmaydi/o'zgarmaydi). Sessiya/rol tekshiruvi chaqiruvchida (server action)
 * amalga oshiriladi — bu modul sof ma'lumot qatlami.
 */

export type ChatSummary = { id: string; title: string; createdAt: Date; updatedAt: Date };
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: Date };

const DEFAULT_TITLE = "Yangi suhbat";

/** Birinchi user xabaridan qisqartirilgan sarlavha. */
export function makeTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_TITLE;
  const cut = clean.slice(0, 48);
  return cut.length < clean.length ? `${cut.trimEnd()}…` : cut;
}

/** Foydalanuvchining suhbatlari — eng so'nggi yangilangani birinchi. */
export function listChats(userId: string): Promise<ChatSummary[]> {
  return db.aiChat.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

/** Suhbat egasi tasdiqlanadi; xabarlar vaqt bo'yicha. Begona/yo'q suhbat — null. */
export async function getChatMessages(userId: string, chatId: string): Promise<ChatMessage[] | null> {
  const chat = await db.aiChat.findFirst({ where: { id: chatId, userId }, select: { id: true } });
  if (!chat) return null;
  const rows = await db.aiMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, role: r.role === "assistant" ? "assistant" : "user" }));
}

export function createChat(userId: string, title?: string): Promise<ChatSummary> {
  return db.aiChat.create({
    data: { userId, title: title?.trim() || DEFAULT_TITLE },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

/** Faqat egasining suhbatini o'chiradi (xabarlar onDelete: Cascade bilan ketadi). */
export async function deleteChat(userId: string, chatId: string): Promise<boolean> {
  const r = await db.aiChat.deleteMany({ where: { id: chatId, userId } });
  return r.count > 0;
}

/** Faqat egasining suhbat nomini yangilaydi. */
export async function renameChat(userId: string, chatId: string, title: string): Promise<boolean> {
  const r = await db.aiChat.updateMany({ where: { id: chatId, userId }, data: { title: title.trim() || DEFAULT_TITLE } });
  return r.count > 0;
}

/**
 * Egasi tasdiqlangan suhbatga xabar qo'shadi. Birinchi user xabarida avtomatik sarlavha qo'yiladi,
 * aks holda suhbatning `updatedAt` yangilanadi (ro'yxat tartibi uchun). Begona/yo'q suhbat — null.
 */
export async function addMessage(
  userId: string,
  chatId: string,
  role: "user" | "assistant",
  content: string,
): Promise<ChatMessage | null> {
  const chat = await db.aiChat.findFirst({ where: { id: chatId, userId }, select: { id: true, title: true } });
  if (!chat) return null;

  const msg = await db.aiMessage.create({
    data: { chatId, role, content },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  if (role === "user" && chat.title === DEFAULT_TITLE) {
    await db.aiChat.update({ where: { id: chatId }, data: { title: makeTitle(content) } });
  } else {
    // @updatedAt faqat update'da yangilanadi — ro'yxatni tepaga ko'tarish uchun teginamiz
    await db.aiChat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
  }

  return { ...msg, role: msg.role === "assistant" ? "assistant" : "user" };
}
