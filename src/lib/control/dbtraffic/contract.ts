/**
 * Baza (PostgreSQL) va trafik (nginx) kuzatuvi — agent ↔ panel shartnomasi. Sof modul: Prisma/Node yo'q,
 * klient komponentlar ham import qiladi.
 *
 * Amallar (monitor/contract.ts ACTION_TYPES ichida):
 *   PG_CANCEL      { db, pid }      pg_cancel_backend — faqat `insof` rolining o'z FAOL so'rovi
 *   PG_TERMINATE   { db, pid }      pg_terminate_backend — faqat o'z rolining "idle in transaction" > 10 daq ulanishi
 *   VACUUM_ANALYZE { db, table? }   VACUUM (ANALYZE) — jadval faqat pg_class dagi mavjud nom (public sxema), %I bilan
 * Agent har amalni qayta tekshiradi: db — control baza yoki korxona bazasi, pid/jadval — bazadan qayta o'qiladi.
 */

/** Baza nomi (lib/control/db.ts DB_NAME_RE bilan bir xil) */
export const PG_DB_RE = /^[a-z][a-z0-9_]{2,62}$/;
/** Postgres backend pid — musbat butun son (satr ko'rinishida: params Record<string,string>) */
export const PG_PID_RE = /^[1-9]\d{0,9}$/;
/** Jadval nomi: Prisma jadvallari ("Product", "_ProductToTag") — oddiy identifikator, 63 belgigacha */
export const PG_TABLE_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export const DB_ACTION_TYPES = ["PG_CANCEL", "PG_TERMINATE", "VACUUM_ANALYZE"] as const;
export type DbActionType = (typeof DB_ACTION_TYPES)[number];
export const isDbActionType = (t: string): t is DbActionType => (DB_ACTION_TYPES as readonly string[]).includes(t);

export type DbActionParams = { db: string; pid?: string; table?: string };

/** PG_TERMINATE faqat shundan uzoq "idle in transaction" holatidagi ulanishga */
export const TERMINATE_IDLE_SEC = 600;

/**
 * Parametrlarni qat'iy tekshirish (panel ham, agent ham). Faqat ma'lum kalitlar olinadi.
 * Natija `null` — bu tur bizniki emas.
 */
export function validateDbAction(type: string, p: Record<string, unknown>):
  | { ok: true; type: DbActionType; params: DbActionParams }
  | { ok: false; reason: string }
  | null {
  if (!isDbActionType(type)) return null;
  const db = p.db;
  if (typeof db !== "string" || !PG_DB_RE.test(db)) return { ok: false, reason: "db noto'g'ri (faqat kichik lotin harf, raqam, _)" };
  if (type === "PG_CANCEL" || type === "PG_TERMINATE") {
    const pid = typeof p.pid === "number" ? String(p.pid) : p.pid;
    if (typeof pid !== "string" || !PG_PID_RE.test(pid) || Number(pid) > 2_147_483_647) return { ok: false, reason: "pid noto'g'ri (musbat butun son)" };
    return { ok: true, type, params: { db, pid } };
  }
  const table = p.table;
  if (table === undefined || table === null || table === "") return { ok: true, type, params: { db } };
  if (typeof table !== "string" || !PG_TABLE_RE.test(table)) return { ok: false, reason: "jadval nomi noto'g'ri (harf, raqam, _; 63 belgigacha)" };
  return { ok: true, type, params: { db, table } };
}

/** Qayta tasdiq so'zi (UI va server action bir xil): PG_CANCEL — pid, PG_TERMINATE — TASDIQLAYMAN, VACUUM — baza nomi. */
export function dbConfirmPhrase(type: string, params: Record<string, unknown>): string | null | undefined {
  if (type === "PG_CANCEL") return typeof params.pid === "string" ? params.pid : "";
  if (type === "PG_TERMINATE") return "TASDIQLAYMAN";
  if (type === "VACUUM_ANALYZE") return typeof params.db === "string" ? params.db : "";
  return undefined;
}

export const DB_ACTION_LABEL: Record<DbActionType, string> = {
  PG_CANCEL: "So'rovni bekor qilish (pg_cancel_backend)",
  PG_TERMINATE: "Ulanishni uzish (pg_terminate_backend)",
  VACUUM_ANALYZE: "VACUUM ANALYZE",
};

export const DB_ACTION_DESCR: Record<DbActionType, string> = {
  PG_CANCEL: "Faqat shu so'rov to'xtatiladi (ulanish qoladi, tranzaksiya xato bilan tugaydi). Foydalanuvchi amali xato bilan qaytishi mumkin.",
  PG_TERMINATE: "Ulanish uziladi, ochiq tranzaksiya bekor qilinadi (ROLLBACK). Faqat 10 daqiqadan ortiq «idle in transaction» turgan ulanishga.",
  VACUUM_ANALYZE: "O'lik qatorlar tozalanadi va statistikalar yangilanadi. Jadval bloklanmaydi, lekin disk/CPU yuklamasi oshadi.",
};

/* ───────────────────────── ServiceCheck kalitlari va chegaralar ───────────────────────── */

export const DBT_KEYS = {
  dbStats: "db:stats",
  traffic: "traffic:nginx",
  upstreamPrefix: "traffic:upstream:",
  upstream: (domain: string) => `traffic:upstream:${domain}`,
};

/** Monitoring surati (SSE) bu kalitlarning katta `data` sini yubormaydi — sahifalar o'zi o'qiydi. */
export const HEAVY_CHECK_KEYS: readonly string[] = [DBT_KEYS.dbStats, DBT_KEYS.traffic];

export const DBT_THRESHOLDS = {
  longXactSec: 60,
  longQuerySec: 30,
  idleInXactWarnSec: TERMINATE_IDLE_SEC,
  lockWaitWarnSec: 60,
  cacheHitWarn: 0.9,
  cacheHitMinBlocks: 100_000,
  deadRatioWarn: 0.2,
  deadTupMin: 10_000,
  /** 5xx ulushi (oxirgi 5 daq, kamida minRequests so'rov bo'lsa) */
  err5xxPct: { warn: 5, crit: 20 },
  minRequests: 20,
  /** upstream xatolari domen bo'yicha (5 daq) */
  upstream5m: { warn: 3, crit: 20 },
  /** "Connection refused" — xizmat umuman ishlamayapti */
  upstreamRefusedCrit: 5,
} as const;

/** Domen nomi (ServiceCheck kalitiga qo'yiladi) */
export const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,62}\.)*[a-z0-9-]{1,63}$/;
