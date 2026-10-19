/**
 * Summani o'zbekcha so'z bilan yozish (kvitansiya, to'lov hujjati): 1 500 000 → «bir million besh yuz ming».
 * Faqat butun qism; tiyin kerak bo'lsa chaqiruvchi alohida qo'shadi.
 */
const ONES = ["", "bir", "ikki", "uch", "to'rt", "besh", "olti", "yetti", "sakkiz", "to'qqiz"];
const TENS = ["", "o'n", "yigirma", "o'ttiz", "qirq", "ellik", "oltmish", "yetmish", "sakson", "to'qson"];
const SCALES = ["", "ming", "million", "milliard", "trillion"];

function triple(n: number): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  return [h ? `${ONES[h]} yuz` : "", TENS[t], ONES[o]].filter(Boolean).join(" ");
}

export function numWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "nol";
  const parts: string[] = [];
  for (let i = 0; n > 0 && i < SCALES.length; i++, n = Math.floor(n / 1000)) {
    const t = n % 1000;
    if (t) parts.unshift([triple(t), SCALES[i]].filter(Boolean).join(" "));
  }
  return (value < 0 ? "minus " : "") + parts.join(" ");
}
