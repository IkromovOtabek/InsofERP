/** Mahsulot spravochnigi uchun umumiy ro'yxatlar. */

/** "Tovar turi" — 1C dagi ro'yxat bilan bir xil. */
export const PRODUCT_KINDS = ["Tovar", "Tayyor Mahsulot", "Primoy Foyda", "Asosiy Vosita"] as const;

export type ProductKind = (typeof PRODUCT_KINDS)[number];
