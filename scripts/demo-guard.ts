/**
 * Demo / test / seed skriptlari uchun himoya — real (prod) bazaga tasodifan sun'iy ma'lumot,
 * `test.*` loginlar yoki standart parolli `admin` tushmasin.
 *
 * Ruxsat faqat ikki holatda:
 *   1. DATABASE_URL — lokal test bazasi (`insof_test…`, localhost) — `isTestDbUrl` (src/lib/test-mode.ts)
 *   2. Aniq bayroq: ALLOW_DEMO=yes-i-know  (nimani qilayotganingizni bilsangiz)
 *
 * Skript boshida chaqiriladi — PrismaClient yaratilishidan OLDIN (env shu yerda yuklanadi).
 */
import { loadEnv } from "./env";
import { isTestDbUrl } from "../src/lib/test-mode";

export const ALLOW_DEMO_FLAG = "yes-i-know";
export const MIN_SCRIPT_PASSWORD = 10;

/** Baza nomi (parolsiz) — xabarlar uchun. */
export function dbLabel(url = process.env.DATABASE_URL): string {
  try {
    const u = new URL(url ?? "");
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return "(DATABASE_URL o'qilmadi)";
  }
}

/**
 * Demo/test skriptiga ruxsat bormi. Yo'q bo'lsa xato bilan to'xtatadi.
 * Qaytaradi: `testDb` — lokal test bazasimi (standart parollarga faqat shunda ruxsat).
 */
export function guardDemo(script: string): { testDb: boolean } {
  loadEnv();
  const testDb = isTestDbUrl(process.env.DATABASE_URL);
  if (testDb) return { testDb };
  if ((process.env.ALLOW_DEMO ?? "").trim() === ALLOW_DEMO_FLAG) {
    console.warn(`⚠ ${script}: test bo'lmagan bazada ishlayapti (${dbLabel()}) — ALLOW_DEMO=${ALLOW_DEMO_FLAG} berilgan`);
    return { testDb };
  }
  console.error(
    `✗ ${script} rad etildi: baza ${dbLabel()} lokal test bazasi emas (insof_test…).\n` +
      `  Bu skript sun'iy ma'lumot / loginlar yaratadi yoki bazani tozalaydi.\n` +
      `  Rostdan shu bazada kerak bo'lsa: ALLOW_DEMO=${ALLOW_DEMO_FLAG} bilan ishga tushiring.`,
  );
  process.exit(1);
}

/**
 * Test bo'lmagan bazada standart parol (admin123, parol123) ishlatilmaydi — muhit o'zgaruvchisidan
 * kamida 10 belgili parol talab qilinadi. Test bazasida `testDefault` qaytadi.
 */
export function scriptPassword(names: string[], testDb: boolean, testDefault: string): string {
  const value = names.map((n) => process.env[n]?.trim()).find((v) => v);
  if (value) {
    if (!testDb && value.length < MIN_SCRIPT_PASSWORD) {
      console.error(`✗ ${names[0]} juda qisqa — kamida ${MIN_SCRIPT_PASSWORD} belgi kerak`);
      process.exit(1);
    }
    if (!testDb && /^(admin123|parol123|password|12345678+9?0?)$/i.test(value)) {
      console.error(`✗ ${names[0]} juda oddiy — boshqa parol tanlang`);
      process.exit(1);
    }
    return value;
  }
  if (testDb) return testDefault;
  console.error(`✗ Test bo'lmagan bazada ${names[0]} (kamida ${MIN_SCRIPT_PASSWORD} belgi) majburiy — standart parol ishlatilmaydi`);
  process.exit(1);
}
