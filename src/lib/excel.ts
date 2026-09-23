/**
 * Excel import uchun umumiy yordamchilar (server + client).
 * Excel'dagi ustun nomlari turlicha bo'ladi (o'zbek/rus/ingliz) — `guessColumn` sarlavha bo'yicha taxmin qiladi,
 * foydalanuvchi keyin o'zi to'g'rilaydi. Raqamlar "2,5" / "1 200" ko'rinishida kelishi mumkin — `num` tozalaydi.
 */

export type ImportField = { key: string; label: string; required?: boolean; hint?: string; synonyms: readonly string[] };

export const FIELD_SYNONYMS = {
  product: ["mahsulot", "marka", "product", "товар", "марка", "beton", "продукт"],
  material: ["xomashyo", "material", "материал", "сырь", "nomi", "name", "наимен", "tovar", "mahsulot"],
  qty: ["miqdor", "qty", "norma", "колич", "кол-во", "к-во", "кво", "soni", "hajm", "quantity", "amount"],
  price: ["narx", "price", "цена"],
  unit: ["birlik", "unit", "ед.", "ед ", "ед изм", "изм", "o'lchov", "olchov", "o‘lchov", "измер"],
  nds: ["nds", "ндс", "qqs", "soliq", "vat", "tax", "налог"],
  sum: ["summa", "сумма", "jami", "itogo", "итого", "total", "stoimost", "стоимость"],
} as const;

/** Sarlavhalar orasidan maydonga mos ustunni topadi (kichik harf, qism mosligi). */
export function guessColumn(headers: string[], synonyms: readonly string[], taken: Set<string>): string | "" {
  const lc = headers.map((h) => h.toLowerCase());
  for (const syn of synonyms) {
    const i = lc.findIndex((h, idx) => h.includes(syn) && !taken.has(headers[idx]));
    if (i >= 0) return headers[i];
  }
  return "";
}

/**
 * "1 200,5" → 1200.5; "48,109,286" → 48109286; "1.200.000" → 1200000; bo'sh/xato → NaN.
 * Vergul/nuqta uch xonali guruhlarni ajratsa — mingliklar ajratkichi, aks holda kasr nuqtasi.
 */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  let s = String(v).replace(/[\s\u00a0'`]+/g, "");
  if (s === "") return NaN;
  const hasComma = s.includes(","), hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // oxirgisi kasr ajratkichi: "1.200,50" → 1200.50, "1,200.50" → 1200.50
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    s = s.split(dec === "," ? "." : ",").join("");
    s = s.replace(",", ".");
  } else if (hasComma) {
    // "9,818" → 9818 (minglik), lekin "2,5" va "0,500" → kasr
    s = /^-?[1-9]\d{0,2}(,\d{3})+$/.test(s) ? s.split(",").join("") : s.replace(",", ".");
  } else if (hasDot) {
    // faqat "1.200.000" kabi ikki va undan ko'p guruh minglik; "1.778" — kasr
    if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.split(".").join("");
  }
  return s === "" ? NaN : Number(s);
}

export const str = (v: unknown) => (v == null ? "" : String(v).trim());

/**
 * Sarlavha qatorining tartib raqami. Ba'zi fayllarda jadval tepasida bir-ikki katakli nom qatori turadi
 * ("Подразделение", "Ведомость…") — u sarlavha emas, shuning uchun kataklari 2 tadan ko'p bo'lgan
 * birinchi qator olinadi. Bo'sh fayl uchun −1.
 */
export function headerRowIndex(aoa: unknown[][]): number {
  const filled = (i: number) => (aoa[i] ?? []).filter((c) => str(c) !== "").length;
  let i = aoa.findIndex((r) => r.some((c) => str(c) !== ""));
  if (i < 0) return -1;
  for (let n = 0; n < 5 && filled(i) <= 2; n++) {
    const next = aoa.findIndex((r, j) => j > i && r.some((c) => str(c) !== ""));
    if (next < 0 || filled(next) < 3) break; // keyingisi ham tor — demak jadval shunaqa
    i = next;
  }
  return i;
}

/** Nomdan xomashyo kodi: "Sement M400" → "SEMENT-M400" (lotin, 16 belgigacha). */
export function codeFromName(name: string) {
  const s = name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toUpperCase().replace(/[\s_]+/g, "-").slice(0, 16);
  return s || "MAT";
}

