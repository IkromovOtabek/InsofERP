/**
 * Test rejimi (AI QA agentlari va E2E uchun lokal muhit).
 *
 * `INSOF_ENV=test` (yoki `NODE_ENV=test`) bo'lsa ilova faqat lokal test bazasi bilan va real tashqi
 * kalitlarsiz ishga tushadi — `instrumentation.ts` dagi `assertSafeTestEnv()` aks holda serverni to'xtatadi.
 *
 * Nega env tekshiruvi shart: Next `.env.test` dan keyin baribir `.env` ni ham o'qiydi va u yerdagi
 * kalit `.env.test` da yo'q bo'lsa o'shani oladi. Ya'ni bitta unutilgan kalit — real SMS/push/ECO.
 * Shuning uchun `.env.test` da har bir kalit aniq bo'sh yoziladi (jarayondagi bo'sh qiymat `.env` dan ustun),
 * bu yerda esa bo'sh bo'lmagani topilsa ishga tushish rad etiladi.
 *
 * Edge runtime'da ham import qilsa bo'ladi: faqat process.env va URL.
 */

/** Test rejimida bo'sh bo'lishi shart: real tashqi servislarga kirish kalitlari. */
const FORBIDDEN_KEYS = [
  "ESKIZ_EMAIL",
  "ESKIZ_PASSWORD",
  "TELEGRAM_BOT_TOKEN",
  "ECO_TELEGRAM_BOT_TOKEN",
  "TELEGRAM_GATEWAY_TOKEN",
  "ECO_API_URL",
  "ECO_API_KEY",
  "EXPO_ACCESS_TOKEN",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "MOHIR_API_KEY",
  "DGIS_API_KEY",
  "NEXT_PUBLIC_YANDEX_MAPS_KEY",
  "YANDEX_SUGGEST_KEY",
  "YANDEX_GEOCODER_KEY",
  "YANDEX_ROUTER_KEY",
  "AMO_BASE_URL",
] as const;

/** Berilgan bo'lsa faqat lokal manzil bo'lishi mumkin (stub serverlar). */
const LOCAL_URL_KEYS = ["MOHIR_STT_URL", "ECO_STUB_URL"] as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TEST_DB_NAME = /^insof_test(?:_[a-z0-9]+)*$/;

type Env = Record<string, string | undefined>;

const val = (env: Env, key: string) => (env[key] ?? "").trim();

export function isTestMode(env: Env = process.env): boolean {
  return val(env, "INSOF_ENV").toLowerCase() === "test" || env.NODE_ENV === "test";
}

function isLocalHost(hostname: string) {
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

/**
 * Lokal test bazasimi: postgres URL, host — localhost / 127.0.0.1 / ::1, baza nomi `insof_test…`.
 * `?host=` parametri (libpq unix socket / boshqa hostga yo'naltirish) qabul qilinmaydi.
 */
export function isTestDbUrl(url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return false; }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return false;
  if (!isLocalHost(u.hostname)) return false;
  if (u.searchParams.has("host")) return false;
  return TEST_DB_NAME.test(decodeURIComponent(u.pathname.replace(/^\//, "")));
}

/**
 * Tashqi so'rovga ruxsat bormi. Test rejimidan tashqarida — har doim ha (prod/dev xatti-harakati o'zgarmaydi).
 * Test rejimida — faqat localhost. Integratsiyalar keyingi bosqichda shu funksiya orqali to'siladi.
 */
export function externalAllowed(target: string | URL, env: Env = process.env): boolean {
  if (!isTestMode(env)) return true;
  try {
    return isLocalHost(new URL(target).hostname);
  } catch {
    return false;
  }
}

/** Test muhitidagi barcha xatolar ro'yxati (bo'sh — hammasi joyida). Qiymatlarning o'zi chiqarilmaydi. */
export function testEnvProblems(env: Env = process.env): string[] {
  const problems: string[] = [];

  if (!isTestDbUrl(env.DATABASE_URL)) {
    problems.push("DATABASE_URL lokal test bazasi emas (host: localhost/127.0.0.1/::1, baza nomi: insof_test…, ?host= parametrisiz)");
  }

  const filled = FORBIDDEN_KEYS.filter((k) => val(env, k) !== "");
  if (filled.length) {
    problems.push(`real tashqi servis kalitlari bo'sh bo'lishi kerak: ${filled.join(", ")}`);
  }

  if (val(env, "SMS_PROVIDER").toUpperCase() !== "FAKE") {
    problems.push("SMS_PROVIDER=FAKE bo'lishi kerak");
  }

  // OSRM_URL berilmasa geo.ts ochiq router.project-osrm.org ga boradi — test rejimida lokal manzil majburiy
  const osrm = val(env, "OSRM_URL");
  if (!osrm || !externalAllowed(osrm, { INSOF_ENV: "test" })) {
    problems.push("OSRM_URL lokal manzil bo'lishi kerak (masalan http://127.0.0.1:9)");
  }

  for (const k of LOCAL_URL_KEYS) {
    const v = val(env, k);
    if (v && !externalAllowed(v, { INSOF_ENV: "test" })) problems.push(`${k} faqat lokal manzil bo'lishi mumkin`);
  }

  return problems;
}

/** Test rejimida muhit xavfsiz bo'lmasa xato tashlaydi. Test rejimi bo'lmasa hech narsa qilmaydi. */
export function assertSafeTestEnv(env: Env = process.env): void {
  if (!isTestMode(env)) return;
  const problems = testEnvProblems(env);
  if (problems.length) {
    throw new Error(`[test-mode] Xavfsiz bo'lmagan test muhiti — server ishga tushmaydi:\n  - ${problems.join("\n  - ")}`);
  }
}
