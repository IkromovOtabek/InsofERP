import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { defaultCreditLimit } from "@/lib/finance";
import { normalizePhone } from "@/lib/phone";
import { refreshClient } from "./contacts";
import { defaultNext, isoToDb, todayIso } from "./dates";
import { findDuplicates } from "./clients";
import { createClient } from "./import/apply";

/**
 * INSOF realizator boti (Telegram, `github.com/sarvarmirzakarimoff-max/INSOF-realizator-bot`) → Sotuv CRM.
 *   «🏗 Yangi obyekt»     — CRM mijozi (manba «Realizator (ko'chada)»), keyingi aloqa — bugun: operator shu kuni qo'ng'iroq qiladi;
 *   «💼 Tijorat taklifi»  — aloqa «Taklif yuborildi» (narxi bilan), keyingi aloqa natija standartidan.
 * Mijoz telefon bo'yicha topiladi (bo'lmasa ochiladi). Takror yuborilgan voqea (`ref`) ikkinchi aloqa ochmaydi.
 * Realizatorning Telegram'i ERP hisobiga ulangan bo'lsa (`TelegramAccount`) aloqa uning nomidan, aks holda tizim foydalanuvchisidan.
 */

export const realizatorSchema = z.object({
  event: z.enum(["obyekt", "taklif"]),
  ref: z.string().trim().min(1).max(80),
  realizator: z.object({ tg_id: z.union([z.number(), z.string()]).transform(String), name: z.string().trim().max(120).optional().default("") }),
  mijoz: z.object({
    nomi: z.string().trim().max(200).optional().nullable(),
    tel: z.string().trim().max(40).optional().nullable(),
    prorab: z.string().trim().max(120).optional().nullable(),
    prorab_tel: z.string().trim().max(40).optional().nullable(),
    manzil: z.string().trim().max(300).optional().nullable(),
    lat: z.number().optional().nullable(),
    lon: z.number().optional().nullable(),
  }),
  ehtiyojlar: z.array(z.string().max(80)).max(30).optional().default([]),
  taklif: z.object({
    raqam: z.string().max(20).optional().nullable(),
    tur: z.string().max(40).optional().nullable(),
    jami: z.number().nonnegative().max(1e14).optional().nullable(),
    masofa_km: z.number().nonnegative().max(10_000).optional().nullable(),
    mahsulotlar: z.string().max(1000).optional().nullable(),
  }).optional().nullable(),
  izoh: z.string().max(2000).optional().nullable(),
});
export type RealizatorEvent = z.infer<typeof realizatorSchema>;

export const BOT_LOGIN = "realizator-bot";

/** Bot nomidan yoziladigan tizim foydalanuvchisi (tizimga kira olmaydi) */
async function botUserId(): Promise<string> {
  const u = await db.user.findUnique({ where: { login: BOT_LOGIN }, select: { id: true } });
  if (u) return u.id;
  try {
    return (await db.user.create({
      data: { login: BOT_LOGIN, fullName: "Realizator boti", role: "SALES", isActive: false, passwordHash: await hashPassword(randomBytes(24).toString("hex")) },
      select: { id: true },
    })).id;
  } catch {
    return (await db.user.findUniqueOrThrow({ where: { login: BOT_LOGIN }, select: { id: true } })).id;
  }
}

const opt = (kind: "SOURCE" | "CHANNEL" | "PRODUCT", code: string) =>
  db.crmOption.findUnique({ where: { kind_code: { kind, code } }, select: { id: true, label: true } });

export type RealizatorResult = { customerId: string; contactId: string; created: boolean; duplicate: boolean };

