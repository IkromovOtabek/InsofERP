import { db } from "./db";
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
      "🔔 *Saytdan yangi ariza*",
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
