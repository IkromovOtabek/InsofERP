import { db } from "./db";
import { audit } from "./audit";
import { formatPhone, normalizePhone } from "./sms/phone";
import { botEnabled, sendMessage } from "./telegram/api";
import { unitLabel } from "./unit";
import { phoneTail, samePhone } from "./phone-lookup";
import { syncCustomerLater } from "./eco/customers";
import { notifyAfter, notifyRoles } from "@/lib/notify";

/**
 * Saytdan tushgan ariza (`Lead`). Qoida shu yerda — server action ham,
 * keyinchalik Telegram bot yoki mobil ilova ham shu funksiyani chaqiradi.
 */

/** Bitta raqamdan shu muddat ichida bitta ariza — forma ketma-ket bosilsa takror yozilmaydi. */
const THROTTLE_MS = 2 * 60_000;

export type NewLead = {
  name: string;
  phone: string;
  productId?: string | null;
  qty?: number | null;
  address?: string | null;
  message?: string | null;
  source?: string;
};

export type LeadResult = { ok: true; duplicate?: boolean } | { ok: false; error: string };

export async function createLead(input: NewLead): Promise<LeadResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri. Masalan: 90 123 45 67" };

  const recent = await db.lead.findFirst({
    where: { phone, createdAt: { gt: new Date(Date.now() - THROTTLE_MS) } },
    select: { id: true },
  });
  if (recent) return { ok: true, duplicate: true };

  const lead = await db.lead.create({
    data: {
      name: input.name,
      phone,
      productId: input.productId ?? null,
      qty: input.qty ?? null,
      address: input.address ?? null,
      message: input.message ?? null,
      source: input.source ?? "landing",
    },
    include: { product: { select: { name: true, unit: true } } },
  });

  // Telegram — botga ulangan sotuvchilarga; push — ilovadagi sotuvchilarga. Ikkalasi bir-birini
  // takrorlamaydi: sotuvchi qaysi biri qo'lida bo'lsa, o'shanda ko'radi.
  // Direktorga ketmaydi: ariza bilan bog'lanish sotuvning ishi, direktor natijani hisobotda ko'radi.
  // Javobdan keyin: Telegram sekin bo'lsa mehmonning formasi kutib qolmasin (u qayta yuborib dublikat qilardi)
  const forSales = { ...lead, qty: lead.qty ? Number(lead.qty) : null };
  notifyAfter(() => notifySales(forSales));
  notifyAfter(() => notifyRoles(["SALES"], {
    type: "LEAD_NEW",
    title: "Saytdan yangi so'rov",
    body: `${lead.name} · ${lead.phone}${lead.product ? ` · ${lead.product.name}` : ""}`,
    link: { key: "leads", id: lead.id },
  }));
  return { ok: true };
}

