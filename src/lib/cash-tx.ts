import type { CashTxType } from "@/generated/prisma";

/**
 * Kirim-Chiqim yozuvining hisob qoldig'iga ta'siri — barcha qoldiq hisoblari shu bitta qoidadan:
 *   INCOME  (+) boshqa tushum
 *   EXPENSE (−) chiqim
 *   OPENING (+) boshlang'ich qoldiq — summa ishorali (manfiy bo'lsa — overdraft)
 *
 * Ilgari `type === "INCOME" ? 1 : -1` yozilardi — OPENING turi qo'shilgach u chiqim bo'lib qolardi.
 */
export function txSign(type: CashTxType | string): 1 | -1 {
  return type === "EXPENSE" ? -1 : 1;
}

/**
 * Pul oqimi / P&L hisobotlari uchun filtr: boshlang'ich qoldiq — oqim emas (kirim ham, chiqim ham emas),
 * u faqat hisob qoldig'ida qatnashadi. `where: { ...FLOW_ONLY, date: ... }` ko'rinishida ishlatiladi.
 */
export const FLOW_ONLY = { type: { not: "OPENING" as const } };
