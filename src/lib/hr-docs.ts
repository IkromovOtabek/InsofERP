import type { HrDocKind } from "@/generated/prisma";

/**
 * Otdel kadr shakllari — qog'ozda yuritiladigan yetti hujjat tizimda to'ldiriladi,
 * chop etiladi va imzolangandan keyin nusxasi shu yozuvga qaytib yuklanadi.
 *
 * Hujjat matni chop etish sahifasida (`employees/[id]/hujjat/chop/[slug]`), bu yerda —
 * ro'yxat, tartib va har bir hujjat qaysi maydonlarni so'rashi.
 */

/** Hujjat tayyorlashda formada ko'rsatiladigan maydonlar. */
export type HrDocField = "effectiveAt" | "position" | "salary" | "term" | "no" | "reason";

export type HrDocSpec = {
  kind: HrDocKind;
  /** URL bo'lagi — /employees/[id]/hujjat/chop/[slug] */
  slug: string;
  label: string;
  /** Kartada tagida chiqadigan bir qatorli izoh */
  hint: string;
  /** Ishga qabul to'plamiga kiradimi (bo'shatish hujjati kirmaydi) */
  hiring: boolean;
  fields: HrDocField[];
};

/** Qog'ozdagi papka tartibi: ariza → anketa → shartnoma → tilxat → javobgarlik → buyruq → bo'shatish. */
export const HR_DOCS: HrDocSpec[] = [
  {
    kind: "ARIZA",
    slug: "ariza",
    label: "Ariza (ishga qabul qilish)",
    hint: "Xodim direktor nomiga yozadigan ishga qabul qilish arizasi",
    hiring: true,
    fields: ["effectiveAt", "position"],
  },
  {
    kind: "ANKETA",
    slug: "anketa",
    label: "Insof anketasi (shaxsiy varaqa)",
    hint: "Shaxsiy varaqa — kartadagi ma'lumotlar bilan to'ldirilib chiqadi",
    hiring: true,
    fields: [],
  },
  {
    kind: "SHARTNOMA",
    slug: "shartnoma",
    label: "Mehnat shartnomasi",
    hint: "To'liq matn: tomonlar huquqi, ish vaqti, ta'til, javobgarlik",
    hiring: true,
    fields: ["effectiveAt", "position", "salary", "term"],
  },
  {
    kind: "TILXAT",
    slug: "tilxat",
    label: "Tilxat",
    hint: "Ichki tartib va texnika xavfsizligi bo'yicha 21 ta majburiyat",
    hiring: true,
    fields: [],
  },
  {
    kind: "JAVOBGARLIK",
    slug: "javobgarlik",
    label: "To'liq moddiy javobgarlik shartnomasi",
    hint: "Mehnat kodeksining 337–343-moddalari asosida",
    hiring: true,
    fields: [],
  },
  {
    kind: "BUYRUQ",
    slug: "buyruq",
    label: "Buyruq (ishga qabul qilish)",
    hint: "Korxona blankasida, raqamlanadigan buyruq",
    hiring: true,
    fields: ["no", "effectiveAt", "position"],
  },
  {
    kind: "BOSHATISH",
    slug: "boshatish",
    label: "Bo'shatish arizasi",
    hint: "O'z xohishi bilan ishdan bo'shash haqida ariza",
    hiring: false,
    fields: ["effectiveAt", "reason"],
  },
];

export const HR_DOC_BY_SLUG = new Map(HR_DOCS.map((d) => [d.slug, d]));
export const HR_DOC_BY_KIND = new Map(HR_DOCS.map((d) => [d.kind, d]));

/** Ishga qabul to'plami — bitta bosishda tayyorlanadigan va ketma-ket chop etiladigan hujjatlar. */
export const HIRING_SLUG = "toplam";
export const HIRING_DOCS = HR_DOCS.filter((d) => d.hiring);

export const hrDocLabel = (kind: HrDocKind) => HR_DOC_BY_KIND.get(kind)?.label ?? kind;

/**
 * Buyruq raqami korxonada yildan yilga davom etadi (…, №215 K, №216 K).
 * Shu yildagi eng katta raqamdan keyingisini taklif qiladi; birinchi marta 1 dan boshlanadi.
 */
export function nextOrderNo(used: (string | null)[]): string {
  const max = used.reduce((m, v) => {
    const n = Number(String(v ?? "").match(/\d+/)?.[0] ?? 0);
    return n > m ? n : m;
  }, 0);
  return `${max + 1} K`;
}

// ───────────────────────── Chop etish uchun matn yordamchilari ─────────────────────────

const MONTHS_CYR = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_LAT = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

const pad = (n: number) => String(n).padStart(2, "0");

/** «10.09.2026» — shakllardagi qisqa sana. */
export const docDate = (d?: Date | null) => (d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : "____.____.________");

/** «10» СЕНТЯБРЬ 2026 й. — buyruq blankasi uchun. */
export const docDateCyr = (d?: Date | null) =>
  d ? `«${pad(d.getDate())}» ${MONTHS_CYR[d.getMonth()].toUpperCase()} ${d.getFullYear()} й.` : "«___» ____________ 20___ й.";

/** «10» sentabr 2026 yil — lotin shakllari uchun. */
export const docDateLat = (d?: Date | null) =>
  d ? `«${pad(d.getDate())}» ${MONTHS_LAT[d.getMonth()]} ${d.getFullYear()} yil` : "«___» ____________ 20___ yil";

/**
 * Manzildan hududni ajratadi: «702842, Toshkent viloyati, Yangiyo'l tumani, …» →
 * «Toshkent viloyati Yangiyo'l tumani». Ariza sarlavhasida shu qator turadi.
 */
export function regionLine(address?: string | null): string {
  const parts = (address ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^\d+$/.test(p));
  const viloyat = parts.find((p) => /viloyat|shahri|shahar/i.test(p));
  const tuman = parts.find((p) => /tuman/i.test(p));
  return [viloyat, tuman].filter(Boolean).join(" ") || "Toshkent viloyati Yangiyo'l tumani";
}

/**
 * «Ruzibayev A.A» — familiya va ikkita bosh harf. Otasining ismiga qo'shiladigan
 * «o'g'li» / «qizi» alohida bosh harf bo'lib chiqmaydi.
 */
export function shortName(full?: string | null): string {
  const parts = (full ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => w && !/^(o[`'’]?g[`'’]?li|qizi|ugli|o[`'’]?gli)$/i.test(w));
  if (parts.length === 0) return "____________";
  const [family, ...rest] = parts;
  if (rest.length === 0) return family;
  return `${family} ${rest.slice(0, 2).map((x) => x[0].toUpperCase() + ".").join("")}`;
}
