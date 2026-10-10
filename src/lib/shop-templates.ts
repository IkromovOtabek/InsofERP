/**
 * E-commerce shablon suratlari — mahsulot turlari uchun tayyor rasmlar (`public/shop-templates/<key>.webp`,
 * chizish: `scripts/shop-templates.ts`). Vitrinada mahsulotga surat yuklash o'rniga shablon tanlanadi; tanlangan fayl
 * `uploads/shop` ga nusxalanadi, ya'ni oddiy yuklangan surat kabi ishlaydi (ilova, o'chirish, tarix).
 * Bu fayl brauzerga ham tushadi — fs importi yo'q.
 */

export type ShopTemplate = {
  key: string;
  label: string;
  /** Mahsulot nomi/kodida shu so'zlardan biri bo'lsa — shablon tavsiya qilinadi (kichik harf, lotin). */
  match: string[];
};

export const SHOP_TEMPLATES: ShopTemplate[] = [
  { key: "beton", label: "Tayyor beton", match: ["beton m", "бетон", "m100", "m150", "m200", "m250", "m300", "m350", "m400", "m450", "m500"] },
  { key: "qorishma", label: "Qorishma", match: ["qorishma", "rastvor", "раствор", "suvoq", "terish"] },
  { key: "ustun", label: "Ustun", match: ["ustun", "stolb", "столб", "kolonna", "колонна"] },
  { key: "fbs", label: "FBS blok", match: ["fbs", "фбс", "poydevor blok"] },
  { key: "kovak-plita", label: "Kovak plita", match: ["kovak plita", "pk ", "пк ", "plita perekr", "yopma plita", "pustotn"] },
  { key: "bordyur", label: "Bordyur", match: ["bordyur", "бордюр", "br 100.30"] },
  { key: "bog-bordyuri", label: "Bog' bordyuri", match: ["bog' bordyur", "bog bordyur", "br 100.20"] },
  { key: "trotuar-plitka", label: "Trotuar plitkasi", match: ["trotuar", "plitka", "плитка"] },
  { key: "brusschatka", label: "Brusschatka", match: ["brusschatka", "брусчатка", "bruschatka"] },
  { key: "quduq-halqasi", label: "Quduq halqasi", match: ["halqa", "kolso", "кольцо", "ks "] },
  { key: "quduq-qopqogi", label: "Quduq qopqog'i", match: ["qopqog", "qopqoq", "1pp", "pp 10", "крышка"] },
  { key: "gazoblok", label: "Gazoblok", match: ["gazoblok", "газоблок", "gazobeton", "газобетон"] },
  { key: "keramzitoblok", label: "Keramzitoblok", match: ["keramzit", "керамзит"] },
  { key: "beton-blok", label: "Beton blok", match: ["beton blok", "shlakoblok", "шлакоблок", "kovak blok"] },
  { key: "svaya", label: "Svaya", match: ["svaya", "свая", "qoziq"] },
  { key: "peremichka", label: "Peremichka", match: ["peremichka", "перемычка", "pb "] },
  { key: "lotok", label: "Lotok", match: ["lotok", "лоток", "ariq"] },
];

const BY_KEY = new Map(SHOP_TEMPLATES.map((t) => [t.key, t]));

export const shopTemplate = (key: unknown): ShopTemplate | null => (typeof key === "string" && BY_KEY.get(key)) || null;

/** Shablon rasmining ommaviy manzili (Next `public/`). */
export const shopTemplateUrl = (key: string) => `/shop-templates/${key}.webp`;

/**
 * Mahsulot nomi/kodiga eng mos shablon. Uzunroq (aniqroq) moslik ustun: "Bog' bordyuri" → bog-bordyuri, "Bordyur" emas;
 * "Beton blok" → beton-blok, "Beton M300" emas. Birlik m³ va hech narsa topilmasa — tayyor beton.
 */
export function suggestShopTemplate(p: { name: string; code?: string | null; unit?: string | null }): string | null {
  const hay = ` ${p.name} ${p.code ?? ""} `.toLowerCase().replace(/[‘’ʻʼ`]/g, "'").replace(/\s+/g, " ");
  let best: { key: string; len: number } | null = null;
  for (const t of SHOP_TEMPLATES) for (const m of t.match) {
    if (hay.includes(m) && (!best || m.length > best.len)) best = { key: t.key, len: m.length };
  }
  if (best) return best.key;
  return p.unit === "m3" ? "beton" : null;
}
