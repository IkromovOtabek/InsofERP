import type { LedgerRevenueType } from "@/generated/prisma";

/**
 * Hisob varag'idagi qo'lda qator kirimi turi (`LogisticsEntry.revenueType`): dostavka va usluga prixodi — perechisleniye
 * yoki naqd, «Obyekt» — zavodning o'zi uchun ish (zavodga olib kelingan narsa). Hammasi logistika daromadi, foydaga kiradi.
 * Klientda ham ishlatiladi — bazaga murojaat yo'q.
 */
export const LEDGER_REVENUE_TYPES = ["BANK", "CASH", "SERVICE_BANK", "SERVICE_CASH", "OBJECT"] as const satisfies readonly LedgerRevenueType[];

export const LEDGER_REVENUE_LABEL: Record<LedgerRevenueType, string> = {
  BANK: "Dostavka — perech.",
  CASH: "Dostavka — naqd",
  SERVICE_BANK: "Usluga — perech.",
  SERVICE_CASH: "Usluga — naqd",
  OBJECT: "Obyekt (zavod uchun)",
};

/**
 * «Excel orqali qo'shish» matn ustunlari chegarasi — qo'lda qator maydonlari bilan bir xil (`entrySchema`); server
 * (`lib/ledger-import.ts`) ham, oyna ham shu bo'yicha tekshiradi.
 */
export const LEDGER_TEXT_MAX = { pickup: 120, dropoff: 160, cargo: 120, note: 300, ttn: 120 } as const;

export const LEDGER_REVENUE_REQUIRED = "Kirim turini tanlang: dostavka yoki usluga (naqd / perech.), yoki obyekt (zavod uchun)";
