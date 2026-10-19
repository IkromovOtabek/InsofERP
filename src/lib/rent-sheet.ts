import { numMoney, str } from "./excel";

/**
 * Arenda Excel varag'ini o'qish qoidalari — sof funksiyalar (bazasiz): import formasi (klient) ham,
 * server (`lib/rent-import.ts`) ham shu fayldan oladi.
 *
 * Sekretarning daftari: har oy alohida varaq («август», «Сентябрь», «Октябрь»), tepada «2026 йил октябрь»,
 * bozor nomi alohida qatorda («Техно сити бозор»), har bozor oxirida «Общий», bo'sh joy — «Буш».
 */

const MONTH_NAMES: [RegExp, number][] = [
  [/^(январ|yanvar|янв)/, 1], [/^(феврал|fevral|фев)/, 2], [/^(март|mart)/, 3], [/^(апрел|aprel|апр)/, 4],
  [/^(май|мая|may)/, 5], [/^(июн|iyun)/, 6], [/^(июл|iyul)/, 7], [/^(август|avgust|авг)/, 8],
  [/^(сентябр|sentyabr|сен)/, 9], [/^(октябр|oktyabr|окт)/, 10], [/^(ноябр|noyabr|ноя)/, 11], [/^(декабр|dekabr|дек)/, 12],
];

function monthOfWord(w: string): number | null {
  const s = w.toLowerCase();
  for (const [re, m] of MONTH_NAMES) if (re.test(s)) return m;
  return null;
}

/**
 * Varaqdan oyni aniqlash: avval jadval tepasidagi «2026 йил октябрь» (yil bilan), bo'lmasa varaq nomi
 * («Октябрь») — yil bugungi kundan: kelajakdagi oy bo'lsa o'tgan yil. Topilmasa — null ("2026-10" ko'rinishida qaytadi).
 */
export function guessRentMonth(sheetName: string, aoa: unknown[][], today = new Date()): string | null {
  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  for (const row of aoa.slice(0, 6)) {
    for (const c of row) {
      const t = str(c);
      const y = /\b(20\d{2})\b/.exec(t);
      if (!y) continue;
      const m = t.split(/[^\p{L}]+/u).map(monthOfWord).find((x) => x != null);
      if (m) return key(Number(y[1]), m);
    }
  }
  const m = sheetName.split(/[^\p{L}]+/u).map(monthOfWord).find((x) => x != null);
  if (!m) return null;
  const y = today.getFullYear(), cur = today.getMonth() + 1;
  return key(m > cur ? y - 1 : y, m);
}

/** Faylda bir nechta varaq bo'lsa — joriy oy nomli varaq, bo'lmasa oxirgi oy nomli varaq, bo'lmasa birinchisi. */
export function pickRentSheet(names: string[], today = new Date()): number {
  const cur = today.getMonth() + 1;
  const months = names.map((n) => n.split(/[^\p{L}]+/u).map(monthOfWord).find((x) => x != null) ?? null);
  const exact = months.findIndex((m) => m === cur);
  if (exact >= 0) return exact;
  for (let i = months.length - 1; i >= 0; i--) if (months[i] != null) return i;
  return 0;
}

/** «Общий» / «Жами» — bozor bo'yicha jami qatori; «Буш» — bo'sh joy. Ikkalasi ham import qilinmaydi. */
// `\b` kirill harflarini so'z deb bilmaydi — so'z oxiri qo'lda tekshiriladi
export const isTotalRow = (name: string) => /^(общий|общая|общее|итого|всего|жами|жаъми|jami|umumiy|умумий)(?=$|[\s.,:;!-])/i.test(name.trim());
export const isEmptySpot = (name: string) => /^(буш|бўш|bo'?sh|bosh|пусто|свободно)\.?$/i.test(name.trim());

/** Pul katagi: bo'sh yoki «-» — 0; raqam emas — NaN (server qator raqami bilan xato beradi). */
export function rentMoney(v: unknown): number {
  const s = str(v);
  if (s === "" || /^[-–—]+$/.test(s)) return 0;
  return numMoney(s);
}
