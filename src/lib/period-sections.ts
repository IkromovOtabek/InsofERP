/* ───────────────────────── Oy yopish: bo'limlar va xato (klientda ham ishlatiladi — baza importi yo'q) ─────────────────────────
 *
 * Yopilgan oy — `PeriodClose` jadvalida (bo'lim, oy) yozuvi. Himoya bazaning o'zida: `insof_period_guard` trigger'i
 * yopiq oyga sanalangan hujjatni qo'shish, tahrirlash va o'chirishni rad etadi (veb, mobil, Excel import, skript —
 * hammasi bir joydan). Trigger xatosi `INSOF_PERIOD_CLOSED:<bo'lim>:<YYYY-MM>` — `lib/db.ts` uni `PeriodClosedError`
 * ga aylantiradi: `message` o'zbekcha (action `{ error: e.message }` qaytarsa ko'rinadi), `digest` esa production'da ham
 * klientga yetadi (Next xabar matnini yashiradi, `digest` ni emas) — `(app)/error.tsx` va tugmalar shundan tushunarli gap chiqaradi.
 *
 * Qaysi jadval qaysi bo'limga tegishli — migratsiya `*_oy_yopish/migration.sql` (trigger ro'yxati). Bu yerdagi `covers`
 * — sahifada foydalanuvchiga ko'rsatiladigan izoh.
 */

export const PERIOD_SECTIONS = [
  { key: "kassa", label: "Kassa va bank", short: "Kassa", covers: "Kassa/bank kirim-chiqimi, to'lovlar, hisoblararo o'tkazma, kassa sanash, boshlang'ich qoldiqlar" },
  { key: "sotuv", label: "Sotuv va realizatsiya", short: "Sotuv", covers: "Realizatsiya jurnali, schyotlar, sotuv reyestri, qarz o'tkazmalari" },
  { key: "sklad", label: "Sklad", short: "Sklad", covers: "Kirim va chiqim, sklad harakatlari, brigadaga berilgan material" },
  { key: "ishlab", label: "Ishlab chiqarish", short: "Ishlab chiqarish", covers: "Zameslar, ishlab chiqarish hisobotlari, brak, smenalar, topshiriq bajarilishi" },
  { key: "logistika", label: "Logistika", short: "Logistika", covers: "Hisob varag'i qatorlari, logistika moliya, yoqilg'i, transport xarajati va servisi, yetkazilgan reys hisobi" },
  { key: "ishhaqi", label: "Ish haqi va davomat", short: "Ish haqi", covers: "Davomat, ushlanma va qo'shimchalar, brigada soatlari va varag'i, ish haqi hisobi" },
  { key: "arenda", label: "Arenda", short: "Arenda", covers: "Arenda kirim-chiqimi, oylik hisob, svet hisobi" },
] as const;

export type PeriodSection = (typeof PERIOD_SECTIONS)[number]["key"];

export const isPeriodSection = (s: unknown): s is PeriodSection => PERIOD_SECTIONS.some((x) => x.key === s);
export const periodSectionLabel = (s: string) => PERIOD_SECTIONS.find((x) => x.key === s)?.label ?? s;

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
/** "2026-10" → "2026-yil oktyabr" */
export function periodMonthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return m >= 1 && m <= 12 ? `${month.slice(0, 4)}-yil ${MONTHS[m - 1]}` : month;
}

/** Yopilgan oyga yozishga urinish — foydalanuvchiga ko'rsatiladigan matn. */
export function periodClosedText(section: string, month: string): string {
  return `${periodMonthLabel(month)} «${periodSectionLabel(section)}» bo'limida yopilgan — o'zgartirish uchun oy ochilishi kerak (Moliya → Oy yopish)`;
}

const DIGEST = "INSOF_PERIOD_CLOSED";
const SQL_RE = /INSOF_PERIOD_CLOSED:([a-z]+):(\d{4}-\d{2})/;

export class PeriodClosedError extends Error {
  readonly digest: string;
  readonly section: string;
  readonly month: string;
  constructor(section: string, month: string) {
    super(periodClosedText(section, month));
    this.name = "PeriodClosedError";
    this.section = section;
    this.month = month;
    this.digest = `${DIGEST};${section};${month}`;
  }
}

/** Baza xatosi (trigger) yopilgan oyniki bo'lsa — `PeriodClosedError`, aks holda null. */
export function periodErrorFromDb(e: unknown): PeriodClosedError | null {
  if (e instanceof PeriodClosedError) return e;
  const m = SQL_RE.exec(String((e as { message?: unknown })?.message ?? ""));
  return m ? new PeriodClosedError(m[1], m[2]) : null;
}

/** Klientda: server action tashlagan xato yopilgan oyniki bo'lsa — tushunarli matn (production'da `digest` orqali). */
export function periodClosedMessage(e: unknown): string | null {
  const d = String((e as { digest?: unknown })?.digest ?? "");
  if (d.startsWith(DIGEST + ";")) {
    const [, section, month] = d.split(";");
    return periodClosedText(section, month);
  }
  const m = SQL_RE.exec(String((e as { message?: unknown })?.message ?? ""));
  return m ? periodClosedText(m[1], m[2]) : null;
}
