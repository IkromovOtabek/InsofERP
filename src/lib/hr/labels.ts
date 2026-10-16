import type { HrRequestKind, HrRequestStatus, PayAdjKind, PayRuleTrigger, PayType, PayrollKind, PayrollStatus } from "@/generated/prisma";

/**
 * Otdel kadr modullari yorliqlari — veb, mobil va chop etish bir xil yozuvni ko'rsatsin.
 * Bu fayl brauzerda ham ishlaydi (baza importi yo'q).
 */

export const PAY_TYPE_LABEL: Record<PayType, string> = {
  SALARY: "Oklad (oylik)",
  DAILY: "Kunbay",
  HOURLY: "Soatbay",
  PIECE: "Sdelka (ishbay)",
};
/** Kartadagi "Tarif stavka" maydoni nima ma'noni bildiradi. */
export const PAY_RATE_HINT: Record<PayType, string> = {
  SALARY: "oylik oklad, so'm",
  DAILY: "bir kunlik stavka, so'm",
  HOURLY: "bir soatlik stavka, so'm",
  PIECE: "sdelka — brigada mahsuloti × mahsulotning sdelka narxi (stavka shart emas)",
};

export type RequestKindMeta = { label: string; dates: boolean; amount?: boolean; hint: string };
export const REQUEST_KIND: Record<HrRequestKind, RequestKindMeta> = {
  VACATION: { label: "Mehnat ta'tili", dates: true, hint: "Tasdiqlansa — kunlar davomatda «Ta'til» bo'ladi, ta'til puli hisoblanadi" },
  UNPAID: { label: "O'z hisobidan ta'til", dates: true, hint: "Tasdiqlansa — «Ta'til», lekin haq to'lanmaydi" },
  SICK: { label: "Kasallik varaqasi", dates: true, hint: "Tasdiqlansa — «Kasal»; nafaqa stajga qarab foizda" },
  DAYOFF: { label: "Dam olish kuni", dates: true, hint: "Tasdiqlansa — «Dam olish» (haq to'lanmaydi)" },
  ADVANCE: { label: "Avans", dates: false, amount: true, hint: "Tasdiqlansa — direktor tasdig'iga avans vedomosti, keyin kassa beradi; oy yakunida ushlanadi" },
  LATE_REASON: { label: "Kechikish sababi", dates: true, hint: "Tasdiqlansa — shu kunlardagi kechikish uchun jarima yozilmaydi" },
  ABSENCE_REASON: { label: "Kelmaslik sababi", dates: true, hint: "Tasdiqlansa — shu kunlar «sababli» hisoblanadi, jarima yozilmaydi" },
  OTHER: { label: "Boshqa ariza", dates: false, hint: "Otdel kadr ko'rib chiqadi" },
};
export const REQUEST_KINDS = Object.keys(REQUEST_KIND) as HrRequestKind[];

export const REQUEST_STATUS_LABEL: Record<HrRequestStatus, string> = { PENDING: "Ko'rib chiqilmoqda", APPROVED: "Tasdiqlandi", REJECTED: "Rad etildi", CANCELLED: "Bekor qilindi" };
export const REQUEST_STATUS_TONE: Record<HrRequestStatus, "warning" | "success" | "danger" | "info"> = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", CANCELLED: "info" };
export const REQUEST_STATUS_BADGE: Record<HrRequestStatus, "amber" | "green" | "red" | "slate"> = { PENDING: "amber", APPROVED: "green", REJECTED: "red", CANCELLED: "slate" };

export const ADJ_KIND_LABEL: Record<PayAdjKind, string> = { BONUS: "Bonus", PENALTY: "Jarima" };
export const RULE_TRIGGER: Record<PayRuleTrigger, { label: string; kinds: PayAdjKind[]; perMinute: boolean; hint: string }> = {
  LATE: { label: "Kechikish", kinds: ["PENALTY"], perMinute: true, hint: "Har kechikkan kun uchun (yoki har daqiqa uchun); sababi tasdiqlangan kun hisoblanmaydi" },
  ABSENT: { label: "Sababsiz kelmaslik", kinds: ["PENALTY"], perMinute: false, hint: "Davomatda «Kelmadi» bo'lgan har kun uchun; sababi tasdiqlangan kun hisoblanmaydi" },
  EARLY_LEAVE: { label: "Erta ketish", kinds: ["PENALTY"], perMinute: true, hint: "Smena tugashidan oldin ketgan har kun (yoki daqiqa) uchun" },
  NO_LATE_MONTH: { label: "Oy davomida kechikishsiz", kinds: ["BONUS"], perMinute: false, hint: "Oyda bitta ham kechikish va sababsiz kelmaslik bo'lmasa" },
  FULL_MONTH: { label: "Oy normasini to'liq ishladi", kinds: ["BONUS"], perMinute: false, hint: "Grafikdagi barcha ish kunlarida kelgan bo'lsa" },
};

export const PAYROLL_KIND_LABEL: Record<PayrollKind, string> = { ADVANCE: "Avans", FINAL: "Oy yakuni", EXTRA: "Alohida to'lov" };
export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = { DRAFT: "Qoralama", SUBMITTED: "Direktor tasdig'ida", APPROVED: "Tasdiqlandi — to'lovga", PAID: "To'landi", CANCELLED: "Bekor qilindi" };
export const PAYROLL_STATUS_BADGE: Record<PayrollStatus, "slate" | "amber" | "blue" | "green" | "red"> = { DRAFT: "slate", SUBMITTED: "amber", APPROVED: "blue", PAID: "green", CANCELLED: "red" };
export const PAYROLL_STATUS_TONE: Record<PayrollStatus, "info" | "warning" | "brand" | "success" | "danger"> = { DRAFT: "info", SUBMITTED: "warning", APPROVED: "brand", PAID: "success", CANCELLED: "danger" };
