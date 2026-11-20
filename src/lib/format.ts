/**
 * Raqam formatlash — Intl ishlatilmaydi: Node va brauzer ICU'lari "uz-UZ" uchun
 * har xil ajratgich beradi va hydration xatosi chiqaradi. Bu yerda natija deterministik.
 */
export function fmtNum(v: number | string | { toString(): string }, maxFrac = 0): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(maxFrac);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fracTrim = frac ? frac.replace(/0+$/, "") : "";
  return (neg ? "-" : "") + grouped + (fracTrim ? "," + fracTrim : "");
}

/** Buxgalteriya jadvali: kasr har doim `frac` xonali — «8 350 000,00» (akt sverka, qarz varaqlari). */
export function fmtFixed(v: number | string | { toString(): string }, frac = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const [int, f] = Math.abs(n).toFixed(frac).split(".");
  return (n < 0 && Number(Math.abs(n).toFixed(frac)) !== 0 ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (f ? "," + f : "");
}

/**
 * Summa tiyinigacha, 3 xonali kasr: «1 000 000.000» — pul maydoni (`MoneyInput`) ko'rinishi bilan bir xil (kasr nuqta bilan).
 * Realizatsiya varaqlari (Logistika, Sotuv, kunlik zayavka, Tahlil hisoboti) shu bilan; reestr summalari bazada Decimal(18,3).
 */
export const fmtTiyin = (v: number | string | { toString(): string }) => fmtFixed(v, 3).replace(",", ".");

/**
 * Jami summa — kasrsiz, so'mgacha yaxlitlab: «4 200 000». «Jami» ustuni, «Jami» qatori va kartalari shu bilan;
 * narx va qator summalari o'z kasri bilan qoladi (`fmtTiyin`, `fmtFixed`). Istisno: mijoz va ta'minotchi debitorka /
 * kreditorkasi (varaq, karta va akt sverka) — u yerda hamma summa shu bilan, kasrsiz.
 */
export function fmtJami(v: number | string | { toString(): string }): string {
  const n = Math.round(Number(v));
  return fmtNum(n === 0 ? 0 : n, 0); // -0 «-0» bo'lib chiqmasin
}

/**
 * Kiritilgan raqam matni → JS o'qiydigan satr: «1 000 000,50» → «1000000.50», «1,4» → «1.4».
 * Bo'shliq va apostrof (minglik ajratgich) tashlanadi; nuqta ham, vergul ham kasr ajratgichi:
 * ikkala turi bo'lsa — oxirgisi kasr, qolganlari minglik («1,000,000.50», «1.000.000,50»);
 * bir turdagi bir nechtasi 3 xonali guruhlar bilan — minglik («1.000.000»).
 * Boshqa belgilarga tegilmaydi — «12a» raqam bo'lmaganicha qoladi (jim 0 emas, xato chiqsin).
 */
export function numText(v: string): string {
  const s = v.replace(/[\s'’ʼ_]/g, "");
  const seps = s.match(/[.,]/g);
  if (!seps) return s;
  if (seps.length === 1) return s.replace(",", ".");
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  const head = s.slice(0, last);
  if (seps.some((c) => c !== seps[0])) return head.includes(s[last]) ? s : `${head.replace(/[.,]/g, "")}.${s.slice(last + 1)}`;
  return /^-?\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, "") : s;
}

export const money = (v: number | string | { toString(): string }) => fmtNum(v, 0) + " so'm";
export const qty = (v: number | string | { toString(): string }) => fmtNum(v, 3);

/** Qisqa pul: 1.7 mlrd · 218 mln · 50 ming · 950 */
export function moneyShort(v: number): string {
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}${fmtNum(a / 1e9, a >= 1e10 ? 1 : 2)} mlrd`;
  if (a >= 1e6) return `${sign}${fmtNum(a / 1e6, a >= 1e8 ? 0 : 1)} mln`;
  if (a >= 1e3) return `${sign}${fmtNum(a / 1e3, 0)} ming`;
  return `${sign}${fmtNum(a, 0)}`;
}
export const pct = (v: number, frac = 1) => `${fmtNum(v, frac)}%`;

const pad = (n: number) => String(n).padStart(2, "0");
export const date = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const dateTime = (d: Date) => `${date(d)} ${time(d)}`;
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/**
 * Amal sanasi + soati. Hujjat sanasi formadan kun bo'lib keladi (soati 00:00/05:00 — haqiqiy emas),
 * shuning uchun soat yozuv kiritilgan vaqtdan (`createdAt`) olinadi: «09/11/2026 14:32».
 * Orqa sana bilan (yoki Excel'dan) kiritilgan bo'lsa amal soati noma'lum — faqat sana.
 * `fmt` — sana ko'rinishi (`dateRu`, `dateShort` …).
 */
export const opAt = (d: Date, created?: Date | null, fmt: (d: Date) => string = date) =>
  created && sameDay(d, created) ? `${fmt(d)} ${time(created)}` : fmt(d);
export const isoDate = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Ruscha jadvallar (Sklad → Приход/Расход): «20.04.2026» — Excel'dagidek nuqta bilan. */
export const dateRu = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
/** Qisqa: «05.10.26» — akt sverka va qarz varaqlari sarlavhalari. */
export const dateShort = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;

/** Yetkazish sanasi + soati: "18/09/2026 · 14:00" (soat kiritilmagan bo'lsa faqat sana). */
export const deliveryAt = (d: Date, t?: string | null) => (t ? `${date(d)} · ${t}` : date(d));

/** Zayavka nomi (raqam UI'da ko'rsatilmaydi): "Mijoz · 18/09/2026". */
export const orderLabel = (customer?: string | null, d?: Date | null) =>
  [customer || "Zayavka", d ? date(d) : null].filter(Boolean).join(" · ");

/**
 * Excel katagi raqamini uning formati (`numFmt`) bo'yicha ko'rsatish — Oylik varaqlari (`lib/sheet-calc.ts`).
 * Bo'limlar «musbat;manfiy;nol»; `#,##0` — minglik (bo'sh joy), `0.00` — kasr (vergul), `%` — foiz,
 * buxgalteriya nol bo'limi `"-"` — «-». `_x` (bo'shliq), `*x` (to'ldirish), `[...]` (rang/til) tashlanadi.
 * Sana formati (`mmmm yyyy`, `dd.mm.yyyy`) Excel seriya raqamidan. Intl ishlatilmaydi — server va brauzer bir xil.
 */
export function excelNumber(n: number, z?: string): string {
  if (!Number.isFinite(n)) return "#NUM!";
  if (!z || z === "General" || z === "@") return excelGeneral(n);
  const sections = splitFmt(z);
  const datey = (s: string) => /[ymdhs]/i.test(s.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/[0#?]/.test(s.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ""));
  if (datey(sections[0])) return excelDate(n, sections[0]);
  let sec = sections[0], sign = n < 0 ? "-" : "";
  if (n < 0 && sections[1] != null) { sec = sections[1]; sign = ""; }
  else if (n === 0 && sections[2] != null) sec = sections[2];
  let lit = "", num = "", seenNum = false, after = "";
  const text = (t: string) => { if (seenNum) after += t; else lit += t; };
  for (let i = 0; i < sec.length; i++) {
    const ch = sec[i];
    if (ch === "_" || ch === "*") { i++; continue; }
    if (ch === "\\") { text(sec[i + 1] ?? ""); i++; continue; }
    if (ch === '"') { const j = sec.indexOf('"', i + 1); text(sec.slice(i + 1, j < 0 ? undefined : j)); i = j < 0 ? sec.length : j; continue; }
    if (ch === "[") { const j = sec.indexOf("]", i + 1); i = j < 0 ? sec.length : j; continue; }
    if ("#0?,.".includes(ch) && (!seenNum || !after)) { num += ch; seenNum = true; continue; }
    if (ch === "%") { num += "%"; continue; }
    text(ch);
  }
  if (!seenNum) return (lit + after).trim() || (n === 0 ? "" : sign + excelGeneral(Math.abs(n)));
  const pctMul = num.includes("%") ? 100 : 1;
  const [intPart, fracPart = ""] = num.replace(/%/g, "").split(".");
  const minFrac = (fracPart.match(/0/g) ?? []).length;
  const maxFrac = (fracPart.match(/[0#?]/g) ?? []).length;
  const group = intPart.includes(",") && /[0#?]/.test(intPart.split(",")[0] + intPart.split(",").slice(-1)[0]);
  const a = roundHalfAway(Math.abs(n) * pctMul, maxFrac);
  let [i, f = ""] = a.toFixed(maxFrac).split(".");
  f = f.replace(/0+$/, "");
  if (f.length < minFrac) f = f.padEnd(minFrac, "0");
  if (!/0/.test(intPart) && i === "0") i = ""; // «#,###» / «??» — nol butun qism ko'rsatilmaydi
  if (group) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = i + (f ? "," + f : "") + (pctMul === 100 ? "%" : "");
  return (sign + lit + body + after).trim();
}

/** Excel «Umumiy» format: butun son guruhlanmaydi, kasr 10 xonagacha (vergul bilan). */
function excelGeneral(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const t = Number(n.toPrecision(10));
  return (Math.abs(t) >= 1e15 || (t !== 0 && Math.abs(t) < 1e-9) ? t.toExponential(4) : String(t)).replace(".", ",");
}

/** Yarmini noldan uzoqqa yaxlitlash (Excel ROUND/ko'rinish kabi), suzuvchi xatoni 15 xonada kesib. */
export function roundHalfAway(x: number, digits: number): number {
  const s = x < 0 ? -1 : 1, a = Math.abs(x);
  if (digits >= 0) { const p = 10 ** digits; return (s * Math.floor(Number((a * p).toPrecision(15)) + 0.5)) / p; }
  const p = 10 ** -digits;
  return s * Math.floor(Number((a / p).toPrecision(15)) + 0.5) * p;
}

/** Formatni «;» bo'yicha bo'limlarga (qo'shtirnoq va [..] ichidagisi hisobga olinmaydi). */
function splitFmt(z: string): string[] {
  const out: string[] = []; let cur = "", q = false, b = false;
  for (let i = 0; i < z.length; i++) {
    const ch = z[i];
    if (ch === "\\" && !q) { cur += ch + (z[i + 1] ?? ""); i++; continue; }
    if (ch === '"') q = !q; else if (!q && ch === "[") b = true; else if (!q && ch === "]") b = false;
    if (ch === ";" && !q && !b) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const XL_MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
/** Excel seriya raqami → sana matni formatga ko'ra (`mmmm yyyy` → «Sentabr 2026», `dd.mm.yyyy` → «05.10.2026»). */
function excelDate(serial: number, fmt: string): string {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
  const f = fmt.replace(/\[[^\]]*\]/g, "").replace(/\\(.)/g, "$1").replace(/"([^"]*)"/g, "$1").replace(/;@$/, "").replace(/@/g, "");
  return f.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gi, (t) => {
    const k = t.toLowerCase();
    if (k === "yyyy") return String(Y);
    if (k === "yy") return String(Y).slice(2);
    if (k === "mmmm") return XL_MONTHS[M];
    if (k === "mmm") return XL_MONTHS[M].slice(0, 3);
    if (k === "mm") return pad(M + 1);
    if (k === "m") return String(M + 1);
    if (k === "dd") return pad(D);
    return String(D);
  }).trim();
}
