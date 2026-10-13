/**
 * O'zbekcha (lotin) UI matnini ruschaga lug'at bo'yicha o'girish — tizim matni kodda o'zbekcha yozilgan,
 * rus tili shu matn ustidan qo'yiladi (gettext uslubi: kalit — o'zbekcha matnning o'zi).
 *
 * Ikki joyda: vebda DOM matn tugunlari (`components/script-provider.tsx`, «Рус» rejimi) va ECO ilovasida —
 * shu faylning nusxasi (`InsofECO/apps/mobile/src/core/ru-translate.ts`, `Txt`/`Input`/`Button` matni,
 * serverdan kelgani ham). O'zgarsa ikkalasini birga yangilang.
 *
 * Lug'at (`src/i18n/ru.json`): `e` — aniq matnlar, `t` — shablonlar ("{0} ta zayavka" → "заявок: {0}").
 * Qidiruv tartibi: aniq → oxiridagi ":" / "*" / "…" siz → shablon. Shablon o'rniga tushgan bo'laklar ham
 * qayta o'giriladi ("Holat: {0}" + "Bekor qilindi" → "Статус: Отменено"). Topilmasa — matn o'zgarmaydi.
 * Lug'atni yangilash: `scripts/i18n-extract.ts ... --missing src/i18n/ru.json` (yangi matnlar) → tarjima →
 * `scripts/i18n-merge.ts <bo'laklar> --eco ../InsofECO/apps/mobile/src/core/ru.json`.
 */
export type RuDict = { e: Record<string, string>; t: [string, string][] };

