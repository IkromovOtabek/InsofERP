import type { CashTxType } from "@/generated/prisma";

/**
 * Kirim-Chiqim yozuvining hisob qoldig'iga ta'siri — barcha qoldiq hisoblari shu bitta qoidadan:
 *   INCOME       (+) boshqa tushum
 *   EXPENSE      (−) chiqim
 *   OPENING      (+) boshlang'ich qoldiq — summa ishorali (manfiy bo'lsa — overdraft)
 *   TRANSFER_IN  (+) hisoblararo o'tkazma — qabul qiluvchi hisob
 *   TRANSFER_OUT (−) hisoblararo o'tkazma — manba hisob
 *
 * Ilgari `type === "INCOME" ? 1 : -1` yozilardi — OPENING turi qo'shilgach u chiqim bo'lib qolardi.
 */
export function txSign(type: CashTxType | string): 1 | -1 {
  return type === "EXPENSE" || type === "TRANSFER_OUT" ? -1 : 1;
}

/** O'tkazma yozuvlari: hisob qoldig'iga kiradi, lekin kirim ham, chiqim ham emas (pul kompaniya ichida ko'chdi). */
export const TRANSFER_TYPES = ["TRANSFER_OUT", "TRANSFER_IN"] as const satisfies readonly CashTxType[];
export const isTransfer = (type: CashTxType | string) => type === "TRANSFER_OUT" || type === "TRANSFER_IN";

/** Haqiqiy pul oqimi turlari — kirim/chiqim, P&L, kategoriya hisobotlari faqat shularni oladi. */
export const FLOW_TYPES = ["INCOME", "EXPENSE"] as const satisfies readonly CashTxType[];

/**
 * Pul oqimi / P&L hisobotlari uchun filtr: boshlang'ich qoldiq va hisoblararo o'tkazma — oqim emas (kirim ham,
 * chiqim ham emas), ular faqat hisob qoldig'ida qatnashadi. Ruxsat ro'yxati (whitelist) — kelajakda yangi tur
 * qo'shilsa ham u jimgina kirim yoki chiqim bo'lib qolmaydi. `where: { ...FLOW_ONLY, date: ... }` ko'rinishida.
 */
export const FLOW_ONLY = { type: { in: [...FLOW_TYPES] } };

/** Jurnal (ro'yxat) uchun: boshlang'ich qoldiqdan tashqari hammasi — o'tkazmalar ham o'z qatori bilan ko'rinadi. */
export const JOURNAL_ONLY = { type: { not: "OPENING" as const } };

/** `groupBy(["cashAccountId","type"])` natijasidan bitta hisob qoldig'i (ishora — `txSign`). */
export function balanceFromGroups(rows: { cashAccountId: string; type: CashTxType | string; _sum: { amount: unknown } }[], cashAccountId?: string): number {
  return rows.filter((r) => cashAccountId === undefined || r.cashAccountId === cashAccountId).reduce((s, r) => s + txSign(r.type) * Number(r._sum.amount ?? 0), 0);
}

/** Yozuv turining o'zbekcha nomi (jurnal, mobil, Excel). */
export const TX_TYPE_LABEL: Record<CashTxType, string> = {
  INCOME: "Kirim", EXPENSE: "Chiqim", OPENING: "Boshlang'ich qoldiq", TRANSFER_OUT: "O'tkazma (chiqdi)", TRANSFER_IN: "O'tkazma (kirdi)",
};

/** O'tkazma yozuvlari va hujjati uchun umumiy nomlar. */
export const TRANSFER_REF = "CashTransfer";
export const TRANSFER_CATEGORY = "O'tkazma";
export const BANK_FEE_CATEGORY = "Bank xizmati";
