/**
 * O'zbek lotin yozuvidan kirill yozuviga transliteratsiya (rasmiy qoidalar asosida).
 *
 * Qoidalar:
 *  · o' → ў, g' → ғ (apostrofning har xil shakllari: ' ʻ ‘ ’ ` ʼ);
 *  · sh → ш, ch → ч, s'h → сҳ (Is'hoq → Исҳоқ);
 *  · yo → ё, yu → ю, ya → я, ye → е; "yo'" → йў (y alohida, o' — ў);
 *  · e so'z boshida yoki unlidan keyin → э, qolgan hollarda → е;
 *  · harflar orasidagi tutuq belgisi → ъ (ma'lumot → маълумот);
 *  · x → х, q → қ, h → ҳ, j → ж, c → ц, w → в;
 *  · "-tsiya" → "-ция", obyekt/subyekt/podyezd → ъе.
 * Katta-kichik harf saqlanadi: Sh/SH/sh → Ш/Ш/ш.
 *
 * O'zgartirilmaydi: raqam aralash kodlar (Z-2026-00153, B25, M300, 01A123BC),
 * email, URL, login (test.direktor), identifikatorlar (snake_case, camelCase),
 * texnik qisqartmalar (PDF, QR, SMS ...) va avtomobil raqami bo'laklari ("01 A 123 BC").
 */

const APOS = new Set(["'", "ʻ", "‘", "’", "`", "ʼ"]);
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

const SINGLE: Record<string, string> = {
  a: "а", b: "б", c: "ц", d: "д", e: "е", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж",
  k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "қ", r: "р", s: "с", t: "т",
  u: "у", v: "в", w: "в", x: "х", y: "й", z: "з",
};
const Y_VOWEL: Record<string, string> = { o: "ё", u: "ю", a: "я", e: "е" };

/** Lotinda yumshatish belgisi (ь) tushib qolgan so'zlar — butun so'z sifatida */
const EXCEPTIONS: Record<string, string> = {
  yanvar: "январь", fevral: "февраль", aprel: "апрель", iyun: "июнь", iyul: "июль",
  sentyabr: "сентябрь", oktyabr: "октябрь", sentabr: "сентябрь", oktabr: "октябрь", noyabr: "ноябрь", dekabr: "декабрь",
  rol: "роль", model: "модель", avtomobil: "автомобиль", dizel: "дизель", mebel: "мебель",
  kalkulyator: "калькулятор", fakultet: "факультет",
};

/** Aralash registrli tashkiliy-huquqiy shakllar (camelCase qoidasidan oldin) */
const ABBR: Record<string, string> = { MChJ: "МЧЖ", YaTT: "ЯТТ", XK: "ХК", AJ: "АЖ", QK: "ҚК", OAJ: "ОАЖ", DUK: "ДУК" };
const ABBR_RE = /^([^A-Za-z]*)(MChJ|YaTT|XK|AJ|QK|OAJ|DUK)([^A-Za-z]*)$/;

/** Lotinda qoladigan texnik so'zlar va qisqartmalar */
const KEEP = new Set([
  "QR", "PDF", "SMS", "ERP", "API", "GPS", "URL", "ID", "AI", "OK", "PIN", "CRM", "BI", "KPI", "IT",
  "JSON", "CSV", "XLSX", "XLS", "HTML", "CSS", "USB", "IP", "OTP", "APK", "UZS", "USD", "EUR", "RUB",
  "IOS", "ANDROID", "IPHONE", "EXCEL", "WORD", "GOOGLE", "YANDEX", "PAYME", "CLICK", "WI-FI", "WIFI",
  "PWA", "SSO", "WEB", "PUSH", "OSRM",
]);

const isLatin = (ch: string | undefined) => !!ch && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"));
const isUpper = (ch: string) => ch !== ch.toLowerCase();
const up = (s: string, upper: boolean) => (upper ? s.toUpperCase() : s);

