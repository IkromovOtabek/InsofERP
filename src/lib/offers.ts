import { randomBytes } from "node:crypto";
import type { OfferStatus } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { getCompany } from "./company";
import { notifyAfter, notifyRoles, notifyUsers } from "./notify";
import { createLead } from "./leads";
import { normalizePhone } from "./phone";
import { money } from "./format";

/* ───────────────────────── Tijorat taklifi (Kommercheskoe predlojenie) ─────────────────────────
 *
 * Mijozga beriladigan rasmiy narx taklifi. Zayavkadan mustaqil: zayavka ochilmagan, hatto mijoz
 * kartasi yo'q potensial xaridorga ham tuziladi. Hujjat A4 da chop etiladi (`/takliflar/[id]/print`),
 * QR kodi ommaviy `/taklif/<№>?k=<kalit>` sahifasini ochadi — mijoz haqiqiyligini tekshiradi,
 * menejerga bog'lanadi yoki «Qabul qilaman» deydi.
 *
 * Pul: qatordagi `price` — QQS'siz narx. `withVat` bo'lsa hujjatda QQS 12% alohida ustun
 * (`offerTotals`). Hujjat o'chirilmaydi — faqat bekor qilinadi (sabab bilan), hammasi AuditLog'da.
 */

export const OFFER_PREFIX = "TK";

/** Taklif boshidagi standart kirish matni (Sozlamalarda o'zgartiriladi, hujjatga nusxa bo'lib saqlanadi). */
export const OFFER_DEFAULT_INTRO =
  "Kompaniyamiz taklif qilayotgan mahsulotlar sifati amaldagi standartlarga muvofiq dastlabki sertifikatlashdan o'tgan — " +
  "bu ularni har qanday murakkablikdagi obyektlarda qo'llash mumkinligini bildiradi. Biz uchun har bir mijoz muhim, " +
  "shuning uchun taklif qilayotgan mahsulotimiz sifatiga alohida e'tibor beramiz. Mahsulotlarimizni tanlang — " +
  "inshootingiz mustahkam va ishonchli bo'ladi.";

/** Taklif oxiridagi standart shartlar — har qatori alohida band. */
export const OFFER_DEFAULT_TERMS = [
  "Barcha narxlar QQS 12% hisobga olingan holda ko'rsatilgan.",
  "Taklif ko'rsatilgan sanagacha amal qiladi; undan keyin narxlar qayta kelishiladi.",
  "Xomashyo yoki ishlatiladigan resurslar narxi o'zgarsa, jo'natiladigan mahsulot narxini mos ravishda o'zgartirish huquqini o'zimizda saqlab qolamiz.",
  "Yetkazib berish va yuk tushirish (avtokran) xizmatlari alohida qator bilan ko'rsatiladi.",
].join("\n");

export { OFFER_UNITS, offerUnitLabel, offerTotals } from "./offer-calc";
export type { OfferLineInput, OfferLineCalc, OfferTotals } from "./offer-calc";
import { offerTotals } from "./offer-calc";
import type { OfferLineInput } from "./offer-calc";

/* ───────────────────────── Holat ───────────────────────── */

/** Hujjat holati: bazadagi `status` + sana bo'yicha «muddati o'tgan». */
export type OfferState = OfferStatus | "EXPIRED";

export const OFFER_STATE: Record<OfferState, { label: string; color: "green" | "blue" | "amber" | "red" | "slate" }> = {
  ACTIVE: { label: "Amal qiladi", color: "blue" },
  ACCEPTED: { label: "Qabul qilingan", color: "green" },
  EXPIRED: { label: "Muddati o'tgan", color: "amber" },
  CANCELLED: { label: "Bekor qilingan", color: "red" },
};

/** Bugungi sana zavod vaqtida (server UTC bo'lsa ham kechqurun ertangi kunga o'tib ketmasin). */
export const offerToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tashkent" }).format(new Date());

/** `validUntil` sana sifatida (vaqtsiz, UTC 00:00) saqlanadi — kun oxirigacha amal qiladi. */
export const isExpired = (validUntil: Date) => validUntil.toISOString().slice(0, 10) < offerToday();

export function offerState(o: { status: OfferStatus; validUntil: Date }): OfferState {
  if (o.status !== "ACTIVE") return o.status;
  return isExpired(o.validUntil) ? "EXPIRED" : "ACTIVE";
}

/** Shu holatdagi takliflar uchun ro'yxat filtri (`EXPIRED` — sana bo'yicha). */
export function offerStateWhere(state: OfferState | undefined, today = offerToday()) {
  const day = new Date(`${today}T00:00:00.000Z`);
  if (state === "EXPIRED") return { status: "ACTIVE" as const, validUntil: { lt: day } };
  if (state === "ACTIVE") return { status: "ACTIVE" as const, validUntil: { gte: day } };
  if (state) return { status: state };
  return {};
}

/* ───────────────────────── Havolalar ───────────────────────── */

/** Ommaviy (QR) sahifa yo'li — raqam ketma-ket, shuning uchun kalitsiz ochilmaydi. */
export const offerPublicPath = (o: { offerNo: string; verifyToken: string }) => `/taklif/${encodeURIComponent(o.offerNo)}?k=${o.verifyToken}`;

