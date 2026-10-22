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

// ───────────────────────── Ruscha (ijara shartnomasining ruscha nusxasi) ─────────────────────────

const RU_ONES = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const RU_ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const RU_TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const RU_TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const RU_HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
/** [1, 2–4, 5+] шакллари; тысяча — женский род */
const RU_SCALES: [string, string, string, boolean][] = [["", "", "", false], ["тысяча", "тысячи", "тысяч", true], ["миллион", "миллиона", "миллионов", false], ["миллиард", "миллиарда", "миллиардов", false], ["триллион", "триллиона", "триллионов", false]];

function ruTriple(n: number, fem: boolean): string {
  const h = Math.floor(n / 100), rest = n % 100, t = Math.floor(rest / 10), o = n % 10;
  const ones = fem ? RU_ONES_F : RU_ONES;
  return [RU_HUNDREDS[h], rest >= 10 && rest < 20 ? RU_TEENS[rest - 10] : [RU_TENS[t], ones[o]].filter(Boolean).join(" ")].filter(Boolean).join(" ");
}

function ruForm(n: number, forms: [string, string, string]): string {
  const d = n % 100, o = n % 10;
  if (d >= 11 && d <= 14) return forms[2];
  return o === 1 ? forms[0] : o >= 2 && o <= 4 ? forms[1] : forms[2];
}

/** Summani ruscha so'z bilan: 3 000 000 → «три миллиона». Faqat butun qism. */
export function numWordsRu(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "ноль";
  const parts: string[] = [];
  for (let i = 0; n > 0 && i < RU_SCALES.length; i++, n = Math.floor(n / 1000)) {
    const t = n % 1000;
    if (!t) continue;
    const [f1, f2, f5, fem] = RU_SCALES[i];
    parts.unshift([ruTriple(t, fem), i ? ruForm(t, [f1, f2, f5]) : ""].filter(Boolean).join(" "));
  }
  return (value < 0 ? "минус " : "") + parts.join(" ");
}
