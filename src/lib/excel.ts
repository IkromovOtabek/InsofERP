/**
 * Excel import uchun umumiy yordamchilar (server + client).
 * Excel'dagi ustun nomlari turlicha bo'ladi (o'zbek/rus/ingliz) — `guessColumn` sarlavha bo'yicha taxmin qiladi,
 * foydalanuvchi keyin o'zi to'g'rilaydi. Raqamlar "2,5" / "1 200" ko'rinishida kelishi mumkin — `num` tozalaydi.
 */

export type ImportField = { key: string; label: string; required?: boolean; hint?: string; synonyms: readonly string[] };

export const FIELD_SYNONYMS = {
  product: ["mahsulot", "marka", "product", "товар", "марка", "beton", "продукт"],
  material: ["xomashyo", "material", "материал", "сырь", "nomi", "name", "наимен", "tovar", "mahsulot"],
  qty: ["miqdor", "qty", "norma", "колич", "кол-во", "soni", "hajm", "quantity", "amount"],
  price: ["narx", "price", "цена"],
  unit: ["birlik", "unit", "ед.", "ед ", "o'lchov", "olchov", "измер"],
  nds: ["nds", "ндс", "qqs", "soliq", "vat", "tax", "налог"],
  sum: ["summa", "сумма", "jami", "itogo", "итого", "total", "stoimost", "стоимость"],
} as const;

/** Sarlavhalar orasidan maydonga mos ustunni topadi (kichik harf, qism mosligi). */
export function guessColumn(headers: string[], synonyms: readonly string[], taken: Set<string>): string | "" {
  const lc = headers.map((h) => h.toLowerCase());
  for (const syn of synonyms) {
    const i = lc.findIndex((h, idx) => h.includes(syn) && !taken.has(headers[idx]));
    if (i >= 0) return headers[i];
  }
  return "";
}

/** "1 200,5" → 1200.5; bo'sh/xato → NaN. */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  const s = String(v).replace(/\s+/g, "").replace(",", ".");
  return s === "" ? NaN : Number(s);
}

export const str = (v: unknown) => (v == null ? "" : String(v).trim());

/** Nomdan xomashyo kodi: "Sement M400" → "SEMENT-M400" (lotin, 16 belgigacha). */
export function codeFromName(name: string) {
  const s = name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toUpperCase().replace(/[\s_]+/g, "-").slice(0, 16);
  return s || "MAT";
}
