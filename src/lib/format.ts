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
