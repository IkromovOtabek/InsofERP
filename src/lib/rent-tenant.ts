import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { getCompany } from "./company";
import { fmtNum } from "./format";
import { formatPhone } from "./phone";
import { notifyRoles } from "./notify";
import { botEnabled, botUsername, sendMessage } from "./telegram/api";
import { RENT_PAID, chargeDue, currentLeases, currentMonth, monthKey, monthLabel } from "./rent";
import { leaseElecDebts } from "./rent-elec";

/**
 * Arenda — ijarachi (do'kon) kartasi, qarzdorlar va qarz eslatmasi.
 *
 *  · Qarz — shartnoma (ijarachi) bo'yicha: barcha oylar hisobi (`RentCharge` bankDue + cashDue + undiriladigan svet) −
 *    shu shartnomaga tushgan kirimlar (bekor qilinmagan). Ijarachi almashsa eskisining qarzi «sobiq ijarachi» bo'lib qoladi.
 *    Oy bo'yicha qoldiq — shu oy hisobi − shu oy uchun kirim (oy varag'idagidek); ortiqcha to'lov avans bo'lib
 *    umumiy qarzni kamaytiradi.
 *  · Telegram: ijarachi botga `t.me/<bot>?start=ijara_<kalit>` (QR) orqali ulanadi — kalit do'kon kartasida.
 *    Bot faqat ulangan chatga yoza oladi; ulanmagan ijarachiga sekretar tayyor matnni o'zi yuboradi.
 *  · Avtomatik eslatma: har oyning `CompanySettings.rentRemindDay` sanasidan boshlab (08–21 oralig'ida), qarzi bor va
 *    ulangan ijarachiga oyda bir marta (`RentReminder.auto`). Sekretarga oyda bir marta xulosa bildirishnomasi.
 */

const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
/** 1 so'mdan kam farq — yaxlitlash qoldig'i, qarz emas. */
const EPS = 1;

export type LedgerMonth = { month: Date; key: string; label: string; bankDue: number; cashDue: number; due: number; paid: number; left: number; note: string | null };

/**
 * Shartnomaning oyma-oy hisobi (yangi oy tepada) va jami qarz. `leaseId` berilmasa — do'konning joriy shartnomasi
 * (amaldagisi, bo'lmasa oxirgisi). Shartnoma yo'q (hali ijaraga berilmagan joy) — bo'sh hisob.
 */
export async function shopLedger(shopId: string, leaseId?: string | null) {
  const lid = leaseId ?? (await currentLeases([shopId])).get(shopId)?.id ?? null;
  const [charges, paid] = lid ? await Promise.all([
    db.rentCharge.findMany({ where: { leaseId: lid }, orderBy: { month: "desc" } }),
    db.rentTx.groupBy({ by: ["month"], where: { ...RENT_PAID, leaseId: lid }, _sum: { amount: true } }),
  ]) : [[], []];
  const paidBy = new Map(paid.filter((p) => p.month).map((p) => [monthKey(p.month!), n(p._sum.amount)]));
  const months: LedgerMonth[] = charges.map((c) => {
    const key = monthKey(c.month), bankDue = n(c.bankDue), cashDue = n(c.cashDue), due = chargeDue(c), p = paidBy.get(key) ?? 0;
    paidBy.delete(key);
    return { month: c.month, key, label: monthLabel(c.month), bankDue, cashDue, due, paid: p, left: r2(due - p), note: c.note };
  });
  // Hisobi ochilmagan oy uchun tushgan pul ham ko'rinsin (avans)
  for (const [key, p] of paidBy) {
    const [y, m] = key.split("-").map(Number);
    const month = new Date(Date.UTC(y, m - 1, 1));
    months.push({ month, key, label: monthLabel(month), bankDue: 0, cashDue: 0, due: 0, paid: p, left: r2(-p), note: null });
  }
  months.sort((a, b) => b.month.getTime() - a.month.getTime());
  const due = months.reduce((s, m) => s + m.due, 0), paidAll = months.reduce((s, m) => s + m.paid, 0);
  const elecDebt = lid ? (await leaseElecDebts([lid])).get(lid) ?? 0 : 0;
  return { leaseId: lid, months, due: r2(due), paid: r2(paidAll), debt: r2(due - paidAll), elecDebt, unpaid: months.filter((m) => m.left > EPS) };
}

export type Debtor = {
  /** Do'kon id (karta havolasi) */
  id: string; leaseId: string; name: string; location: string; tenantName: string | null; phone: string | null; isActive: boolean; linked: boolean;
  /** Sobiq ijarachi: shartnomasi yopilgan, qarzi qolgan (Telegram eslatmasi ketmaydi) */
  former: boolean; endedAt: Date | null;
  debt: number; unpaid: { key: string; label: string; left: number }[]; lastPaidAt: Date | null; lastReminder: { at: Date; ok: boolean } | null;
  /** Svet qarzi (ijara qarzidan alohida) */
  elecDebt: number;
};

