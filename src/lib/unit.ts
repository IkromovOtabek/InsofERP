/** Mahsulot birligi: "m3" — tayyor beton (saqlanmaydi), boshqasi (dona, m2…) — hovlida turadigan tayyor mahsulot. */
export const unitLabel = (u: string) => (u === "m3" ? "m³" : u);
export const isStocked = (u: string) => u !== "m3";
