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

/* ───────────── Foydalanish statistikasi (KPI qatori) ───────────── */

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

/**
 * Panel chatida javob vaqti: har suhbatda user xabaridan keyingi birinchi assistant xabarigacha (ms).
 * `sendAction` savolni AI'dan oldin, javobni keyin yozadi — farq javob tayyorlash vaqti. Javobsiz qolgan savol
 * (xato) keyingi savolning javobiga ulanmaydi.
 */
export function panelLatencies(rows: { chatId: string; role: string; createdAt: Date }[]): number[] {
  const pending = new Map<string, number>(), out: number[] = [];
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (r.role === "user") pending.set(r.chatId, r.createdAt.getTime());
    else if (pending.has(r.chatId)) { out.push(r.createdAt.getTime() - pending.get(r.chatId)!); pending.delete(r.chatId); }
  }
  return out;
}

/**
 * Insof AI'dan foydalanish: panel chat (`AiMessage`) + Telegram bot (`TelegramMessage`), joriy oy va bugun.
 * `userId` berilsa — faqat shu foydalanuvchi; `null` — butun korxona (direktor uchun). Savol matni qaytarilmaydi:
 * panel suhbatlari egasiga xos, statistikada faqat son va vaqt.
 */
export async function aiUsageStats(userId: string | null) {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), month0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const chatScope = userId ? { chat: { userId } } : {}, tgScope = userId ? { account: { userId } } : {};
  const [panel, tg, chats, lastPanel, lastTg] = await Promise.all([
    db.aiMessage.findMany({ where: { ...chatScope, createdAt: { gte: month0 } }, select: { chatId: true, role: true, createdAt: true, chat: { select: { userId: true } } } }),
    db.telegramMessage.findMany({ where: { ...tgScope, createdAt: { gte: month0 } }, select: { kind: true, level: true, latencyMs: true, createdAt: true, account: { select: { userId: true } } } }),
    db.aiChat.count({ where: userId ? { userId } : {} }),
    db.aiMessage.findFirst({ where: { ...chatScope, role: "user" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.telegramMessage.findFirst({ where: tgScope, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const asked = panel.filter((m) => m.role === "user");
  const pLat = panelLatencies(panel), tLat = tg.map((m) => m.latencyMs).filter((v): v is number => v !== null);
  const users = new Set([...asked.map((m) => m.chat.userId), ...tg.map((m) => m.account.userId).filter((v): v is string => !!v)]);
  const last = [lastPanel && { at: lastPanel.createdAt, channel: "Panel" as const }, lastTg && { at: lastTg.createdAt, channel: "Telegram" as const }]
    .filter((x): x is { at: Date; channel: "Panel" | "Telegram" } => !!x).sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
  return {
    today: asked.filter((m) => m.createdAt >= today).length + tg.filter((m) => m.createdAt >= today).length,
    month: asked.length + tg.length,
    panel: { today: asked.filter((m) => m.createdAt >= today).length, month: asked.length, avgMs: avg(pLat) },
    telegram: { today: tg.filter((m) => m.createdAt >= today).length, month: tg.length, voice: tg.filter((m) => m.kind === "voice").length, llm: tg.filter((m) => m.level > 0).length, avgMs: avg(tLat) },
    /** Bu oy savol bergan foydalanuvchilar soni */
    users: users.size,
    /** O'rtacha javob vaqti (ms), ikkala kanal — bu oy */
    avgMs: avg([...pLat, ...tLat]),
    chats,
    last,
  };
}
export type AiUsage = Awaited<ReturnType<typeof aiUsageStats>>;