/** Nomlarni taqqoslash uchun soddalashtirish: «"BODOMZOR SEMENT" MCHJ» → bodomzorsementmchj */
export const flatName = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яёўқғҳ]+/gi, "");

// ───────────────────────── Sana kataklari ─────────────────────────

const MONTHS: Record<string, number> = {
  yan: 1, jan: 1, "янв": 1, fev: 2, feb: 2, "фев": 2, mar: 3, "мар": 3, apr: 4, "апр": 4, may: 5, "май": 5, "мая": 5,
  iyun: 6, jun: 6, "июн": 6, iyul: 7, jul: 7, "июл": 7, avg: 8, aug: 8, "авг": 8, sen: 9, sep: 9, "сен": 9,
  okt: 10, oct: 10, "окт": 10, noy: 11, nov: 11, "ноя": 11, dek: 12, dec: 12, "дек": 12,
};
/** "сент." / "iyulda" / "June" → oy raqami; topilmasa 0. */
const monthOf = (tok: string) => {
  const t = tok.toLowerCase();
  return MONTHS[t.slice(0, 4)] ?? MONTHS[t.slice(0, 3)] ?? 0;
};
const p2 = (n: number) => String(n).padStart(2, "0");

/** Kun/oy/yil → "YYYY-MM-DD". Yil bo'lmasa: o'tgan yarim yildan oldin qolgan sana keyingi yilga o'tadi. */
function isoOf(day: number, month: number, yearRaw: string | undefined, today: Date): string {
  if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12)) return "";
  let year: number;
  if (yearRaw) {
    const y = Number(yearRaw);
    year = yearRaw.length <= 2 ? 2000 + y : y;
  } else {
    year = today.getFullYear();
    if (new Date(year, month - 1, day).getTime() < today.getTime() - 180 * 864e5) year += 1;
  }
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1) return ""; // 31.02 kabi bo'lmaydigan sana
  return `${year}-${p2(month)}-${p2(day)}`;
}

/**
 * Sarlavhadagi sanani "YYYY-MM-DD" ga o'giradi. Excel'dagi sana ustunlari turlicha yoziladi:
 * seriya raqami (46001), "22.09.2026", "23-сент", "01-05.10.2026" (oraliq — birinchi kuni olinadi).
 * O'qilmasa bo'sh satr.
 */
export function parseDateCell(v: unknown, today = new Date()): string {
  const raw = str(v);
  if (raw === "") return "";
  // Excel sana seriyasi: 1899-12-30 dan boshlab kunlar (2000-yil ≈ 36526, 2100-yil ≈ 73051)
  const n = typeof v === "number" ? v : /^\d+([.,]\d+)?$/.test(raw) ? num(raw) : NaN;
  if (Number.isFinite(n) && n >= 20000 && n <= 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5);
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  }
  const s = raw.replace(/[\r\n]+/g, "").replace(/\s+/g, " ").trim();
  // "01-05.10.2026", "23-24.09.2026" — oraliq: birinchi kuni
  let m = /^(\d{1,2}) ?[-–—] ?\d{1,2}[./](\d{1,2})(?:[./](\d{2,4}))?/.exec(s);
  if (m) return isoOf(+m[1], +m[2], m[3], today);
  // "22.09.2026", "22/9", "22-9-26"
  m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\.?$/.exec(s);
  if (m) return isoOf(+m[1], +m[2], m[3], today);
  // "23-сент", "5 okt 2026"
  m = /^(\d{1,2})[ .\-/]*([a-zа-яёў]{3,})\.?(?: ?(\d{2,4}))?$/i.exec(s);
  if (m) { const mo = monthOf(m[2]); if (mo) return isoOf(+m[1], mo, m[3], today); }
  // "сентябрь 23"
  m = /^([a-zа-яёў]{3,})\.?[ .\-/]*(\d{1,2})(?: ?(\d{2,4}))?$/i.exec(s);
  if (m) { const mo = monthOf(m[1]); if (mo) return isoOf(+m[2], mo, m[3], today); }
  return "";
}

// ───────────────────────── Kesishma (matritsa) jadval ─────────────────────────

