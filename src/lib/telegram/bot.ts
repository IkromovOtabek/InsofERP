import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/nav";
import { CATALOG, type Answer } from "@/lib/bi/ai";
import { askInsofAi } from "@/lib/bi/answer";
import type { LlmTurn } from "@/lib/ai/llm";
import { AMBIGUOUS_PHONE_ERROR, staffByPhone } from "@/lib/phone-lookup";
import { sendChatAction, sendMessage, downloadFile, type TgContact, type TgMessage, type TgUpdate, type TgVoice } from "./api";
import { transcribe, sttEnabled, SttError } from "./stt";

/** Tahlil ma'lumotlari — /api/ai bilan bir xil rollar. */
const AI_ROLES = new Set(["DIRECTOR", "FINANCE", "ACCOUNTING"]);

const HELP = [
  "*Insof AI — Telegram bot*",
  "",
  "*Ovozli xabar yuboring* — savolingizni o'zbekcha ayting, tizim raqamlar bilan javob beradi.",
  "Matn bilan ham yozish mumkin.",
  "",
  "Masalan:",
  "• «Bugun qancha sotildi?»",
  "• «Qaysi mijozda qarz ko'p?»",
  "• «Qaysi xomashyo tugayapti?»",
  "• «Reja necha foiz bajarildi?»",
  "",
  "Parolni unutsangiz — ERP «Parolni tiklash» bo'limidan kod so'rang, kod SMS o'rniga shu yerga keladi.",
  "",
  "Buyruqlar: /savollar — tayyor savollar, /uzish — hisobni uzish, /yordam — shu matn.",
].join("\n");

export const BOT_COMMANDS = [
  { command: "start", description: "Boshlash / hisobni ulash" },
  { command: "savollar", description: "Tayyor savollar ro'yxati" },
  { command: "yordam", description: "Bot nima qila oladi" },
  { command: "uzish", description: "Hisobni botdan uzish" },
];

/* ───────────── Yordamchilar ───────────── */

const appUrl = () => (process.env.APP_URL ?? "").replace(/\/+$/, "");

/**
 * Telegram eski Markdown rejimi `*qalin*` va `_kursiv_` ni tushunadi, `**qalin**` ni emas —
 * til modeli esa odatdagi Markdown'da yozadi. Sarlavha belgilarini ham olib tashlaymiz.
 */
