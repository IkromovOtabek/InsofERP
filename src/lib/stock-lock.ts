import type { Prisma } from "@/generated/prisma";

/**
 * Sklad qoldig'ini kamaytiradigan amallar (zames, brigadaga berish) qoldiqni tekshirib, keyin
 * yozadi. Ikkisi bir vaqtda kelsa, har biri eski qoldiqni ko'rib o'tib ketadi va qoldiq minusga
 * tushadi. Tranzaksiya boshida shu qulf olinadi — tekshiruv va yozuv navbat bilan bajariladi.
 * Qulf tranzaksiya tugaganda o'zi ochiladi. Hajm kichik, shuning uchun bitta umumiy kalit yetarli.
 */
const STOCK_LOCK_KEY = 7_402_026;

export async function lockStock(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${STOCK_LOCK_KEY})`;
}

/** Suzuvchi nuqta xatosi: 0.1 × 3 kabi hisob qoldiqni aynan tugatadigan amalni to'xtatmasin. */
export const STOCK_EPS = 0.0005;
