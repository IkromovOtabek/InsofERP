/** Mahsulot birligi: "m3" — tayyor beton (saqlanmaydi), boshqasi (dona, m2…) — hovlida turadigan tayyor mahsulot. */
export const unitLabel = (u: string) => (u === "m3" ? "m³" : u);
export const isStocked = (u: string) => u !== "m3";

/** Xomashyo birliklari (Sklad → Xomashyo qo'shish, Sozlamalar). */
export const MATERIAL_UNITS = ["kg", "t", "l", "m3", "dona", "m", "m2"] as const;
