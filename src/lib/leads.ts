import { db } from "./db";
import { audit } from "./audit";
import { formatPhone, normalizePhone } from "./sms/phone";
import { botEnabled, sendMessage } from "./telegram/api";
import { unitLabel } from "./unit";
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

  // Telegram — botga ulangan xodimlarga; push — ilovadagi hammaga. Ikkalasi bir-birini
  // takrorlamaydi: sotuvchi qaysi biri qo'lida bo'lsa, o'shanda ko'radi.
  await notifySales({ ...lead, qty: lead.qty ? Number(lead.qty) : null });
  notifyAfter(() => notifyRoles(["SALES", "DIRECTOR"], {
    type: "LEAD_NEW",
    title: "Saytdan yangi so'rov",
    body: `${lead.name} · ${lead.phone}${lead.product ? ` · ${lead.product.name}` : ""}`,
    link: { key: "leads", id: lead.id },
  }));
  return { ok: true };
}

/** Yangi ariza haqida sotuv bo'limi va direktorga Telegram xabari — bot ulangan bo'lsa. */
async function notifySales(lead: {
  name: string; phone: string; qty: number | null; address: string | null; message: string | null;
  product: { name: string; unit: string } | null;
}) {
  if (!botEnabled()) return;
  try {
    const chats = await db.telegramAccount.findMany({
      where: { isBlocked: false, userId: { not: null }, user: { isActive: true, role: { in: ["SALES", "DIRECTOR"] } } },
      select: { chatId: true },
    });
    if (chats.length === 0) return;
    const text = [
      "*Saytdan yangi ariza*",
      `Ism: ${lead.name}`,
      `Telefon: ${formatPhone(lead.phone)}`,
      lead.product ? `Mahsulot: ${lead.product.name}${lead.qty ? ` — ${lead.qty} ${unitLabel(lead.product.unit)}` : ""}` : null,
      lead.address ? `Manzil: ${lead.address}` : null,
      lead.message ? `Izoh: ${lead.message}` : null,
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

  if (inn) {
    const busy = await db.customer.findUnique({ where: { inn } });
    if (busy && busy.name !== name) return { ok: false, error: `Bu INN allaqachon "${busy.name}" mijozida` };
  }

  const existing = await db.customer.findFirst({ where: { phone: lead.phone } });
  const customer = existing
    ? existing
    : await db.customer.create({ data: { name, phone: lead.phone, inn, address: lead.address } });

  const after = await db.lead.update({
    where: { id: leadId },
    data: { status: "CONVERTED", customerId: customer.id, handledById: userId, handledAt: new Date() },
  });
  await audit(db, userId, "STATUS_CHANGE", "Lead", leadId, lead, after);
  if (!existing) await audit(db, userId, "CREATE", "Customer", customer.id, undefined, customer);
  return { ok: true, note: existing ? `Mavjud mijozga bog'landi: ${existing.name} (${formatPhone(lead.phone)})` : "Mijoz yaratildi" };
}