/** Qarzi bor ijarachilar — shartnoma bo'yicha (sobiq ijarachilar ham), jami qarz bo'yicha kamayish tartibida. */
export async function rentDebtors(): Promise<Debtor[]> {
  const [leases, charges, paid, lastPay, lastRem] = await Promise.all([
    db.rentLease.findMany({ include: { shop: true } }),
    db.rentCharge.findMany({ select: { leaseId: true, month: true, bankDue: true, cashDue: true } }),
    db.rentTx.groupBy({ by: ["leaseId", "month"], where: { ...RENT_PAID, leaseId: { not: null } }, _sum: { amount: true } }),
    db.rentTx.groupBy({ by: ["leaseId"], where: { type: "INCOME", cancelledAt: null, leaseId: { not: null } }, _max: { date: true } }),
    db.rentReminder.findMany({ orderBy: { createdAt: "desc" }, distinct: ["shopId"], select: { shopId: true, createdAt: true, ok: true } }),
  ]);
  const paidBy = new Map(paid.map((p) => [`${p.leaseId}|${p.month ? monthKey(p.month) : ""}`, n(p._sum.amount)]));
  const paidTotal = new Map<string, number>();
  for (const p of paid) paidTotal.set(p.leaseId!, (paidTotal.get(p.leaseId!) ?? 0) + n(p._sum.amount));
  const byLease = new Map<string, { key: string; label: string; month: Date; left: number }[]>();
  const dueTotal = new Map<string, number>();
  for (const c of charges) {
    const due = chargeDue(c), key = monthKey(c.month);
    dueTotal.set(c.leaseId, (dueTotal.get(c.leaseId) ?? 0) + due);
    const left = r2(due - (paidBy.get(`${c.leaseId}|${key}`) ?? 0));
    if (left > EPS) (byLease.get(c.leaseId) ?? byLease.set(c.leaseId, []).get(c.leaseId)!).push({ key, label: monthLabel(c.month), month: c.month, left });
  }
  const lastPayBy = new Map(lastPay.map((x) => [x.leaseId!, x._max.date]));
  const remBy = new Map(lastRem.map((x) => [x.shopId, { at: x.createdAt, ok: x.ok }]));
  const elec = await leaseElecDebts();
  return leases
    .sort((a, b) => a.shop.sortOrder - b.shop.sortOrder || a.shop.createdAt.getTime() - b.shop.createdAt.getTime())
    .map((l) => {
      const former = l.status !== "ACTIVE";
      return {
        id: l.shopId, leaseId: l.id, name: l.shop.name, location: l.shop.location,
        tenantName: l.tenantName, phone: l.phone, isActive: l.shop.isActive, linked: !former && !!l.shop.tgChatId,
        former, endedAt: l.endedAt,
        debt: r2((dueTotal.get(l.id) ?? 0) - (paidTotal.get(l.id) ?? 0)),
        elecDebt: elec.get(l.id) ?? 0,
        unpaid: (byLease.get(l.id) ?? []).sort((a, b) => a.month.getTime() - b.month.getTime()).map(({ key, label, left }) => ({ key, label, left })),
        lastPaidAt: lastPayBy.get(l.id) ?? null, lastReminder: former ? null : remBy.get(l.shopId) ?? null,
      };
    })
    .filter((d) => d.debt > EPS || d.elecDebt > EPS)
    .sort((a, b) => Number(a.former) - Number(b.former) || b.debt + Math.max(0, b.elecDebt) - a.debt - Math.max(0, a.elecDebt));
}

/** Eslatma matni — Telegram'ga ham, sekretar nusxa olib yuborishi uchun ham (oddiy matn, belgilarsiz). */
export async function reminderText(shop: { name: string; location: string; tenantName: string | null }, ledger: { debt: number; unpaid: { label: string; left: number }[]; elecDebt?: number }) {
  const c = await getCompany();
  const phones = [c.phone, c.phone2].filter(Boolean).map((p) => formatPhone(p!));
  return [
    `Assalomu alaykum${shop.tenantName ? `, ${shop.tenantName}` : ""}!`,
    "",
    `${c.legalName ?? c.name} — ijara to'lovi bo'yicha eslatma.`,
    "",
    `Do'kon: ${shop.name} (${shop.location})`,
    ...(ledger.unpaid.length ? ["To'lanmagan oylar:", ...ledger.unpaid.slice(-6).map((m) => `• ${m.label}: ${fmtNum(m.left)} so'm`)] : []),
    ...(ledger.debt > EPS ? [`Ijara qarzi: ${fmtNum(ledger.debt)} so'm`] : []),
    ...((ledger.elecDebt ?? 0) > EPS ? [`Svet qarzi: ${fmtNum(ledger.elecDebt!)} so'm`] : []),
    "",
    "Iltimos, to'lovni imkon qadar tezroq amalga oshiring. To'lagan bo'lsangiz — bu xabarga e'tibor bermang.",
    ...(phones.length ? ["", `Savollar uchun: ${phones.join(", ")}`] : []),
  ].join("\n");
}

