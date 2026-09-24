import { qty } from "@/lib/format";

/** Mahsulot birligi: "m3" — tayyor beton (saqlanmaydi), boshqasi (dona, m2…) — hovlida turadigan tayyor mahsulot. */
export const unitLabel = (u: string) => (u === "m3" ? "m³" : u);
export const isStocked = (u: string) => u !== "m3";

/** Mahsulot birliklari (Sozlamalar → Beton markalari, zayavkadagi mahsulot tanlagichi). */
export const PRODUCT_UNITS: [string, string][] = [
  ["m3", "m³ — tayyor beton"],
  ["dona", "dona — ustun, blok, bordyur"],
  ["m2", "m² — plitka"],
  ["m", "m — pogon"],
  ["t", "t"],
];

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

// ───────────────────────── Zayavka hajmi: birlik bo'yicha ─────────────────────────

export type UnitTotal = { unit: string; qty: number };
/** Hajm hisoblanadigan qator: mahsulot birligi + miqdor (Decimal ham bo'ladi). */
export type UnitRow = { unit: string; qty: number | string | { toString(): string } };

/**
 * Zayavka qatorlarini o'lchov birligi bo'yicha yig'adi.
 *
 * Beton m³ va dona mahsulot bitta songa qo'shilmaydi: 12 m³ beton + 500 dona
 * bordyur — bu "512 m³" emas. Hajm ko'rsatiladigan hamma joy shu funksiyadan
 * o'tadi, shunda zayavka ro'yxatida, kartochkasida va sotuvda bir xil chiqadi.
 */
export function unitTotals(rows: UnitRow[]): UnitTotal[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const u = r.unit || "m3";
    m.set(u, (m.get(u) ?? 0) + Number(r.qty));
  }
  // Beton (m³) birinchi, qolganlari alifbo bo'yicha — tartib qatordan qatorga o'zgarmasin
  return [...m]
    .map(([unit, qty]) => ({ unit, qty }))
    .sort((a, b) => (a.unit === "m3" ? -1 : b.unit === "m3" ? 1 : a.unit.localeCompare(b.unit)));
}

/** Hamma qator bitta birlikda bo'lsa — o'sha birlik, aralash bo'lsa `null`. */
export function soleUnit(rows: UnitRow[]): string | null {
  const t = unitTotals(rows);
  return t.length === 1 ? t[0]!.unit : null;
}

/** "12,5 m³ · 500 dona" — zayavka hajmi birligi bilan; qator bo'lmasa "0". */
export function fmtUnitTotals(rows: UnitRow[]): string {
  const t = unitTotals(rows);
  if (t.length === 0) return "0";
  return t.map((x) => `${qty(x.qty)} ${unitLabel(x.unit)}`).join(" · ");
}

/**
 * Bajarilish ulushi (%) — har birlik alohida hisoblanadi, m³ bilan dona
 * qo'shilmaydi. Aralash zayavkada birliklar o'rtachasi olinadi.
 */
export function donePercent(done: UnitRow[], need: UnitRow[]): number {
  const needT = unitTotals(need);
  if (needT.length === 0) return 0;
  const doneMap = new Map(unitTotals(done).map((d) => [d.unit, d.qty]));
  const sum = needT.reduce((s, n) => s + (n.qty > 0 ? Math.min(1, (doneMap.get(n.unit) ?? 0) / n.qty) : 1), 0);
  return (sum / needT.length) * 100;
}
