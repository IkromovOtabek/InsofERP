/** Mahsulot birligi: "m3" — tayyor beton (saqlanmaydi), boshqasi (dona, m2…) — hovlida turadigan tayyor mahsulot. */
export const unitLabel = (u: string) => (u === "m3" ? "m³" : u);
export const isStocked = (u: string) => u !== "m3";

/** Xomashyo birliklari (Sklad → Xomashyo qo'shish, Sozlamalar). */
export const MATERIAL_UNITS = ["kg", "t", "l", "m3", "dona", "m", "m2"] as const;

export type MaterialUnit = (typeof MATERIAL_UNITS)[number];

/**
 * Excel fayllarda birlik turlicha yoziladi: "letr", "litir", "тн", "М3", "metir", "pachka"…
 * Shu sinonimlarni kanonik birlikka keltiradi; tanilmasa `null` (import to'xtamaydi — `UNIT_FALLBACK` olinadi).
 */
const UNIT_ALIASES: Record<string, MaterialUnit> = {
  // litr
  l: "l", lt: "l", litr: "l", litre: "l", liter: "l", litir: "l", letr: "l", letir: "l", leter: "l", let: "l", "л": "l", "литр": "l", "л-р": "l",
  // kilogramm
  kg: "kg", kgr: "kg", kilo: "kg", kilogramm: "kg", "кг": "kg", "кило": "kg", "килограмм": "kg",
  // tonna
  t: "t", tn: "t", ton: "t", tona: "t", tonna: "t", "т": "t", "тн": "t", "тона": "t", "тонна": "t",
  // kub metr
  m3: "m3", "m³": "m3", kub: "m3", kubmetr: "m3", "м3": "m3", "м³": "m3", "куб": "m3", "кубм": "m3",
  // kvadrat metr
  m2: "m2", "m²": "m2", kvmetr: "m2", "м2": "m2", "м²": "m2", "кв": "m2", "квм": "m2",
  // metr
  m: "m", mr: "m", met: "m", meri: "m", metr: "m", metir: "m", metre: "m", meter: "m", pm: "m", "м": "m", "метр": "m", "пм": "m", "мп": "m",
  // dona va sanaladigan qadoqlar (pachka, blok, rulon, qop) — hammasi dona
  dona: "dona", don: "dona", ta: "dona", db: "dona", pcs: "dona", pc: "dona", kompl: "dona", komplekt: "dona",
  "шт": "dona", "штук": "dona", "штука": "dona", "дона": "dona", "компл": "dona",
  pachka: "dona", pochka: "dona", poch: "dona", pack: "dona", "пачка": "dona",
  blok: "dona", bliok: "dona", bilok: "dona", "блок": "dona",
  rulon: "dona", "рулон": "dona", qop: "dona", "мешок": "dona", "меш": "dona",
};

/** Birlik matnini kanonik ko'rinishga keltiradi ("letr" → "l", "ТН" → "t"); tanilmasa `null`. */
export function normalizeUnit(v: unknown): MaterialUnit | null {
  const k = String(v ?? "").toLowerCase().replace(/[\s.()]+/g, "");
  if (!k) return null;
  return UNIT_ALIASES[k] ?? ((MATERIAL_UNITS as readonly string[]).includes(k) ? (k as MaterialUnit) : null);
}

/** Birlik tanilmaganda import to'xtamasin — shu birlik qo'yiladi (keyin Sozlamalardan tuzatiladi). */
export const UNIT_FALLBACK: MaterialUnit = "dona";
