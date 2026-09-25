/** Mahsulot spravochnigi uchun umumiy ro'yxatlar. */

/** "Tovar turi" — 1C dagi ro'yxat bilan bir xil. */
export const PRODUCT_KINDS = ["Tovar", "Tayyor Mahsulot", "Primoy Foyda", "Asosiy Vosita"] as const;

export type ProductKind = (typeof PRODUCT_KINDS)[number];

/**
 * Spravochnikni kim to'ldira oladi — server action'lar ham, sahifalardagi "Yangi" tugmasi ham
 * shu ro'yxatga qaraydi. Shunda mahsulot qaysi bo'limdan qo'shilsa ham qoida bir xil bo'ladi.
 */
export const PRODUCT_CATALOG_ROLES = ["SALES", "PRODUCTION", "WAREHOUSE", "DIRECTOR"] as const;
export const MATERIAL_CATALOG_ROLES = ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "DIRECTOR"] as const;

export const canEditProducts = (role: string) => (PRODUCT_CATALOG_ROLES as readonly string[]).includes(role);
export const canEditMaterials = (role: string) => (MATERIAL_CATALOG_ROLES as readonly string[]).includes(role);