export type SendResult = { ok: true } | { ok: false; error: string };

/** Bitta ijarachiga eslatma: qarz bo'lsa va Telegram ulangan bo'lsa yuboriladi; har urinish jurnalga yoziladi. */
export async function sendRentReminder(shopId: string, opts: { auto: boolean; userId?: string }): Promise<SendResult> {
  const shop = await db.rentShop.findUnique({ where: { id: shopId } });
  if (!shop) return { ok: false, error: "Do'kon topilmadi" };
  const ledger = await shopLedger(shopId);
  if (ledger.debt <= EPS && ledger.elecDebt <= EPS) return { ok: false, error: "Bu ijarachining qarzi yo'q" };
  if (!shop.tgChatId) return { ok: false, error: "Ijarachi Telegram botga ulanmagan — matnni nusxalab o'zingiz yuboring" };
  if (!botEnabled()) return { ok: false, error: "Telegram bot sozlanmagan (TELEGRAM_BOT_TOKEN)" };
  let error: string | null = null;
  try {
    await sendMessage(shop.tgChatId, await reminderText(shop, ledger), { markdown: false });
  } catch (e) {
    // Ijarachi botni bloklagan bo'lsa (403) — chat uziladi, keyingi safar sekretar qayta ulaydi
    error = e instanceof Error ? e.message : String(e);
    if (/\b403\b|blocked|deactivated|chat not found/i.test(error)) {
      await db.rentShop.updateMany({ where: { id: shopId, tgChatId: shop.tgChatId }, data: { tgChatId: null, tgLinkedAt: null } });
      error = "Ijarachi botni bloklagan yoki chat topilmadi — Telegram uzildi, qayta ulash kerak";
    }
  }
  await db.rentReminder.create({ data: { shopId, month: currentMonth(), auto: opts.auto, debt: r2(Math.max(0, ledger.debt) + Math.max(0, ledger.elecDebt)), ok: !error, error, sentById: opts.userId ?? null } });
  return error ? { ok: false, error } : { ok: true };
}

/**
 * Avtomatik eslatmalar (`lib/reminders.ts` aylanishidan, har 30 daqiqada): eslatma kuni kelgan bo'lsa — shu oy hali
 * avtomatik eslatma olmagan, qarzi bor va ulangan ijarachilarga. Sekretarga — oyda bir marta xulosa.
 */
export async function runRentReminders(now = new Date()): Promise<number> {
  const day = (await getCompany()).rentRemindDay;
  if (!day || now.getDate() < day) return 0;
  const month = currentMonth();
  const debtors = await rentDebtors();
  if (!debtors.length) return 0;
  const done = new Set((await db.rentReminder.findMany({ where: { month, auto: true }, select: { shopId: true } })).map((r) => r.shopId));
  let sent = 0, failed = 0;
  const due = debtors.filter((d) => d.linked && !d.former && d.isActive && !done.has(d.id));
  if (botEnabled()) {
    for (const d of due) {
      const r = await sendRentReminder(d.id, { auto: true });
      if (r.ok) sent++; else failed++;
    }
  }
  // Sekretarga xulosa — oyda bir marta (shu oy shu turdagi bildirishnoma bo'lmasa)
  const already = await db.notification.findFirst({ where: { type: "RENT_DEBT_SUMMARY", createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } }, select: { id: true } });
  if (!already) {
    const total = debtors.reduce((s, d) => s + d.debt, 0);
    const notLinked = debtors.filter((d) => !d.linked && !d.former).length;
    await notifyRoles(["SECRETARY"], {
      type: "RENT_DEBT_SUMMARY",
      title: `Arenda qarzdorlari — ${monthLabel(month)}`,
      body: `${debtors.length} ta ijarachi, jami qarz ${fmtNum(total)} so'm. Telegram eslatma: ${sent} ta yuborildi${failed ? `, ${failed} tasi yetib bormadi` : ""}${notLinked ? `; ${notLinked} tasi botga ulanmagan — ularga o'zingiz yuboring` : ""}.`,
      channel: "oddiy",
    });
  }
  return sent;
}

