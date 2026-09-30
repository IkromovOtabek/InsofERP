import type { SupplyDelivery, SupplyIncidentKind, SupplyPriority } from "@/generated/prisma";

/**
 * Snabjeniye TZ yorliqlari — klient komponentlar ham o'qiydi, shuning uchun baza importisiz alohida fayl
 * (`lib/procurement.ts` server tomoni).
 */

/** Talab qaysi bo'limdan keldi. */
export const DEPARTMENTS = ["Ishlab chiqarish", "Sklad", "Texnika", "Logistika", "Laboratoriya", "Ma'muriyat", "Boshqa"] as const;

export const PRIORITY_LABEL: Record<SupplyPriority, string> = { NORMAL: "Oddiy", HIGH: "Yuqori", CRITICAL: "Kritik" };
export const PRIORITY_COLOR: Record<SupplyPriority, "slate" | "amber" | "red"> = { NORMAL: "slate", HIGH: "amber", CRITICAL: "red" };
export const PRIORITIES: SupplyPriority[] = ["NORMAL", "HIGH", "CRITICAL"];

/** Yetkazib berish holati — TZ 5-bo'lim: Rejalashtirilgan → Yo'lda → Zavodga keldi → Qabul qilinmoqda → Qabul qilindi / Muammo. */
export const DELIVERY_LABEL: Record<SupplyDelivery, string> = {
  PLANNED: "Rejalashtirilgan",
  IN_TRANSIT: "Yo'lda",
  ARRIVED: "Zavodga keldi",
  RECEIVING: "Qabul qilinmoqda",
  RECEIVED: "Qabul qilindi",
  PROBLEM: "Muammo",
};
export const DELIVERY_COLOR: Record<SupplyDelivery, "slate" | "blue" | "amber" | "green" | "red"> = {
  PLANNED: "slate", IN_TRANSIT: "blue", ARRIVED: "amber", RECEIVING: "amber", RECEIVED: "green", PROBLEM: "red",
};
/** Snabjeniye qo'lda qo'yadigan holatlar (RECEIVED — faqat qabul bilan avtomatik). */
export const DELIVERY_MANUAL: SupplyDelivery[] = ["PLANNED", "IN_TRANSIT", "ARRIVED", "RECEIVING", "PROBLEM"];

export const INCIDENT_LABEL: Record<SupplyIncidentKind, string> = {
  SHORTAGE: "Kam miqdor", QUALITY: "Sifatsiz mahsulot", DELAY: "Kechikish", DOCS: "Hujjat yetishmaydi", OTHER: "Boshqa",
};
export const INCIDENT_KINDS: SupplyIncidentKind[] = ["SHORTAGE", "QUALITY", "DELAY", "DOCS", "OTHER"];

export const DOC_KINDS = ["Shartnoma", "Hisob-faktura", "Nakladnoy", "Sertifikat", "Boshqa"] as const;
/** Qabul qilingan xaridda bo'lishi shart hujjatlar — biri yo'q bo'lsa "hujjat yetishmayapti" ogohlantirishi. */
export const REQUIRED_DOCS = ["Hisob-faktura", "Nakladnoy"] as const;

export const PAYMENT_TERMS = ["100% oldindan", "50% oldindan, 50% kelganda", "Kelganda to'lov", "Kechiktirilgan to'lov"] as const;

/**
 * TZ'dagi talabnoma va xarid statuslari bizning zanjir bosqichiga shunday tushadi
 * (zanjir o'zgarmaydi — faqat ko'rinish):
 *   Talabnoma: Yangi (NEW) → Tekshirilmoqda (PRICED) → Tasdiqlangan (APPROVED) → Xarid jarayonida (FUNDED) → Bajarildi (RECEIVED) / Bekor (REJECTED)
 *   Xarid:     Draft (NEW) → Tasdiqlashda (PRICED, APPROVED) → Buyurtma berildi (FUNDED) → To'liq/Qisman yetkazildi (RECEIVED)
 */
export const REQUISITION_LABEL = {
  NEW: "Yangi", PRICED: "Tekshirilmoqda", APPROVED: "Tasdiqlangan", FUNDED: "Xarid jarayonida", RECEIVED: "Bajarildi", REJECTED: "Bekor qilindi",
} as const;
