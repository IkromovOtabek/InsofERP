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

/**
 * Faqat qo'shish (yangi mahsulot va papka): ish boshqaruvchi sklad zayavkasida yo'q mahsulotni o'zi ochadi.
 * O'chirish, Excel, matritsa va birlashtirish unga yopiq — ular `PRODUCT_CATALOG_ROLES` da qoladi.
 */
export const PRODUCT_ADD_ROLES = [...PRODUCT_CATALOG_ROLES, "SUPERVISOR"] as const;

/** Tanlagichdagi huquq: true — to'liq spravochnik, "add" — faqat «Yangi mahsulot» va «Papka», false — faqat tanlash. */
export type ProductCreate = boolean | "add";

export const canEditProducts = (role: string) => (PRODUCT_CATALOG_ROLES as readonly string[]).includes(role);
export const productCreateLevel = (role: string): ProductCreate =>
  canEditProducts(role) ? true : (PRODUCT_ADD_ROLES as readonly string[]).includes(role) ? "add" : false;
export const canEditMaterials = (role: string) => (MATERIAL_CATALOG_ROLES as readonly string[]).includes(role);
