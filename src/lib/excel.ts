/**
 * Excel import uchun umumiy yordamchilar (server + client).
 * Excel'dagi ustun nomlari turlicha bo'ladi (o'zbek/rus/ingliz) — `guessColumn` sarlavha bo'yicha taxmin qiladi,
 * foydalanuvchi keyin o'zi to'g'rilaydi. Raqamlar "2,5" / "1 200" ko'rinishida kelishi mumkin — `num` tozalaydi.
 */

export type ImportField = { key: string; label: string; required?: boolean; hint?: string; synonyms: readonly string[] };

export const FIELD_SYNONYMS = {
  product: ["mahsulot", "marka", "product", "товар", "марка", "beton", "продукт"],
  material: ["xomashyo", "material", "материал", "сырь", "nomi", "name", "наимен", "tovar", "mahsulot"],
  qty: ["miqdor", "qty", "norma", "колич", "кол-во", "к-во", "кво", "soni", "hajm", "quantity", "amount"],
  price: ["narx", "price", "цена"],
  unit: ["birlik", "unit", "ед.", "ед ", "ед изм", "изм", "o'lchov", "olchov", "o‘lchov", "измер"],
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

/**
 * "1 200,5" → 1200.5; "48,109,286" → 48109286; "1.200.000" → 1200000; bo'sh/xato → NaN.
 * Vergul/nuqta uch xonali guruhlarni ajratsa — mingliklar ajratkichi, aks holda kasr nuqtasi.
 */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  let s = String(v).replace(/[\s\u00a0'`]+/g, "");
  if (s === "") return NaN;
  const hasComma = s.includes(","), hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // oxirgisi kasr ajratkichi: "1.200,50" → 1200.50, "1,200.50" → 1200.50
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    s = s.split(dec === "," ? "." : ",").join("");
    s = s.replace(",", ".");
  } else if (hasComma) {
    // "9,818" → 9818 (minglik), lekin "2,5" va "0,500" → kasr
    s = /^-?[1-9]\d{0,2}(,\d{3})+$/.test(s) ? s.split(",").join("") : s.replace(",", ".");
  } else if (hasDot) {
    // faqat "1.200.000" kabi ikki va undan ko'p guruh minglik; "1.778" — kasr
    if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.split(".").join("");
  }
  return s === "" ? NaN : Number(s);
}

export const str = (v: unknown) => (v == null ? "" : String(v).trim());

/** Nomdan xomashyo kodi: "Sement M400" → "SEMENT-M400" (lotin, 16 belgigacha). */
export function codeFromName(name: string) {
  const s = name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toUpperCase().replace(/[\s_]+/g, "-").slice(0, 16);
  return s || "MAT";
}
