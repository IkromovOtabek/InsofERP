import { flatName } from "@/lib/excel";
import { toLatin } from "@/lib/translit";

/**
 * Mahsulot nomi qoidalari (server + client, bazasiz). Katalog ifloslanmasin (Sarvar rejasi 1.1, 2026-11-24):
 * bitta mahsulot lotin/kirillda yoki «3,5»/«3.5» bilan ikki marta ochilmasin.
 */

/**
 * Saqlanadigan nom: kirill → lotin, raqamlar orasidagi vergul → nuqta, ortiqcha bo'shliqlar olib tashlanadi.
 * «ПК 59-12-8» → «PK 59-12-8», «Beton м 350» → «Beton m 350», «Opora sv 950-2,5» → «Opora sv 950-2.5».
 */
export function normalizeProductName(name: string): string {
  return toLatin(String(name ?? "").normalize("NFKC"))
    .replace(/(\d)\s*,\s*(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Takror kaliti: normallashgan nom, katta-kichik harf, bo'shliq va belgilarsiz («PK 59-12-8» = «ПК 59-12-8» = «pk59128»). */
export const productNameKey = (name: string) => flatName(normalizeProductName(name));

/** Mahsulot (asosiy nomi yoki boshqa nomlaridan biri) shu kalitga mos keladimi. */
export const productMatchesKey = (p: { name: string; aliases?: string[] | null }, key: string) =>
  !!key && (productNameKey(p.name) === key || (p.aliases ?? []).some((a) => productNameKey(a) === key));

/**
 * Nom o'zgarganda boshqa nomlar: eski nom qo'shiladi (kalit o'zgargan bo'lsa — bo'shliq tuzatishi emas), yangi nomga
 * teng alias olib tashlanadi. «PK 59-12-8» → «PK 59-12-8 A 400»: importda eski nom ham shu mahsulotga tushadi.
 */
export function aliasesAfterRename(oldName: string, aliases: readonly string[], newName: string): string[] {
  const oldKey = productNameKey(oldName), newKey = productNameKey(newName);
  const out = aliases.filter((a) => productNameKey(a) !== newKey);
  if (oldKey && oldKey !== newKey && !out.some((a) => productNameKey(a) === oldKey)) out.push(oldName);
  return out;
}

/** Majburiy yuqori papkalar (Sarvar rejasi): mahsulot shu papkalardan birida turadi. */
export const PRODUCT_ROOT_GROUPS = ["Plita", "Beton", "Kolso", "Opora", "FBS", "Krishka/Dnishka", "Xomashyo sotuvi"] as const;
/** Taxmin topilmasa — haqiqatan boshqa narsa uchun. */
export const OTHER_PRODUCT_GROUP = "Boshqalar";

/**
 * Nomdan yuqori papka taxmini (import katalogda yo'q nomni ochganda): «PK 59-12-8» → Plita, «Beton m 250» → Beton,
 * «Kolso 1(90)» → Kolso, «Opora sv 950-2.5» → Opora. `materialNames` — xomashyo nomi bo'lsa (Sheben, Qum…) «Xomashyo sotuvi».
 * Tanilmasa `null`.
 */
export function guessProductGroup(name: string, materialNames: readonly string[] = []): string | null {
  const n = normalizeProductName(name).toLowerCase();
  if (/^(pk|pb|plita)\b|^pk\d/.test(n)) return "Plita";
  // Faqat beton markasi («Beton m 250», «Beton M300 (B22.5)», «B250», «M300») — «Beton ustun» kabi buyum emas
  if (/^beton\s*[mb]?\s*\d|^beton$|^b\s?\d{2,3}\b|^m\s?\d{3}\b/.test(n)) return "Beton";
  if (/^(kolso|kolco|halqa|kc)\b/.test(n)) return "Kolso";
  if (/^opora\b/.test(n)) return "Opora";
  if (/^fbs\b|^fbs\d/.test(n)) return "FBS";
  if (/^(krishka|kryshka|qopqoq|dnishka|dnishe|dnisha|plita dnisha)\b/.test(n)) return "Krishka/Dnishka";
  const key = productNameKey(name);
  if (key && !/\d/.test(key) && materialNames.some((m) => { const mk = productNameKey(m); return mk === key || mk.startsWith(key) || key.startsWith(mk); })) return "Xomashyo sotuvi";
  return null;
}