/** Yangi ariza haqida sotuv bo'limiga Telegram xabari — bot ulangan bo'lsa. */
async function notifySales(lead: {
  name: string; phone: string; qty: number | null; address: string | null; message: string | null;
  product: { name: string; unit: string } | null;
}) {
  if (!botEnabled()) return;
  try {
    const chats = await db.telegramAccount.findMany({
      where: { isBlocked: false, userId: { not: null }, user: { isActive: true, role: "SALES" } },
      select: { chatId: true },
    });
    if (chats.length === 0) return;
    // Mehmon yozgan matn Markdown sifatida o'qilmasin: `[bosing](http://…)` xodim chatida
    // haqiqiy havola bo'lib chiqardi (fishing). Belgilar olib tashlanadi, matn o'zi qoladi.
    const plain = (v: string) => v.replace(/[_*[\]()`~>#|]/g, " ").replace(/\s{2,}/g, " ").trim();
    const text = [
      "*Saytdan yangi ariza*",
      `Ism: ${plain(lead.name)}`,
      `Telefon: ${formatPhone(lead.phone)}`,
      lead.product ? `Mahsulot: ${lead.product.name}${lead.qty ? ` — ${lead.qty} ${unitLabel(lead.product.unit)}` : ""}` : null,
      lead.address ? `Manzil: ${plain(lead.address)}` : null,
      lead.message ? `Izoh: ${plain(lead.message)}` : null,
    ].filter(Boolean).join("\n");
    await Promise.all(chats.map((c) => sendMessage(c.chatId, text, { markdown: true })));
  } catch {
    // Xabar ketmasa ham ariza bazada qoldi — sotuv uni `/leads` sahifasida ko'radi.
  }
}

// ───────────────────────── Sotuvchining ishlovi ─────────────────────────
// Veb (`app/(app)/leads/actions.ts`) ham, mobil ilova (`lib/mobile/actions.ts`) ham shu
// funksiyalarni chaqiradi — holat o'tishi va mijozga aylantirish qoidasi bitta joyda.

export type LeadActionResult = { ok: true; note?: string } | { ok: false; error: string };

/** Holatni almashtirish (bog'landim / bekor / yana yangi). Kim ko'targani ham yoziladi. */
export async function setLeadStatus(leadId: string, status: "NEW" | "IN_PROGRESS" | "REJECTED", userId: string): Promise<LeadActionResult> {
  const before = await db.lead.findUnique({ where: { id: leadId } });
  if (!before) return { ok: false, error: "Ariza topilmadi" };
  if (before.status === "CONVERTED") return { ok: false, error: "Bu ariza mijozga aylantirilgan — holati o'zgarmaydi" };
  const after = await db.lead.update({ where: { id: leadId }, data: { status, handledById: userId, handledAt: new Date() } });
  await audit(db, userId, "STATUS_CHANGE", "Lead", leadId, before, after);
  return { ok: true };
}

/** Sotuvchining ichki izohi. */
export async function saveLeadNote(leadId: string, note: string | null): Promise<LeadActionResult> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) return { ok: false, error: "Ariza topilmadi" };
  await db.lead.update({ where: { id: leadId }, data: { note: note?.trim() || null } });
  return { ok: true };
}

/**
 * Arizani mijozga aylantirish. Shu raqamli mijoz allaqachon bo'lsa — yangisini
 * yaratmaymiz, borini bog'laymiz (bir mijoz ikki marta ariza qoldirishi normal).
 */
export async function convertLead(leadId: string, input: { name: string; inn?: string | null }, userId: string): Promise<LeadActionResult> {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Mijoz nomi to'liq yozilsin" };
  const inn = input.inn?.trim() || null;
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false, error: "Ariza topilmadi" };
  if (lead.status === "CONVERTED") return { ok: false, error: "Bu ariza allaqachon mijozga aylantirilgan" };

  // INN bo'yicha mavjud mijoz: nomi boshqa bo'lsa — xato; bir xil bo'lsa — o'shanga bog'lanadi
  // (ilgari davom etib, create unique-INN xatosi bilan yiqilardi)
  const byInn = inn ? await db.customer.findUnique({ where: { inn } }) : null;
  if (byInn && byInn.name !== name) return { ok: false, error: `Bu INN allaqachon "${byInn.name}" mijozida` };

  // Telefon bazada erkin ko'rinishda — normallashtirib solishtiriladi (qaytgan mijoz dublikat bo'lmasin)
  const candidates = byInn ? [] : await db.customer.findMany({
    where: { isInternal: false, phone: { contains: phoneTail(lead.phone) } },
    orderBy: { createdAt: "asc" },
  });
  const byPhone = candidates.find((c) => samePhone(c.phone, lead.phone)) ?? null;

  const res = await db.$transaction(async (tx) => {
    // Ikki marta bosilsa ikkinchisi hech narsa qilmaydi
    const claimed = await tx.lead.updateMany({ where: { id: leadId, status: { not: "CONVERTED" } }, data: { status: "CONVERTED", handledById: userId, handledAt: new Date() } });
    if (claimed.count !== 1) return null;
    const existing = byInn ?? byPhone;
    const customer = existing ?? await tx.customer.create({ data: { name, phone: lead.phone, inn, address: lead.address } });
    const after = await tx.lead.update({ where: { id: leadId }, data: { customerId: customer.id } });
    await audit(tx, userId, "STATUS_CHANGE", "Lead", leadId, lead, after);
    if (!existing) await audit(tx, userId, "CREATE", "Customer", customer.id, undefined, customer);
    return { customer, existing };
  });
  if (!res) return { ok: false, error: "Bu ariza allaqachon mijozga aylantirilgan" };
  // Yangi mijoz ilovaga ham ketsin — telefoni ECO'da bo'lsa hisobi avtomatik ulanadi
  if (!res.existing) syncCustomerLater(res.customer.id);
  return { ok: true, note: res.existing ? `Mavjud mijozga bog'landi: ${res.existing.name} (${formatPhone(lead.phone)})` : "Mijoz yaratildi" };
}