/* ───────────────────────── Telegram ulash ───────────────────────── */

/** Do'kon uchun ulash havolasi (kalit bo'lmasa yaratiladi). Bot sozlanmagan bo'lsa — null. */
export async function shopLinkUrl(shopId: string, userId: string): Promise<string | null> {
  const name = await botUsername();
  if (!name) return null;
  let shop = await db.rentShop.findUniqueOrThrow({ where: { id: shopId }, select: { tgLinkToken: true } });
  if (!shop.tgLinkToken) {
    const token = randomBytes(12).toString("base64url");
    await db.rentShop.updateMany({ where: { id: shopId, tgLinkToken: null }, data: { tgLinkToken: token } });
    shop = await db.rentShop.findUniqueOrThrow({ where: { id: shopId }, select: { tgLinkToken: true } });
    await audit(db, userId, "UPDATE", "RentShop", shopId, undefined, { tgLinkToken: "yaratildi" });
  }
  return `https://t.me/${name}?start=ijara_${shop.tgLinkToken}`;
}

/** Sekretar ijarachi chatini uzadi; kalit yangilanadi — eski QR endi ishlamaydi. */
export async function unlinkShopTelegram(shopId: string, userId: string) {
  const before = await db.rentShop.findUnique({ where: { id: shopId }, select: { tgChatId: true } });
  await db.rentShop.update({ where: { id: shopId }, data: { tgChatId: null, tgLinkedAt: null, tgLinkToken: randomBytes(12).toString("base64url") } });
  await audit(db, userId, "UPDATE", "RentShop", shopId, { tgChatId: before?.tgChatId ?? null }, { tgChatId: null });
}

/**
 * Bot oqimi (`lib/telegram/bot.ts`, xodim oqimidan oldin): `/start ijara_<kalit>` — chat do'konga ulanadi;
 * ulangan ijarachi (xodim emas) botga yozsa — qarzi haqida qisqa javob. `true` — xabar shu oqimga tegishli edi.
 */
export async function rentBotMessage(text: string, chatId: number): Promise<boolean> {
  const start = text.match(/^\/start\s+ijara_([A-Za-z0-9_-]{8,64})$/);
  if (start) {
    const shop = await db.rentShop.findUnique({ where: { tgLinkToken: start[1] } });
    if (!shop) { await sendMessage(chatId, "Havola eskirgan yoki noto'g'ri. Sekretardan yangi QR kodni so'rang.", { markdown: false }); return true; }
    await db.rentShop.update({ where: { id: shop.id }, data: { tgChatId: String(chatId), tgLinkedAt: new Date() } });
    const ledger = await shopLedger(shop.id);
    await sendMessage(chatId, [
      `Siz «${shop.name}» (${shop.location}) ijarachisi sifatida ulandingiz.`,
      "",
      "Ijara to'lovi eslatmalari va qarz haqidagi ma'lumot endi shu yerga keladi.",
      ledger.debt > EPS ? `Hozirgi ijara qarzi: ${fmtNum(ledger.debt)} so'm.` : "Hozircha ijara qarzingiz yo'q.",
      ...(ledger.elecDebt > EPS ? [`Svet qarzi: ${fmtNum(ledger.elecDebt)} so'm.`] : []),
      "",
      "Qarzni istalgan payt bilish uchun shu chatga «qarz» deb yozing.",
    ].join("\n"), { markdown: false, keyboard: "remove" });
    return true;
  }
  // Ulangan ijarachi yozdi (lekin bu chat xodim hisobiga ulanmagan) — qarz holati
  const shops = await db.rentShop.findMany({ where: { tgChatId: String(chatId) } });
  if (!shops.length) return false;
  const staff = await db.telegramAccount.findFirst({ where: { chatId: String(chatId), userId: { not: null } }, select: { id: true } });
  if (staff) return false;
  const lines: string[] = [];
  for (const s of shops) {
    const l = await shopLedger(s.id);
    lines.push(`${s.name} (${s.location}): ${l.debt > EPS ? `ijara qarzi ${fmtNum(l.debt)} so'm` : "ijara qarzi yo'q"}${l.elecDebt > EPS ? `, svet qarzi ${fmtNum(l.elecDebt)} so'm` : ""}`);
  }
  const c = await getCompany();
  const phones = [c.phone, c.phone2].filter(Boolean).map((p) => formatPhone(p!));
  await sendMessage(chatId, [...lines, ...(phones.length ? ["", `Savollar uchun: ${phones.join(", ")}`] : [])].join("\n"), { markdown: false });
  return true;
}