/** Tutuq belgisining har xil shakllari va bo'shliqlar — kalit bir xil bo'lsin. */
export const normKey = (s: string) => s.replace(/[ʻ‘’`ʼ]/g, "'").replace(/\s+/g, " ").trim();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TAIL = /^(.*?)(\s*(?::|\*|…|\.\.\.|!|\?)\s*)$/s;

type Pattern = { re: RegExp; out: string; slots: number[]; anchor: string; weight: number; seps: string };

/** Qatorni bo'laklarga ajratuvchi belgilar: o'rniga tushgan qiymatda bo'lsa, shablon shu belgini o'zi tutishi kerak. */
const SEPS = ["·", "—", ";", "|", "\n"];
const SPLIT = [" · ", " — ", "; ", " | "];

// ── Sana va son birliklari (Intl'siz formatlash: "29-sentabr, seshanba", "2,4 mlrd", "5 dona") ──
const MONTH: Record<string, [string, string]> = {
  yanvar: ["январь", "января"], fevral: ["февраль", "февраля"], mart: ["март", "марта"], aprel: ["апрель", "апреля"],
  may: ["май", "мая"], iyun: ["июнь", "июня"], iyul: ["июль", "июля"], avgust: ["август", "августа"],
  sentabr: ["сентябрь", "сентября"], sentyabr: ["сентябрь", "сентября"], oktabr: ["октябрь", "октября"], oktyabr: ["октябрь", "октября"],
  noyabr: ["ноябрь", "ноября"], dekabr: ["декабрь", "декабря"],
};
const WORD: Record<string, string> = {
  dushanba: "понедельник", seshanba: "вторник", chorshanba: "среда", payshanba: "четверг", juma: "пятница", shanba: "суббота", yakshanba: "воскресенье",
  dush: "пн", sesh: "вт", chor: "ср", pay: "чт", jum: "пт", shan: "сб", yak: "вс",
  mln: "млн", mlrd: "млрд", ming: "тыс.", "so'm": "сум", dona: "шт.", ta: "шт.", kun: "дн.", soat: "ч", daq: "мин", daqiqa: "мин",
  yil: "г.", oy: "мес.", reys: "рейс.", bugun: "сегодня", kecha: "вчера", ertaga: "завтра",
};
const DATE_RE = /^[\s\d.,:/+\-−–—()%«»']*(?:[a-z']+[\s\d.,:/+\-−–—()%«»']*)+$/i;
/** Faqat raqam + sana/birlik so'zlaridan iborat matn ("29-sentabr, seshanba", "2,4 mlrd so'm"). */
function builtin(text: string): string | null {
  if (!DATE_RE.test(text)) return null;
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (!words.length || !words.every((w) => w in MONTH || w in WORD)) return null;
  return text
    .replace(/(\d{1,2})-([A-Za-z]+)/g, (m, d: string, w: string) => { const mo = MONTH[w.toLowerCase()]; return mo ? `${d} ${mo[1]}` : m; })
    .replace(/[A-Za-z']+/g, (w) => {
      const k = w.toLowerCase();
      const r = MONTH[k]?.[0] ?? WORD[k];
      if (!r) return w;
      const f = w.charAt(0);
      return f === f.toUpperCase() && f !== f.toLowerCase() ? r.charAt(0).toUpperCase() + r.slice(1) : r;
    });
}

export function makeTranslator(dict: RuDict) {
  const exact = new Map<string, string>();
  for (const [k, v] of Object.entries(dict.e)) if (v) exact.set(normKey(k), v);

  // Shablon → RegExp. Bucket — eng uzun doimiy bo'lakning birinchi so'zi bo'yicha (tez saralash)
  const buckets = new Map<string, Pattern[]>();
  for (const [k, v] of dict.t) {
    if (!v) continue;
    const parts = normKey(k).split(/\{(\d+)\}/);
    const slots: number[] = [];
    let src = "^";
    parts.forEach((p, i) => { if (i % 2) { slots.push(Number(p)); src += "(.+?)"; } else src += esc(p); });
    src += "$";
    const lits = parts.filter((_, i) => i % 2 === 0).map((p) => p.trim()).filter((p) => /[A-Za-z]{2,}/.test(p));
    if (!lits.length) continue; // "{0} {1}" kabi — doimiy matnsiz shablon ishlatilmaydi
    const anchor = lits.reduce((a, b) => (b.length > a.length ? b : a));
    const word = anchor.toLowerCase().match(/[a-z'][a-z']*/)?.[0];
    if (!word) continue;
    const literal = parts.filter((_, i) => i % 2 === 0).join("");
    const pat: Pattern = { re: new RegExp(src, "s"), out: v, slots, anchor, weight: lits.join("").length, seps: SEPS.filter((x) => literal.includes(x)).join("") };
    const list = buckets.get(word) ?? [];
    list.push(pat);
    buckets.set(word, list);
  }
  for (const list of buckets.values()) list.sort((a, b) => b.weight - a.weight);

  const cache = new Map<string, string | null>();

  function core(text: string, depth: number): string | null {
    const hit = exact.get(text);
    if (hit !== undefined) return hit;
    // "Izoh:" / "Nomi *" — lug'atda "Izoh" bo'lsa
    const m = TAIL.exec(text);
    if (m && m[1]) { const h = exact.get(m[1]); if (h !== undefined) return h + m[2]; }
    if (depth > 3 || !/[A-Za-z]{2,}/.test(text)) return null;
    const b = builtin(text);
    if (b !== null) return b;
    const words = new Set(text.toLowerCase().match(/[a-z'][a-z']*/g) ?? []);
    for (const w of words) {
      const list = buckets.get(w);
      if (!list) continue;
      for (const p of list) {
        if (!text.includes(p.anchor)) continue;
        const r = p.re.exec(text);
        if (!r) continue;
        const caps = p.slots.map((_, i) => r[i + 1] ?? "");
        // O'rniga butun qatorning bir necha bo'lagi tushib qolmasin ("ishda {0}/{1}" ← "9/10 · chiqarildi …")
        if (caps.some((c) => SEPS.some((x) => !p.seps.includes(x) && c.includes(x)))) continue;
        const vals: string[] = [];
        p.slots.forEach((slot, i) => { vals[slot] = translatePart(caps[i] ?? "", depth + 1); });
        return p.out.replace(/\{(\d+)\}/g, (_, n) => vals[Number(n)] ?? "");
      }
    }
    // Butun qator topilmadi — ajratgichlar bo'yicha bo'laklab ("ishda 9/10 · chiqarildi 16 m³ · brak 1 ta")
    for (const sep of SPLIT) {
      if (!text.includes(sep)) continue;
      const parts = text.split(sep);
      const out = parts.map((x) => translatePart(x, depth + 1));
      if (out.some((x, i) => x !== parts[i])) return out.join(sep);
    }
    return null;
  }

  /** Shablon o'rniga tushgan bo'lak: bosh/oxiridagi bo'shliq saqlanadi, topilmasa — o'zi. */
  function translatePart(s: string, depth: number): string {
    const k = normKey(s);
    if (!k || !/[A-Za-z]{2,}/.test(k)) return s;
    const r = core(k, depth);
    return r === null ? s : /^\s*/.exec(s)![0] + r + /\s*$/.exec(s)![0];
  }

  /** Matnni o'giradi; topilmasa o'zini qaytaradi. Bosh/oxiridagi bo'shliq saqlanadi. */
  return function translate(text: string): string {
    if (!text || !/[A-Za-z]{2,}/.test(text)) return text;
    let r = cache.get(text);
    if (r === undefined) {
      const k = normKey(text);
      r = k ? core(k, 0) : null;
      if (cache.size > 50000) cache.clear();
      cache.set(text, r);
    }
    if (r === null) return text;
    const lead = /^\s*/.exec(text)![0], trail = /\s*$/.exec(text)![0];
    return lead + r + trail;
  };
}
