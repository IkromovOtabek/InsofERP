import type { MaterialCategory, Role } from "@/generated/prisma";

/**
 * Xomashyo spravochnigi kategoriyalari (`Material.category`). Tartib — foydalanuvchi aytgandek:
 * 1. Zavod zapchast, 2. Avto zapchast, 3. Xomashyo. Klientda ham ishlatiladi — bazaga murojaat yo'q.
 */
export const MATERIAL_CATEGORIES = ["ZAVOD_ZAPCHAST", "AVTO_ZAPCHAST", "XOMASHYO"] as const satisfies readonly MaterialCategory[];

export const MATERIAL_CATEGORY_LABEL: Record<MaterialCategory, string> = {
  ZAVOD_ZAPCHAST: "Zavod zapchast",
  AVTO_ZAPCHAST: "Avto zapchast",
  XOMASHYO: "Xomashyo",
};

/** Formalardagi tanlov: [qiymat, yorliq]. */
export const MATERIAL_CATEGORY_OPTIONS: [MaterialCategory, string][] = MATERIAL_CATEGORIES.map((c) => [c, MATERIAL_CATEGORY_LABEL[c]]);

export const isMaterialCategory = (v: unknown): v is MaterialCategory =>
  typeof v === "string" && (MATERIAL_CATEGORIES as readonly string[]).includes(v);

/** URL'dagi qisqa nom (`?kat=avto`) ↔ kategoriya. */
export const CATEGORY_SLUG: Record<MaterialCategory, string> = { ZAVOD_ZAPCHAST: "zavod", AVTO_ZAPCHAST: "avto", XOMASHYO: "xomashyo" };
export const categoryFromSlug = (v?: string | null): MaterialCategory | null =>
  (Object.entries(CATEGORY_SLUG).find(([, s]) => s === v)?.[0] as MaterialCategory | undefined) ?? null;

/**
 * Rol skladda qaysi kategoriyalarni ko'radi. Mexanik — faqat Avto zapchast va Xomashyo
 * (Zavod zapchast unga kerak emas); qolgan rollar — hammasini.
 */
export function categoriesFor(role: Role | string | null | undefined): MaterialCategory[] {
  return role === "MECHANIC" ? ["AVTO_ZAPCHAST", "XOMASHYO"] : [...MATERIAL_CATEGORIES];
}