/** Sozlamalardagi standart qiymatlar — yangi taklif formasi uchun. */
export async function offerDefaults() {
  const c = await getCompany();
  return {
    intro: c.offerIntro?.trim() || OFFER_DEFAULT_INTRO,
    terms: c.offerTerms?.trim() || OFFER_DEFAULT_TERMS,
    validDays: c.offerValidDays,
    withVat: c.vatPayer,
  };
}

/* ───────────────────────── Yozish ───────────────────────── */

export type NewOffer = {
  customerId?: string | null;
  clientName: string;
  clientPhone?: string | null;
  clientInn?: string | null;
  objectName?: string | null;
  deadline?: string | null;
  validUntil: Date;
  withVat: boolean;
  advance: number;
  lang: "uz" | "ru";
  intro?: string | null;
  terms?: string | null;
  note?: string | null;
  orderId?: string | null;
  leadId?: string | null;
  items: OfferLineInput[];
};

export type OfferResult = { ok: true; id: string; offerNo: string } | { ok: false; error: string };

/** Yangi taklif: raqam `TK-YYYY-00001`, QR kaliti, qatorlar; AuditLog. */
export async function createOffer(input: NewOffer, userId: string): Promise<OfferResult> {
  if (input.items.length === 0) return { ok: false, error: "Kamida bitta qator kiriting" };
  for (const [i, l] of input.items.entries()) {
    if (!l.name.trim()) return { ok: false, error: `${i + 1}-qator: nomi yo'q` };
    if (!(l.qty > 0)) return { ok: false, error: `${i + 1}-qator (${l.name}): miqdor 0 dan katta bo'lsin` };
    if (!(l.price >= 0)) return { ok: false, error: `${i + 1}-qator (${l.name}): narx noto'g'ri` };
  }
  if (input.validUntil.toISOString().slice(0, 10) < offerToday()) return { ok: false, error: "Amal qilish muddati o'tgan sana bo'lishi mumkin emas" };
  if (input.customerId) {
    const c = await db.customer.findUnique({ where: { id: input.customerId }, select: { id: true, isInternal: true } });
    if (!c || c.isInternal) return { ok: false, error: "Mijoz topilmadi" };
  }
  const offer = await db.$transaction(async (tx) => {
    const offerNo = await nextNo(tx, "commercialOffer", OFFER_PREFIX);
    const o = await tx.commercialOffer.create({
      data: {
        offerNo,
        validUntil: input.validUntil,
        lang: input.lang,
        customerId: input.customerId ?? null,
        clientName: input.clientName.trim(),
        clientPhone: input.clientPhone?.trim() || null,
        clientInn: input.clientInn?.trim() || null,
        objectName: input.objectName?.trim() || null,
        deadline: input.deadline?.trim() || null,
        withVat: input.withVat,
        advance: input.advance,
        intro: input.intro?.trim() || null,
        terms: input.terms?.trim() || null,
        note: input.note?.trim() || null,
        managerId: userId,
        orderId: input.orderId ?? null,
        leadId: input.leadId ?? null,
        verifyToken: randomBytes(12).toString("base64url"),
        items: { create: input.items.map((l, i) => ({ productId: l.productId || null, name: l.name.trim(), unit: l.unit, qty: l.qty, price: l.price, sort: i })) },
      },
      select: { id: true, offerNo: true },
    });
    await audit(tx, userId, "CREATE", "CommercialOffer", o.id, undefined, { offerNo, clientName: input.clientName, items: input.items.length, gross: offerTotals(input.items, input.withVat).gross });
    return o;
  });
  return { ok: true, ...offer };
}

export type OfferActionResult = { ok: true; note?: string } | { ok: false; error: string };

/** Bekor qilish — faqat amaldagi (yoki muddati o'tgan) taklif; qabul qilinganini bekor qilib bo'lmaydi. */
export async function cancelOffer(id: string, reason: string, userId: string): Promise<OfferActionResult> {
  if (!reason.trim()) return { ok: false, error: "Bekor qilish sababini yozing" };
  const r = await db.commercialOffer.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.trim() } });
  if (r.count === 0) {
    const o = await db.commercialOffer.findUnique({ where: { id }, select: { status: true } });
    if (!o) return { ok: false, error: "Taklif topilmadi" };
    return { ok: false, error: o.status === "ACCEPTED" ? "Qabul qilingan taklif bekor qilinmaydi" : "Taklif allaqachon bekor qilingan" };
  }
  await audit(db, userId, "STATUS_CHANGE", "CommercialOffer", id, { status: "ACTIVE" }, { status: "CANCELLED", reason });
  return { ok: true, note: "Taklif bekor qilindi" };
}

