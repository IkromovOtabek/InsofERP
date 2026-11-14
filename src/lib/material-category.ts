import type { MaterialCategory, Role } from "@/generated/prisma";

/**
 * Xomashyo spravochnigi kategoriyalari (`Material.category`). Tartib — foydalanuvchi aytgandek:
 * 1. Zavod zapchast, 2. Avto zapchast, 3. Xomashyo, 4. Ofis (2026-11-14 qo'shildi). Klientda ham ishlatiladi — bazaga murojaat yo'q.
 */
export const MATERIAL_CATEGORIES = ["ZAVOD_ZAPCHAST", "AVTO_ZAPCHAST", "XOMASHYO", "OFIS"] as const satisfies readonly MaterialCategory[];

export const MATERIAL_CATEGORY_LABEL: Record<MaterialCategory, string> = {
  ZAVOD_ZAPCHAST: "Zavod zapchast",
  AVTO_ZAPCHAST: "Avto zapchast",
  XOMASHYO: "Xomashyo",
  OFIS: "Ofis",
};

/** Sklad sahifasi tepasidagi bo'lim tugmalari tartibi (foydalanuvchi aytgandek): Xomashyo, Avto zapchast, Zavod zapchast, Ofis */
export const STOCK_TAB_ORDER = ["XOMASHYO", "AVTO_ZAPCHAST", "ZAVOD_ZAPCHAST", "OFIS"] as const satisfies readonly MaterialCategory[];

/** Formalardagi tanlov: [qiymat, yorliq]. */
export const MATERIAL_CATEGORY_OPTIONS: [MaterialCategory, string][] = MATERIAL_CATEGORIES.map((c) => [c, MATERIAL_CATEGORY_LABEL[c]]);

export const isMaterialCategory = (v: unknown): v is MaterialCategory =>
  typeof v === "string" && (MATERIAL_CATEGORIES as readonly string[]).includes(v);

/** Excel'dagi «Kategoriya» yozuvi («Avto zapchast», «завод», «XOMASHYO») → kategoriya; tanilmasa null. */
export function categoryFromText(v: unknown): MaterialCategory | null {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t) return null;
  if (isMaterialCategory(t.toUpperCase())) return t.toUpperCase() as MaterialCategory;
  if (/avto|авто|mashina|машин/.test(t)) return "AVTO_ZAPCHAST";
  if (/zavod|завод|uskuna|оборуд/.test(t)) return "ZAVOD_ZAPCHAST";
  if (/xom|хом|сыр/.test(t)) return "XOMASHYO";
  if (/ofis|офис|office|kansel|канцел|kanstov|канцтов/.test(t)) return "OFIS";
  return null;
}

/** URL'dagi qisqa nom (`?kat=avto`) ↔ kategoriya. */
export const CATEGORY_SLUG: Record<MaterialCategory, string> = { ZAVOD_ZAPCHAST: "zavod", AVTO_ZAPCHAST: "avto", XOMASHYO: "xomashyo", OFIS: "ofis" };
export const categoryFromSlug = (v?: string | null): MaterialCategory | null =>
  (Object.entries(CATEGORY_SLUG).find(([, s]) => s === v)?.[0] as MaterialCategory | undefined) ?? null;

/**
 * Rol skladda qaysi kategoriyalarni ko'radi. Mexanik — faqat Avto zapchast va Xomashyo
 * (Zavod zapchast va Ofis unga kerak emas); qolgan rollar — hammasini.
 */
export function categoriesFor(role: Role | string | null | undefined): MaterialCategory[] {
  return role === "MECHANIC" ? ["AVTO_ZAPCHAST", "XOMASHYO"] : [...MATERIAL_CATEGORIES];
}