function toTelegramMarkdown(text: string) {
  return tablesToLines(text)
    .replace(/`(https?:\/\/[^`\s]+)`/g, "$1") // havola kod ichida bo'lsa bosib bo'lmaydi
    .replace(/\*\*(.+?)\*\*/gs, "*$1*")
    .replace(/__(.+?)__/gs, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Markdown jadval Telegramda ko'rinmaydi (ko'rsatma bo'lsa ham model ba'zan jadval chizadi).
 * Har qatorni "• birinchi ustun — Sarlavha: qiymat · Sarlavha: qiymat" ko'rinishiga o'tkazamiz.
 */
function tablesToLines(text: string) {
  const out: string[] = [];
  let header: string[] | null = null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!(t.startsWith("|") && t.endsWith("|"))) { header = null; out.push(line); continue; }
    const cells = t.slice(1, -1).split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // ajratgich |---|---|
    if (!header) { header = cells; continue; }
    const [first, ...rest] = cells;
    out.push(`• ${first}${rest.length ? " — " + rest.map((c, i) => (header![i + 1] ? `${header![i + 1]}: ${c}` : c)).join(" · ") : ""}`);
  }
  return out.join("\n");
}

/** Answer → Telegram matni (Markdown). */
function render(a: Answer, transcript?: string) {
  const parts: string[] = [];
  if (transcript) parts.push(`_${transcript.replace(/[_*[\]`]/g, "")}_\n`);
  parts.push(toTelegramMarkdown(a.text));
  if (a.bullets?.length) parts.push(a.bullets.map((b) => `• ${b}`).join("\n"));
  if (a.href) {
    const base = appUrl();
    parts.push(base ? `Havola: [${a.href.label}](${base}${a.href.href})` : `Havola: ${a.href.label} — ${a.href.href}`);
  }
  return parts.join("\n\n");
}

const voiceOf = (m: TgMessage): (TgVoice & { file_name?: string }) | null => m.voice ?? m.audio ?? m.video_note ?? null;

/* ───────────── Asosiy ishlov ───────────── */

export async function handleUpdate(u: TgUpdate): Promise<void> {
  const msg = u.message;
  if (!msg || msg.from?.is_bot) return;
  const chatId = msg.chat.id;

  if (msg.chat.type !== "private") {
    await sendMessage(chatId, "Bot faqat shaxsiy yozishmada ishlaydi — menga to'g'ridan-to'g'ri yozing.");
    return;
  }

  const account = await db.telegramAccount.upsert({
    where: { chatId: String(chatId) },
    update: { username: msg.from?.username ?? null, firstName: msg.from?.first_name ?? null, lastSeen: new Date() },
    create: { chatId: String(chatId), username: msg.from?.username ?? null, firstName: msg.from?.first_name ?? null },
    include: { user: true },
  });

  // "Telefon raqamimni yuborish" tugmasi — hisobni raqam bo'yicha ulash (kontakt xabarida matn yo'q)
  if (msg.contact) { await linkByPhone(account.id, chatId, msg.contact, msg.from?.id); return; }

  const text = (msg.text ?? msg.caption ?? "").trim();
  const cmd = text.startsWith("/") ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : null;

  if (cmd === "start") {
    if (account.userId) { await sendMessage(chatId, `Assalomu alaykum, ${account.user?.fullName ?? ""}! Hisobingiz ulangan.\n\n${HELP}`, { keyboard: "remove" }); return; }
    await sendMessage(chatId, startText(), { keyboard: "contact" });
    return;
  }
  if (cmd === "yordam" || cmd === "help") { await sendMessage(chatId, HELP); return; }
  if (cmd === "uzish") {
    if (!account.userId) { await sendMessage(chatId, "Hisob ulanmagan."); return; }
    await db.telegramAccount.update({ where: { id: account.id }, data: { userId: null, linkedAt: null } });
    await sendMessage(chatId, "Hisob uzildi. Endi parolni tiklash kodi ham bu yerga kelmaydi.\n\nQayta ulash: /start bosib telefon raqamingizni yuboring yoki *Tahlil → Insof AI → Telegram bot* bo'limidan kod oling.", { keyboard: "contact" });
    return;
  }
  if (cmd === "savollar") {
    await sendMessage(chatId, ["*Tayyor savollar* — nusxa olib yuboring yoki ovozda ayting:", "",
      ...CATALOG.map((g) => `*${g.group}*\n${g.items.map((i) => `• ${i.q}`).join("\n")}`)].join("\n\n"));
    return;
  }

  /* ── Ulanmagan chat: faqat kod qabul qilamiz ── */
  if (!account.userId) {
    const code = text.replace(/\s|-/g, "");
    if (/^\d{6}$/.test(code)) { await link(account.id, chatId, code); return; }
    await sendMessage(chatId, startText(), { keyboard: "contact" });
    return;
  }

  /* ── Ruxsat tekshiruvi ── */
  if (account.isBlocked) { await sendMessage(chatId, "Bu chat direktor tomonidan bloklangan."); return; }
  const user = account.user!;
  if (!user.isActive) { await sendMessage(chatId, "Sizning ERP hisobingiz bloklangan — botdan foydalana olmaysiz."); return; }
  if (!AI_ROLES.has(user.role)) {
    await sendMessage(chatId, `Sizning rolingizda (${ROLE_LABELS[user.role]}) tahlil ma'lumotlari yopiq. Bot direktor, moliya va buxgalteriya uchun ishlaydi.`);
    return;
  }

  /* ── Savol: ovoz yoki matn ── */
  const voice = voiceOf(msg);
  let question = text;
  let transcript: string | undefined;

  if (voice) {
    if (!sttEnabled()) {
      await sendMessage(chatId, "Ovozni matnga o'girish xizmati sozlanmagan (MOHIR_API_KEY, GROQ_API_KEY yoki OPENAI_API_KEY). Hozircha savolni matn bilan yozing.");
      return;
    }
    // STT blocking rejimi 1 daqiqagacha audioni qabul qiladi
    if (voice.duration > 60) { await sendMessage(chatId, "Ovozli xabar juda uzun — 1 daqiqagacha bo'lsin."); return; }
    await sendChatAction(chatId);
    try {
      const file = await downloadFile(voice.file_id);
      const r = await transcribe(file.bytes, { path: file.path, mime: voice.mime_type });
      question = r.text;
      transcript = r.text;
    } catch (e) {
      console.error("[telegram][stt]", e);
      await sendMessage(chatId, e instanceof SttError ? `Ovozni tushunolmadim. ${e.message}` : "Ovozni matnga o'gira olmadim — qayta urinib ko'ring.");
      return;
    }
  }

  if (!question) {
    await sendMessage(chatId, "Savolingizni ovozli xabar qilib yuboring yoki matn bilan yozing. /yordam");
    return;
  }

  await sendChatAction(chatId);
  const t0 = Date.now();
  try {
    const history = await historyFor(account.id);
    const r = await askInsofAi(question.slice(0, 1000), { history });
    console.log(`[telegram] ${r.level ? r.model : "qoida"} · asboblar: ${r.tools?.length ? r.tools.join(", ") : "—"} · ${Date.now() - t0} ms`);
    const out = render(r.answer, transcript);
    await sendMessage(chatId, out, { replyTo: msg.message_id });
    await db.telegramMessage.create({
      data: {
        accountId: account.id,
        kind: voice ? "voice" : "text",
        question: question.slice(0, 1000),
        answer: r.answer.text.slice(0, 4000),
        level: r.level,
        latencyMs: Date.now() - t0,
      },
    });
  } catch (e) {
    console.error("[telegram][answer]", e);
    await sendMessage(chatId, transcript
      ? `«${transcript}»\n\nJavob tayyorlashda xato bo'ldi — birozdan keyin qayta urinib ko'ring.`
      : "Javob tayyorlashda xato bo'ldi — birozdan keyin qayta urinib ko'ring.");
  }
}

function startText() {
  return [
    "*Insof ERP boti*",
    "",
    "Hisobingizni ulang — shundan keyin parolni tiklash kodi SMS o'rniga shu yerga keladi.",
    "",
    "*Eng osoni:* pastdagi «Telefon raqamimni yuborish» tugmasini bosing. Raqam Otdel kadrdagi kartangizdagi raqam bilan bir xil bo'lsa, hisob darhol ulanadi.",
    "",
    "Yoki ERP'ga kira olsangiz: *Tahlil → Insof AI → Telegram bot* → «Ulash kodi olish» → 6 xonali kodni shu yerga yuboring (kod 15 daqiqa amal qiladi).",
  ].join("\n");
}

/**
 * Raqam bo'yicha ulash. Telegram kontaktni o'zi tasdiqlaydi (raqam shu hisobniki),
 * shuning uchun bu SMS kodidan kam emas — lekin faqat FOYDALANUVCHINING O'Z raqami
 * qabul qilinadi: begona kontaktni uzatib yuborish mumkin, uni olsak boshqa odamning
 * hisobiga kod yuboradigan chat ochilib qolardi.
 */
async function linkByPhone(accountId: string, chatId: number, contact: TgContact, fromId?: number) {
  if (!contact.user_id || contact.user_id !== fromId) {
    await sendMessage(chatId, "Bu kontakt sizniki emas. Tugma orqali *o'z* raqamingizni yuboring.", { keyboard: "contact" });
    return;
  }
  const found = await staffByPhone(contact.phone_number);
  if (found.kind === "ambiguous") { await sendMessage(chatId, AMBIGUOUS_PHONE_ERROR, { keyboard: "remove" }); return; }
  if (found.kind === "none") {
    await sendMessage(chatId, [
      "Bu raqam bo'yicha ERP hisobi topilmadi.",
      "",
      "Sabablari: raqam Otdel kadrdagi kartangizda boshqacha yozilgan, kartangizga login berilmagan yoki hisob bloklangan. Otdel kadrga murojaat qiling.",
    ].join("\n"), { keyboard: "remove" });
    return;
  }

  await db.$transaction([
    // Shu xodimning eski chati uziladi: kod faqat oxirgi ulangan telefonga borsin
    db.telegramAccount.updateMany({ where: { userId: found.user.id, id: { not: accountId } }, data: { userId: null, linkedAt: null } }),
    db.telegramAccount.update({ where: { id: accountId }, data: { userId: found.user.id, linkedAt: new Date(), isBlocked: false } }),
  ]);

  const tail = AI_ROLES.has(found.user.role)
    ? HELP
    : `Parolni tiklash kodi endi shu yerga keladi (ERP → «Parolni tiklash»).\nTahlil savollari sizning rolingizda (${ROLE_LABELS[found.user.role]}) yopiq.`;
  await sendMessage(chatId, `*Ulandi:* ${found.fullName} (${ROLE_LABELS[found.user.role]})\n\n${tail}`, { keyboard: "remove" });
}

/**
 * Oxirgi suhbat — til modeli konteksti uchun. Javoblar qisqartiriladi: to'liq matn
 * kontekstning katta qismini egallaydi va bepul tariflarning daqiqalik token
 * limitini tez tugatadi. Mazmun uchun boshlanishi yetarli.
 */
async function historyFor(accountId: string): Promise<LlmTurn[]> {
  const rows = await db.telegramMessage.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { question: true, answer: true },
  });
  return rows.reverse().flatMap((r): LlmTurn[] => [
    { role: "user", text: r.question.slice(0, 300) },
    { role: "assistant", text: r.answer.length > 500 ? r.answer.slice(0, 500) + "…" : r.answer },
  ]);
}

/** Bir martalik kod bo'yicha chatni ERP foydalanuvchisiga bog'lash. */
async function link(accountId: string, chatId: number, code: string) {
  const row = await db.telegramLinkCode.findUnique({ where: { code }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    await sendMessage(chatId, "Kod noto'g'ri yoki muddati o'tgan. *Tahlil → Insof AI → Telegram bot* bo'limidan yangi kod oling.");
    return;
  }
  if (!row.user.isActive) { await sendMessage(chatId, "Bu foydalanuvchi bloklangan."); return; }

  await db.$transaction([
    db.telegramLinkCode.update({ where: { code }, data: { usedAt: new Date() } }),
    db.telegramAccount.update({ where: { id: accountId }, data: { userId: row.userId, linkedAt: new Date(), isBlocked: false } }),
  ]);
  await sendMessage(chatId, `*Ulandi:* ${row.user.fullName} (${ROLE_LABELS[row.user.role]})\n\n${HELP}`);
}
