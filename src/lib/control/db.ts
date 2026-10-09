import { PrismaClient as ControlClient } from "@/generated/control";
import { PrismaClient as TenantClient } from "@/generated/prisma";
import { isTestDbUrl, isTestMode } from "../test-mode";

/**
 * Markaziy panel bazalari.
 *  - `control` — korxonalar ro'yxati, superadminlar, jurnal (CONTROL_DATABASE_URL).
 *  - `tenantDb(dbName)` — korxona bazasiga to'g'ridan-to'g'ri ulanish (yaratish, direktor, statistika).
 *    Manzil shablondan: TENANT_DATABASE_URL="postgresql://insof:***@127.0.0.1:5432/{db}".
 */
const g = globalThis as unknown as { controlDb?: ControlClient; tenantClients?: Map<string, TenantClient> };

/**
 * Test rejimi (INSOF_ENV=test): panel faqat lokal `insof_test…` bazalari bilan ishlaydi — control baza ham,
 * korxona bazalari ham. Test panelga prod control.env berib yuborilsa birinchi murojaatdayoq xato.
 */
function assertTestDb(url: string | undefined, what: string) {
  if (isTestMode() && !isTestDbUrl(url)) throw new Error(`[test-mode] ${what} lokal test bazasi emas (insof_test…)`);
}

// Berilmagan (yoki bo'sh) bo'lsa — bu jarayonda panel yo'q (oddiy korxona test serveri, `next build`): tekshirilmaydi,
// aks holda modul import qilinishi bilanoq build va test server yiqilardi. Panel ulanmagan bazaga birinchi so'rovda xato beradi.
if (process.env.CONTROL_DATABASE_URL?.trim()) assertTestDb(process.env.CONTROL_DATABASE_URL, "CONTROL_DATABASE_URL");
export const control = g.controlDb ?? new ControlClient({ log: ["error"] });
if (process.env.NODE_ENV !== "production") g.controlDb = control;

const clients = (g.tenantClients ??= new Map());

/** Baza nomi faqat shu ko'rinishda — SQL'ga identifikator sifatida qo'yiladi. */
export const DB_NAME_RE = /^[a-z][a-z0-9_]{2,62}$/;

export function tenantDbUrl(dbName: string): string {
  if (!DB_NAME_RE.test(dbName)) throw new Error(`Baza nomi noto'g'ri: ${dbName}`);
  const tpl = process.env.TENANT_DATABASE_URL ?? "";
  if (!tpl.includes("{db}")) throw new Error("TENANT_DATABASE_URL sozlanmagan (masalan postgresql://insof:parol@127.0.0.1:5432/{db})");
  const url = tpl.replace("{db}", dbName);
  // "postgres" — faqat CREATE DATABASE uchun tizim bazasi (provision.ts), unga ma'lumot yozilmaydi
  if (dbName !== "postgres") assertTestDb(url, `Korxona bazasi "${dbName}"`);
  return url;
}

export function tenantDb(dbName: string): TenantClient {
  let c = clients.get(dbName);
  if (!c) {
    // Har korxonaga kichik pul: panel faqat o'qiydi va kamdan-kam yozadi
    const url = new URL(tenantDbUrl(dbName));
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "2");
    const cl = new TenantClient({ datasourceUrl: url.toString(), log: [{ emit: "event", level: "error" }] });
    // Baza yo'q (P1003 — korxona hali yaratilmagan / o'chirilgan) — chaqiruvchi «mavjud emas» deb ko'rsatadi;
    // har so'rov uchun logni prisma:error bilan to'ldirmaymiz. Qolgan xatolar avvalgidek logga.
    cl.$on("error", (e) => { if (!isDbMissingMessage(e.message)) console.error(`prisma:error ${e.message}`); });
    c = cl as unknown as TenantClient;
    clients.set(dbName, c);
  }
  return c;
}

/** Prisma xatosi «baza mavjud emas» (P1003) mi. */
export const isDbMissingMessage = (m: string) => /P1003|Database [`'"]?[^\s`'"]+[`'"]? does not exist/i.test(m);
export function isDbMissing(e: unknown): boolean {
  const code = (e as { code?: unknown; errorCode?: unknown } | null)?.code ?? (e as { errorCode?: unknown } | null)?.errorCode;
  return code === "P1003" || isDbMissingMessage(e instanceof Error ? e.message : String(e));
}
