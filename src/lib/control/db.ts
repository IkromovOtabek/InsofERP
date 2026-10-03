import { PrismaClient as ControlClient } from "@/generated/control";
import { PrismaClient as TenantClient } from "@/generated/prisma";

/**
 * Markaziy panel bazalari.
 *  - `control` — korxonalar ro'yxati, superadminlar, jurnal (CONTROL_DATABASE_URL).
 *  - `tenantDb(dbName)` — korxona bazasiga to'g'ridan-to'g'ri ulanish (yaratish, direktor, statistika).
 *    Manzil shablondan: TENANT_DATABASE_URL="postgresql://insof:***@127.0.0.1:5432/{db}".
 */
const g = globalThis as unknown as { controlDb?: ControlClient; tenantClients?: Map<string, TenantClient> };

export const control = g.controlDb ?? new ControlClient({ log: ["error"] });
if (process.env.NODE_ENV !== "production") g.controlDb = control;

const clients = (g.tenantClients ??= new Map());

/** Baza nomi faqat shu ko'rinishda — SQL'ga identifikator sifatida qo'yiladi. */
export const DB_NAME_RE = /^[a-z][a-z0-9_]{2,62}$/;

export function tenantDbUrl(dbName: string): string {
  if (!DB_NAME_RE.test(dbName)) throw new Error(`Baza nomi noto'g'ri: ${dbName}`);
  const tpl = process.env.TENANT_DATABASE_URL ?? "";
  if (!tpl.includes("{db}")) throw new Error("TENANT_DATABASE_URL sozlanmagan (masalan postgresql://insof:parol@127.0.0.1:5432/{db})");
  return tpl.replace("{db}", dbName);
}

export function tenantDb(dbName: string): TenantClient {
  let c = clients.get(dbName);
  if (!c) {
    // Har korxonaga kichik pul: panel faqat o'qiydi va kamdan-kam yozadi
    const url = new URL(tenantDbUrl(dbName));
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "2");
    c = new TenantClient({ datasourceUrl: url.toString(), log: ["error"] });
    clients.set(dbName, c);
  }
  return c;
}