/** Bitta so'z (faqat lotin harflari va apostroflar) */
function convertWord(w: string): string {
  const core = w.replace(/['ʻ‘’`ʼ]+$/, "");
  // Chiziqcha bilan qo'shilgan qisqartma: "QR-nakladnoy" → "QR-накладной"
  if (core === core.toUpperCase() && KEEP.has(core)) return w;
  const exc = EXCEPTIONS[core.toLowerCase()];
  if (exc) {
    const tail = w.slice(core.length);
    const allUp = core.length > 1 && core === core.toUpperCase();
    const res = allUp ? exc.toUpperCase() : isUpper(core[0]) ? exc[0].toUpperCase() + exc.slice(1) : exc;
    return res + tail;
  }

  let out = "";
  const n = w.length;
  for (let i = 0; i < n; i++) {
    const c = w[i];
    const lc = c.toLowerCase();
    const nx = w[i + 1];
    const nl = nx?.toLowerCase();
    const U = isUpper(c);

    if (APOS.has(c)) {
      // Tutuq belgisi faqat ikki harf orasida → ъ; aks holda (qo'shtirnoq) o'zicha
      out += isLatin(w[i - 1]) && isLatin(nx) ? up("ъ", isUpper(w[i - 1]) && isUpper(nx)) : c;
      continue;
    }
    if (lc === "o" && nx && APOS.has(nx)) { out += up("ў", U); i++; continue; }
    if (lc === "g" && nx && APOS.has(nx)) { out += up("ғ", U); i++; continue; }
    if (lc === "s" && nx && APOS.has(nx) && w[i + 2]?.toLowerCase() === "h") {
      out += up("с", U) + up("ҳ", isUpper(w[i + 2])); i += 2; continue;
    }
    if (lc === "s" && nl === "h") { out += up("ш", U); i++; continue; }
    if (lc === "c" && nl === "h") { out += up("ч", U); i++; continue; }
    if (lc === "t" && nl === "s" && w.slice(i + 2, i + 5).toLowerCase() === "iya") { out += up("ц", U); i++; continue; }
    if (lc === "y" && nl) {
      // "yo'" → й + ў
      if (nl === "o" && APOS.has(w[i + 2] ?? "")) { out += up("й", U); continue; }
      const v = Y_VOWEL[nl];
      if (v) {
        const prev = w[i - 1]?.toLowerCase();
        // obyekt → объект, podyezd → подъезд
        const hard = nl === "e" && (prev === "b" || prev === "d") ? up("ъ", U) : "";
        out += hard + up(v, U);
        i++;
        continue;
      }
    }
    if (lc === "e") {
      const prev = w[i - 1];
      const start = !isLatin(prev) && !APOS.has(prev ?? "");
      out += up(start || VOWELS.has(prev.toLowerCase()) ? "э" : "е", U);
      continue;
    }
    const m = SINGLE[lc];
    out += m ? up(m, U) : c;
  }
  return out;
}

const WORD_RE = /[A-Za-z][A-Za-z'ʻ‘’`ʼ]*/g;
const ORDINAL_RE = /^[^A-Za-z\d]*\d+-[a-z'ʻ‘’`ʼ]+[^A-Za-z\d]*$/; // 2026-yil, 3-sex
const PLATE_PART = /^[A-Z]{1,3}$/;
const PLATE_NUM = /^\d{2,3}$/;

/** Bo'shliq bilan ajratilgan bo'lak lotinda qolishi kerakmi */
function keepToken(t: string): boolean {
  if (/@|:\/\/|^www\./i.test(t)) return true; // email, URL
  if (/[A-Za-z]\.[A-Za-z]/.test(t)) return true; // login, domen
  if (t.includes("_")) return true; // identifikator
  if (/[a-z][A-Z]/.test(t)) return true; // camelCase, iPhone
  if (/\d/.test(t) && !ORDINAL_RE.test(t)) return true; // hujjat raqami, marka, avto raqam
  const bare = t.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toUpperCase();
  return KEEP.has(bare);
}

const cache = new Map<string, string>();
const CACHE_MAX = 50000;

/** Matnni kirillga o'tkazadi (natija keshlanadi — katta jadvallar uchun) */
export function toCyrillic(text: string): string {
  if (!text || !/[A-Za-z]/.test(text)) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;

  const parts = text.split(/(\s+)/);
  for (let j = 0; j < parts.length; j += 2) {
    const t = parts[j];
    if (!t || !/[A-Za-z]/.test(t)) continue;
    const ab = ABBR_RE.exec(t);
    if (ab) { parts[j] = ab[1] + ABBR[ab[2]] + ab[3]; continue; }
    if (keepToken(t)) continue;
    // "01 A 123 BC" — raqam yonidagi 1–3 katta harf avtomobil raqamining bo'lagi
    if (PLATE_PART.test(t) && (PLATE_NUM.test(parts[j - 2] ?? "") || PLATE_NUM.test(parts[j + 2] ?? ""))) continue;
    parts[j] = t.replace(WORD_RE, convertWord);
  }
  const res = parts.join("");

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(text, res);
  return res;
}

export type Yozuv = "lotin" | "kiril";
export const YOZUV_COOKIE = "yozuv";

/**
 * <head> uchun: cookie kirill bo'lsa birinchi bo'yoqdan oldin `data-yozuv` qo'yiladi va
 * body qisqa vaqt yashiriladi (lotin matn "lip" etib ko'rinmasligi uchun). Birinchi o'tish
 * tugaganda yoki eng ko'pi DOMContentLoaded'dan 250 ms keyin ochiladi.
 */
export const YOZUV_SCRIPT = `(function(){try{var d=document.documentElement;if(/(?:^|;\\s*)${YOZUV_COOKIE}=kiril(?:;|$)/.test(document.cookie)){d.setAttribute("data-yozuv","kiril");d.lang="uz-Cyrl";d.classList.add("yozuv-wait");var f=function(){setTimeout(function(){d.classList.remove("yozuv-wait")},250)};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",f);else f()}}catch(e){}})();`;
export const YOZUV_STYLE = "html.yozuv-wait body{visibility:hidden}";