export async function handleRealizator(ev: RealizatorEvent): Promise<RealizatorResult> {
  const importKey = `rb:${ev.event}:${ev.ref}`;
  const prev = await db.crmContact.findUnique({ where: { importKey }, select: { id: true, customerId: true } });
  if (prev) return { customerId: prev.customerId, contactId: prev.id, created: false, duplicate: true };

  const tg = await db.telegramAccount.findUnique({ where: { chatId: ev.realizator.tg_id }, select: { userId: true, isBlocked: true } });
  const linkedUser = tg && !tg.isBlocked ? tg.userId : null;
  const userId = linkedUser ?? (await botUserId());
  const who = ev.realizator.name || `Telegram ${ev.realizator.tg_id}`;

  const [source, channel, offerRes] = await Promise.all([
    opt("SOURCE", "realizator"), opt("CHANNEL", "meeting"),
    ev.event === "taklif" ? db.crmResult.findUnique({ where: { code: "offer_sent" } }) : null,
  ]);
  const tur = (ev.taklif?.tur ?? "").toLowerCase();
  const product = tur.includes("beton") ? await opt("PRODUCT", "concrete") : tur.includes("plita") ? await opt("PRODUCT", "slab") : null;

  // ── Mijoz: telefon bo'yicha, bo'lmasa yangi ──
  const m = ev.mijoz;
  const phone = normalizePhone(m.tel);
  const [region, ...rest] = (m.manzil ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const district = rest[0] ?? null;
  let customerId: string | null = null;
  let created = false;
  if (phone || m.tel) {
    const dups = await findDuplicates({ phone: phone ?? m.tel });
    customerId = (dups.find((d) => d.inCrm) ?? dups[0])?.id ?? null;
  }
  if (customerId) {
    const cur = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    const data: Prisma.CustomerUpdateInput = {};
    if (!cur.crmAt) data.crmAt = new Date();
    if (!cur.sourceId && source) data.source = { connect: { id: source.id } };
    if (!cur.region && region) data.region = region;
    if (!cur.district && district) data.district = district;
    if (!cur.foremanName && m.prorab) data.foremanName = m.prorab;
    if (!cur.foremanPhone && m.prorab_tel) data.foremanPhone = normalizePhone(m.prorab_tel) ?? m.prorab_tel;
    if (!cur.ownerId && linkedUser) data.owner = { connect: { id: linkedUser } };
    if (Object.keys(data).length) await db.customer.update({ where: { id: customerId }, data });
  } else {
    const name = (m.nomi || "").trim() || (phone ? `Obyekt ${phone}` : `Obyekt (${who})`);
    customerId = await createClient(
      { key: "", name, inn: null, phone, rawPhone: m.tel ?? null, contactPerson: null, region: null, district: null, objectType: null,
        foremanName: null, foremanPhone: null, clientType: null, source: null, ownerId: null, link: null, note: null },
      {
        region: region ?? null, district, foremanName: m.prorab ?? null, foremanPhone: m.prorab_tel ? normalizePhone(m.prorab_tel) ?? m.prorab_tel : null,
        sourceId: source?.id ?? null, ownerId: linkedUser ?? (await ownerByLogin()), crmNote: `Realizator botidan: ${who}`,
      },
      await defaultCreditLimit(), userId,
    );
    created = true;
  }

  // ── Aloqa ──
  const today = todayIso();
  const loc = m.lat != null && m.lon != null ? `https://maps.google.com/?q=${m.lat},${m.lon}` : null;
  const note = ev.event === "obyekt"
    ? [`Realizator ${who}: yangi obyekt`, ev.ehtiyojlar.length ? `Kerak: ${ev.ehtiyojlar.join(", ")}` : null, m.prorab ? `Prorab: ${m.prorab}${m.prorab_tel ? ` ${m.prorab_tel}` : ""}` : null, loc, ev.izoh].filter(Boolean).join("\n")
    : [`Realizator ${who}: tijorat taklifi${ev.taklif?.raqam ? ` #${ev.taklif.raqam}` : ""}${ev.taklif?.tur ? ` (${ev.taklif.tur})` : ""}`, ev.taklif?.mahsulotlar, ev.taklif?.masofa_km ? `Masofa: ~${ev.taklif.masofa_km} km` : null, ev.izoh].filter(Boolean).join("\n");
  let contactId: string;
  try {
    contactId = await db.$transaction(async (tx) => {
      const c = await tx.crmContact.create({
        data: {
          customerId: customerId!, importKey, date: isoToDb(today), userId,
          channelId: channel?.id ?? null, leadSourceId: source?.id ?? null, productId: product?.id ?? null,
          resultId: offerRes?.id ?? null, offeredPrice: ev.taklif?.jami ?? null,
          // Obyekt — bugun qo'ng'iroq qilinsin; taklif — natija standarti (+2 kun)
          nextContactDate: isoToDb(ev.event === "obyekt" ? today : defaultNext(offerRes?.defaultDays ?? 2, today)!),
          objectArea: m.manzil ?? null, note: note.slice(0, 2000),
        },
      });
      await audit(tx, userId, "CREATE", "CrmContact", c.id, undefined, { ...c, via: "realizator-bot", realizator: who });
      await refreshClient(tx, customerId!, userId);
      return c.id;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.crmContact.findUniqueOrThrow({ where: { importKey }, select: { id: true, customerId: true } });
      return { customerId: again.customerId, contactId: again.id, created: false, duplicate: true };
    }
    throw e;
  }
  return { customerId, contactId, created, duplicate: false };
}

/** Yangi obyektlar mas'uli — korxona sozlamasi `CRM_REALIZATOR_OWNER` (login), masalan operator; bo'lmasa bo'sh */
async function ownerByLogin(): Promise<string | null> {
  const login = process.env.CRM_REALIZATOR_OWNER?.trim();
  if (!login) return null;
  return (await db.user.findUnique({ where: { login }, select: { id: true } }))?.id ?? null;
}