/** Qatorlar — mahsulot, ustunlar — mijoz/obyekt, katak — miqdor: shu ko'rinishni qatorlarga yoyish uchun. */
export type MatrixPick = { headerRow: number; dateRow: number; nameCol: number; unitCol: number; use: number[] };
/** Mijoz/obyekt ustuni: `n` — ichidagi to'ldirilgan katak soni, `skip` — nega avtomatik chetlangani. */
export type MatrixCol = { i: number; label: string; date: string; n: number; skip?: string };
export type MatrixGuess = Omit<MatrixPick, "use"> & { ok: boolean; cols: MatrixCol[]; use: number[] };

/** Mahsulot emas, jami/qoldiq/tartib ustuni (yoki shunday qator). */
const SKIP_HDR = /^(№|no|n|#)$|итог|jami|жами|всего|total|сумма|qoldiq|остат|astatka/i;
const NAME_HDR = ["махсулот", "mahsulot", "номи", "nomi", "наимен", "product", "марка", "товар", "tovar"] as const;
const UNIT_HDR = ["улчов", "o'lchov", "o‘lchov", "olchov", "birlik", "бирлик", "изм", "unit", "ед"] as const;

const isNum = (v: unknown) => str(v) !== "" && Number.isFinite(num(v));

/** Sarlavha qatoridagi ustunlar: qaysi biri mijoz/obyekt, qaysi biri chetlanadi (jami, qoldiq, bo'sh). */
export function matrixColumns(aoa: unknown[][], p: Omit<MatrixPick, "use">): MatrixCol[] {
  const hdr = aoa[p.headerRow] ?? [];
  const dates = p.dateRow >= 0 ? aoa[p.dateRow] ?? [] : [];
  const width = Math.max(hdr.length, ...aoa.slice(p.headerRow + 1).map((r) => r?.length ?? 0));
  const out: MatrixCol[] = [];
  for (let i = 0; i < width; i++) {
    if (i === p.nameCol || i === p.unitCol) continue;
    const label = str(hdr[i]);
    const body = aoa.slice(p.headerRow + 1).filter((r) => str(r?.[p.nameCol]) !== "" && !SKIP_HDR.test(str(r?.[p.nameCol])));
    const filled = body.filter((r) => str(r?.[i]) !== "");
    const n = body.filter((r) => num(r?.[i]) > 0).length;
    const col: MatrixCol = { i, label: label || `Ustun ${i + 1}`, date: parseDateCell(dates[i]), n };
    // Qoldiq ustuni sarlavhasi ham sana bo'ladi ("22-сент.") — shuning uchun sana bo'lsa mijoz emas
    if (!label) col.skip = "sarlavhasi yo'q";
    else if (SKIP_HDR.test(label)) col.skip = "jami / tartib ustuni";
    else if (parseDateCell(label)) col.skip = "qoldiq ustuni (sarlavhasi sana)";
    else if (filled.length && filled.filter((r) => isNum(r[i])).length / filled.length < 0.8) col.skip = "kataklari raqam emas";
    out.push(col);
  }
  return out;
}

/**
 * Fayl matritsami — sarlavha qatori, mahsulot/birlik ustunlari va mijoz ustunlarini taxmin qiladi.
 * `ok` — kamida 3 ta raqamli mijoz ustuni bor, ya'ni oddiy ro'yxat emas.
 */
export function guessMatrix(aoa: unknown[][]): MatrixGuess {
  const top = aoa.slice(0, 15);
  // Sarlavha qatori — to'ldirilgan kataklari eng ko'p qator (matritsada mijozlar qatori shunday)
  let headerRow = 0, best = -1;
  top.forEach((r, i) => {
    const c = (r ?? []).filter((x) => str(x) !== "").length;
    if (c > best) { best = c; headerRow = i; }
  });
  const hdr = (aoa[headerRow] ?? []).map((c) => str(c).toLowerCase());
  const pick = (syn: readonly string[]) => hdr.findIndex((h) => h !== "" && syn.some((s) => h.includes(s)));
  let nameCol = pick(NAME_HDR);
  if (nameCol < 0) {
    // Sarlavhasi tanish bo'lmasa — kataklari matn bo'lgan birinchi ustun
    const body = aoa.slice(headerRow + 1, headerRow + 40);
    const width = Math.max(...body.map((r) => r?.length ?? 0), hdr.length);
    for (let i = 0; i < width; i++) {
      const filled = body.filter((r) => str(r?.[i]) !== "");
      if (filled.length >= 2 && filled.filter((r) => !isNum(r[i])).length / filled.length > 0.7) { nameCol = i; break; }
    }
  }
  const unitCol = pick(UNIT_HDR);
  // Sanalar mijozlar qatoridan yuqorida turadi. Yuqorida bir nechta qator bo'lishi mumkin
  // (izoh, ranglar legendasi) — shuning uchun sanaga o'xshash kataklari eng ko'p qator olinadi.
  let dateRow = -1, dateHits = 0;
  for (let i = headerRow - 1; i >= Math.max(0, headerRow - 6); i--) {
    const hits = (aoa[i] ?? []).filter((c) => parseDateCell(c) !== "").length;
    if (hits > dateHits) { dateHits = hits; dateRow = i; }
  }
  // Sana topilmasa — eng yaqin to'ldirilgan qator (foydalanuvchi o'zi to'g'rilaydi)
  if (dateRow < 0) for (let i = headerRow - 1; i >= 0; i--) if ((aoa[i] ?? []).some((c) => str(c) !== "")) { dateRow = i; break; }
  const base = { headerRow, dateRow, nameCol: Math.max(nameCol, 0), unitCol };
  const cols = nameCol < 0 ? [] : matrixColumns(aoa, base);
  const use = cols.filter((c) => !c.skip && c.n > 0).map((c) => c.i);
  return { ...base, cols, use, ok: nameCol >= 0 && use.length >= 3 };
}

/**
 * Matritsani qatorlarga yoyadi: har to'ldirilgan katak — bitta qator (mijoz, mahsulot, miqdor, sana).
 * `dates` — ustun bo'yicha yetkazish sanasi (foydalanuvchi to'g'rilashi mumkin).
 */
export function unpivotMatrix(aoa: unknown[][], p: MatrixPick, dates?: Record<number, string>) {
  const hdr = aoa[p.headerRow] ?? [];
  const out: { col: string; name: string; unit: string; qty: number; date: string }[] = [];
  for (let r = p.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const name = str(row[p.nameCol]);
    if (name === "" || SKIP_HDR.test(name)) continue;
    const unit = p.unitCol >= 0 ? str(row[p.unitCol]) : "";
    for (const c of p.use) {
      const q = num(row[c]);
      if (!(q > 0)) continue;
      out.push({ col: str(hdr[c]) || `Ustun ${c + 1}`, name, unit, qty: q, date: dates?.[c] ?? "" });
    }
  }
  return out;
}

/**
 * Excel katagidan sana. Uch xil ko'rinish tushunadi:
 *  - Excel seriya raqami (46023) — `raw: true` bilan o'qilganda sanalar shunday keladi;
 *  - ISO ("2026-05-01");
 *  - "1/5/26", "01.05.2026", "1-5-2026" — kun/oy/yil (`monthFirst` bo'lsa oy/kun/yil).
 * Ikki xonali yil 2000-yillar deb olinadi. Sana o'qilmasa — null.
 * `minYear` — shundan oldingi sana qabul qilinmaydi (standart 1990; tug'ilgan sana uchun 1900 beriladi).
 */
export function parseDate(v: unknown, monthFirst = false, minYear = 1990): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = str(v);
  if (!s) return null;
  const mk = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= minYear && y <= 2100 ? new Date(y, m - 1, d) : null;

  // Excel seriya raqami: 1899-12-30 dan beri o'tgan kunlar (minYear–2100 oralig'idagilarigina sana deb olinadi)
  if (/^\d+([.,]\d+)?$/.test(s)) {
    const n = Number(s.replace(",", "."));
    const lo = Math.round((Date.UTC(minYear, 0, 1) - Date.UTC(1899, 11, 30)) / 864e5);
    if (n < lo || n > 73415) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  const iso = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (iso) return mk(+iso[1], +iso[2], +iso[3]);

  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!m) return null;
  const a = +m[1], b = +m[2];
  let y = +m[3];
  if (y < 100) y += 2000;
  // 12 dan katta raqam faqat kun bo'la oladi — tartib shu bo'yicha aniqlanadi, aks holda `monthFirst`
  const [day, mon] = a > 12 ? [a, b] : b > 12 ? [b, a] : monthFirst ? [b, a] : [a, b];
  return mk(y, mon, day);
}
