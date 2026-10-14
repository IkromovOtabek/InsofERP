/** Sayt SEO sahifalari tillari: `uz` — asosiy (lotin), `ru` — qidiruv uchun (/ru/...). */
export type Lang = "uz" | "ru";
export type L<T = string> = Record<Lang, T>;

/** Korxona nomini matnga qo'yadi */
export const brand = (text: string, name: string) => text.replaceAll("{brand}", name);

/** O'zbek sahifada GOST belgilari lotinda: ФБС → FBS, ПК → PK, М400 → M400 */
const LATIN: [RegExp, string][] = [
  [/ФБС/g, "FBS"], [/ПК/g, "PK"], [/ГОСТ/g, "GOST"], [/ЖБИ/g, "TBB"], [/КС/g, "KS"], [/БР/g, "BR"], [/ПБ/g, "PB"],
  [/М(?=\d)/g, "M"], [/М · B/g, "M · B"], [/^Щ$/g, "Sh"], [/^П$/g, "Q"], [/м³/g, "m³"], [/(\d) м(?![а-яё])/g, "$1 m"],
];
export function code(lang: Lang, s: string): string {
  return lang === "uz" ? LATIN.reduce((acc, [re, to]) => acc.replace(re, to), s) : s;
}

/** Sahifa yo'llari (ikki til juftligi — hreflang uchun) */
export const productPath = (lang: Lang, slug: string) => (lang === "uz" ? `/mahsulot/${slug}` : `/ru/produkciya/${slug}`);
export const articlePath = (lang: Lang, slug?: string) => (lang === "uz" ? `/maqolalar${slug ? `/${slug}` : ""}` : `/ru/stati${slug ? `/${slug}` : ""}`);