/** Menejer qo'lda «mijoz qabul qildi» deb belgilaydi (telefon orqali kelishilganda). */
export async function acceptOfferByManager(id: string, userId: string, who: string): Promise<OfferActionResult> {
  const r = await db.commercialOffer.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedBy: who.trim() || "Menejer belgiladi" } });
  if (r.count === 0) return { ok: false, error: "Faqat amaldagi taklif qabul qilingan deb belgilanadi" };
  await audit(db, userId, "STATUS_CHANGE", "CommercialOffer", id, { status: "ACTIVE" }, { status: "ACCEPTED", by: who });
  return { ok: true, note: "Taklif qabul qilingan deb belgilandi" };
}

/* ───────────────────────── Ommaviy (QR) sahifa ───────────────────────── */

/** QR orqali ochilgan taklif — kalit mos kelmasa `null` (raqam mavjudligi ham oshkor qilinmaydi). */
export async function findPublicOffer(offerNo: string, k: string | undefined) {
  if (!k || !/^[A-Za-z0-9_-]{8,64}$/.test(k)) return null;
  const o = await db.commercialOffer.findUnique({
    where: { offerNo },
    include: { items: { orderBy: { sort: "asc" } }, manager: { select: { id: true, fullName: true, employee: { select: { phone: true } } } } },
  });
  return o && o.verifyToken === k ? o : null;
}

/** Mijoz QR ni skanerladi — ERP'da «ko'rildi» hisoblanadi (menejer kim ochganini ko'radi). */
export async function recordOfferView(id: string): Promise<void> {
  const now = new Date();
  await db.commercialOffer.updateMany({ where: { id }, data: { viewCount: { increment: 1 }, lastViewedAt: now } });
  await db.commercialOffer.updateMany({ where: { id, firstViewedAt: null }, data: { firstViewedAt: now } });
}

export type PublicReply = { kind: "accept" | "question"; name: string; phone: string; note?: string | null };

/**
 * Mijoz ommaviy sahifada «Qabul qilaman» yoki «Savol bor» yubordi.
 * Qabul: faqat amaldagi taklif ACCEPTED bo'ladi (poyga — shartli updateMany); ikkala holda ham
 * sotuvga ariza (Lead, manba «taklif») tushadi va menejer + sotuv bo'limi bildirishnoma oladi.
 */
export async function replyOfferPublic(offerNo: string, k: string | undefined, r: PublicReply): Promise<OfferActionResult> {
  const o = await findPublicOffer(offerNo, k);
  if (!o) return { ok: false, error: "Taklif topilmadi" };
  const phone = normalizePhone(r.phone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri. Masalan: 90 123 45 67" };
  const name = r.name.trim();
  if (name.length < 2) return { ok: false, error: "Ismingizni yozing" };
  const state = offerState(o);

  let accepted = false;
  if (r.kind === "accept") {
    if (state === "CANCELLED") return { ok: false, error: "Bu taklif bekor qilingan — menejer bilan bog'laning" };
    if (state === "EXPIRED") return { ok: false, error: "Taklif muddati tugagan — yangilangan narx uchun menejer bilan bog'laning" };
    if (state === "ACTIVE") {
      const u = await db.commercialOffer.updateMany({ where: { id: o.id, status: "ACTIVE" }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedBy: name, acceptedNote: r.note?.trim() || null } });
      accepted = u.count > 0;
      if (accepted) await audit(db, o.managerId, "STATUS_CHANGE", "CommercialOffer", o.id, { status: "ACTIVE" }, { status: "ACCEPTED", by: name, phone, via: "qr" });
    }
  }

  const total = offerTotals(o.items.map((i) => ({ name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })), o.withVat).gross;
  const title = r.kind === "accept" ? `Taklif ${o.offerNo} qabul qilindi` : `Taklif ${o.offerNo} bo'yicha savol`;
  const body = `${name} · ${phone} · ${o.clientName}${r.note?.trim() ? ` · ${r.note.trim().slice(0, 120)}` : ""}`;
  // Ariza — sotuv bo'limi odatdagi oqimida ko'radi (manba «taklif»); ikki daqiqada takror yuborilsa dublikat ochilmaydi
  const first = o.items.find((i) => i.productId);
  notifyAfter(async () => {
    await createLead({
      name, phone, source: "taklif", productId: first?.productId ?? null, qty: first ? Number(first.qty) : null,
      address: o.objectName, message: `${title}. Summa ${money(total)}.${r.note?.trim() ? ` Izoh: ${r.note.trim()}` : ""}`,
      landingPage: `/taklif/${o.offerNo}`,
    });
  });
  notifyAfter(() => notifyUsers([o.managerId], { type: r.kind === "accept" ? "OFFER_ACCEPTED" : "OFFER_QUESTION", title, body, link: { key: "offers", id: o.id } }));
  notifyAfter(() => notifyRoles(["SALES"], { type: r.kind === "accept" ? "OFFER_ACCEPTED" : "OFFER_QUESTION", title, body, link: { key: "offers", id: o.id }, channel: "oddiy" }, { except: o.managerId }));

  if (r.kind === "accept") return { ok: true, note: accepted || state === "ACCEPTED" ? "Rahmat! Taklif qabul qilindi — menejer siz bilan tez orada bog'lanadi." : "So'rovingiz yuborildi." };
  return { ok: true, note: "Savolingiz menejerga yetkazildi — tez orada javob beramiz." };
}
