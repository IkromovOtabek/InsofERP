import { db } from "@/lib/db";
import { botEnabled, sendMessage } from "@/lib/telegram/api";
import { publicOrigin } from "@/lib/public-url";
import type { Role } from "@/generated/prisma";
import { runChecks, tashkentDay, type Check } from "./checks";

/**
 * Kunlik Nazorat hisoboti Telegram'ga: direktorga — to'liq (qizil va sariq bandlar + ma'lumot), mas'ul rollar
 * xodimlariga — faqat o'z bandlari (`controlNotifyOwners`). Faqat bot ulangan (`TelegramAccount`) faol xodimlarga.
 * Avtomatik hisobot bir kunda bir marta: avval `ControlReport` (kun unique) yoziladi — ikkinchi jarayon yoki qayta
 * ishga tushish takror yubormaydi. «Hozir yuborish» (`manual`) — darhol yuboradi; kechki avtomatik hisobot keyin ham bir marta ketadi.
 */
const TZ = 5 * 3_600_000;
const dateLabel = (d: Date) => { const x = new Date(d.getTime() + TZ); return `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}.${x.getUTCFullYear()}`; };
const line = (c: Check) => `${c.no}. ${c.title} — ${c.value}${c.detail ? ` (${c.detail})` : ""}\n   Mas'ul: ${c.owner}. ${c.action}`;

/** Direktor uchun to'liq matn. */
export function directorText(checks: Check[], day: Date, link: string): string {
  const crit = checks.filter((c) => c.status === "crit"), warn = checks.filter((c) => c.status === "warn");
  const ok = checks.filter((c) => c.status === "ok").length, info = checks.filter((c) => c.status === "info");
  const parts = [
    `Insof ERP · Nazorat ${dateLabel(day)}`,
    `Shoshilinch: ${crit.length} · Tekshirish kerak: ${warn.length} · Joyida: ${ok}`,
  ];
  if (crit.length) parts.push("", "SHOSHILINCH", ...crit.map(line));
  if (warn.length) parts.push("", "TEKSHIRISH KERAK", ...warn.map(line));
  if (!crit.length && !warn.length) parts.push("", "Hammasi joyida.");
  if (info.length) parts.push("", ...info.map((c) => `${c.title}: ${c.value}`));
  parts.push("", `Batafsil: ${link}`);
  return parts.join("\n");
}

/** Mas'ul xodim uchun — faqat uning rolidagi qizil/sariq bandlar (bo'lmasa — null, xabar yuborilmaydi). */
export function ownerText(checks: Check[], role: Role, day: Date): string | null {
  const mine = checks.filter((c) => (c.status === "crit" || c.status === "warn") && c.roles.includes(role));
  if (!mine.length) return null;
  return [`Insof ERP · Nazorat ${dateLabel(day)} — sizga tegishli`, "", ...mine.map((c) => `${c.no}. ${c.title} — ${c.value}${c.detail ? ` (${c.detail})` : ""}\n   ${c.action}`)].join("\n");
}

export type Outgoing = { userId: string; chatId: string; text: string; director: boolean };

/** Kimga nima ketadi — yuborishdan oldin (test va «Ko'rib chiqish» ham shundan). */
export async function planReport(checks: Check[], day: Date): Promise<Outgoing[]> {
  const [settings, accounts, origin] = await Promise.all([
    db.companySettings.findUnique({ where: { id: "main" }, select: { controlNotifyOwners: true } }),
    db.telegramAccount.findMany({ where: { isBlocked: false, userId: { not: null }, user: { isActive: true } }, select: { chatId: true, userId: true, user: { select: { role: true } } }, orderBy: { linkedAt: "desc" } }),
    publicOrigin().catch(() => ({ origin: "" })),
  ]);
  const link = `${origin.origin}/dashboard?view=nazorat`;
  const full = directorText(checks, day, link);
  const seen = new Set<string>();
  const out: Outgoing[] = [];
  for (const a of accounts) {
    if (!a.userId || !a.user || seen.has(a.userId)) continue; // xodimning eng oxirgi ulangan chati
    seen.add(a.userId);
    if (a.user.role === "DIRECTOR") out.push({ userId: a.userId, chatId: a.chatId, text: full, director: true });
    else if (settings?.controlNotifyOwners !== false) {
      const t = ownerText(checks, a.user.role, day);
      if (t) out.push({ userId: a.userId, chatId: a.chatId, text: t, director: false });
    }
  }
  return out;
}

export type SendResult = { sent: number; planned: number; skipped?: "ALREADY_SENT" | "DISABLED"; noBot?: boolean };

export async function sendControlReport(opts: { manual?: boolean; now?: Date } = {}): Promise<SendResult> {
  const now = opts.now ?? new Date();
  const day = tashkentDay(now);
  const settings = await db.companySettings.findUnique({ where: { id: "main" }, select: { controlReportEnabled: true } });
  if (!opts.manual && settings?.controlReportEnabled === false) return { sent: 0, planned: 0, skipped: "DISABLED" };
  const checks = await runChecks({ now });
  const summary = {
    crit: checks.filter((c) => c.status === "crit").map((c) => c.no),
    warn: checks.filter((c) => c.status === "warn").map((c) => c.no),
    ok: checks.filter((c) => c.status === "ok").length,
  };
  // Avval qayd — ikkinchi jarayon / qayta ishga tushish shu kunni takror yubormasin
  if (opts.manual) {
    // Avtomatik yuborilgan kun belgisi (manual = false) saqlanadi — aks holda kechki hisobot qayta ketardi
    await db.controlReport.upsert({ where: { day }, update: { sentAt: now, summary }, create: { day, summary, manual: true, sentAt: now } });
  } else {
    try {
      await db.controlReport.create({ data: { day, summary, sentAt: now } });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      // Kun ichida faqat qo'lda yuborilgan bo'lsa — kechki avtomatik hisobot baribir bir marta ketadi
      // (shartli yangilash: bir nechta jarayondan faqat bittasi o'tadi)
      const u = await db.controlReport.updateMany({ where: { day, manual: true }, data: { manual: false, sentAt: now, summary } });
      if (!u.count) return { sent: 0, planned: 0, skipped: "ALREADY_SENT" };
    }
  }
  const plan = await planReport(checks, day);
  if (!botEnabled()) return { sent: 0, planned: plan.length, noBot: true };
  let sent = 0;
  for (const o of plan) {
    try {
      await sendMessage(o.chatId, o.text);
      sent++;
    } catch (e) {
      console.error("[nazorat] yuborilmadi", o.userId, e);
    }
  }
  await db.controlReport.update({ where: { day }, data: { recipients: sent } });
  return { sent, planned: plan.length };
}
