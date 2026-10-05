import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { control, tenantDb, tenantDbUrl, DB_NAME_RE } from "./db";
import { passwordProblem } from "../password-policy";
import { deriveTenantSsoKey } from "./token";
import { isTestMode } from "../test-mode";
import type { Tenant } from "@/generated/control";

const run = promisify(execFile);

/**
 * Yangi korxonani tayyorlash (superadmin paneli va `npm run tenant` skripti bitta joydan):
 *  1. control bazada Tenant qatori (PROVISIONING), bo'sh port
 *  2. CREATE DATABASE insof_t_<slug>
 *  3. prisma migrate deploy — korxona bazasida barcha jadvallar
 *  4. Rekvizitlar (nomi) + DIREKTOR hisobi (login/parol superadmin beradi)
 *  5. Jarayon uchun .env fayl (TENANTS_DIR/<slug>.env) — serverda `sudo bash scripts/tenant-up.sh <slug>`
 * Jarayon ishga tushib /login javob bersa, holat avtomatik ACTIVE bo'ladi (statistika yangilanganda).
 */

export const SLUG_RE = /^[a-z][a-z0-9-]{1,29}$/;
const RESERVED = new Set(["admin", "superadmin", "www", "api", "app", "eco", "mail", "control", "static", "test"]);
// Birinchi korxona porti. Lokal sinovda boshqa jarayonlar bilan to'qnashmasin deb TENANT_FIRST_PORT bilan o'zgartiriladi.
const firstPort = () => {
  const n = Number(process.env.TENANT_FIRST_PORT);
  return Number.isInteger(n) && n >= 1024 && n < 65000 ? n : 3101;
};

export const tenantsDir = () => process.env.TENANTS_DIR || path.join(process.cwd(), "tenants");
/**
 * Korxona bazasi nomi. Test rejimida (INSOF_ENV=test — lib/test-mode.ts) prefiks `insof_test_t_`:
 * test himoyasi faqat `insof_test…` bazalarini qabul qiladi. Prodda test rejimi yoqilmaydi (server real
 * kalitlar yoki test bo'lmagan baza bilan ishga tushmaydi), shuning uchun bu tarmoq prodga ta'sir qilmaydi.
 */
export const dbNameFor = (slug: string) => `${isTestMode() ? "insof_test_t_" : "insof_t_"}${slug.replace(/-/g, "_")}`;
export const envPathFor = (slug: string) => path.join(tenantsDir(), `${slug}.env`);

export type NewTenantInput = {
  slug: string; name: string; domain?: string | null; plan?: string;
  contactName?: string | null; contactPhone?: string | null; note?: string | null; ecoApiUrl?: string | null;
  director: { fullName: string; login: string; password: string };
};

export function validateNewTenant(i: NewTenantInput): string | null {
  if (!SLUG_RE.test(i.slug)) return "Qisqa nom: lotin kichik harf, raqam va chiziqcha (2–30 belgi), harf bilan boshlansin";
  if (RESERVED.has(i.slug)) return `"${i.slug}" nomi band (tizim uchun) — boshqasini tanlang`;
  if (i.name.trim().length < 2) return "Korxona nomi kerak";
  if (i.domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(i.domain)) return "Domen noto'g'ri (masalan zavod2.insof.uz)";
  if (i.director.fullName.trim().length < 3) return "Direktorning F.I.O. kerak";
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(i.director.login)) return "Direktor logini: 3–40 belgi, lotin harf, raqam, nuqta, chiziqcha";
  return passwordProblem(i.director.password);
}

async function nextPort(): Promise<number> {
  const first = firstPort();
  const max = await control.tenant.aggregate({ _max: { port: true }, where: { port: { gte: first } } });
  return Math.max(first, (max._max.port ?? first - 1) + 1);
}

async function createDatabase(dbName: string) {
  if (!DB_NAME_RE.test(dbName)) throw new Error("Baza nomi noto'g'ri");
  // "postgres" tizim bazasi orqali — CREATE DATABASE tranzaksiya ichida ishlamaydi
  const admin = tenantDb("postgres");
  const exists = await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT 1 AS n FROM pg_database WHERE datname = $1`, dbName);
  if (exists.length) throw new Error(`"${dbName}" bazasi allaqachon bor — boshqa qisqa nom tanlang yoki eskisini qo'lda tekshiring`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
}

/** Korxona bazasiga migratsiya — `prisma migrate deploy` (asosiy sxema, korxona DATABASE_URL bilan). */
export async function migrateTenant(dbName: string): Promise<string> {
  const bin = path.join(process.cwd(), "node_modules", ".bin", "prisma");
  const { stdout, stderr } = await run(bin, ["migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: tenantDbUrl(dbName) },
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return `${stdout}\n${stderr}`.trim();
}

/** Direktor hisobi: bo'lsa — parol/ism yangilanadi va eski sessiyalari kuyadi; bo'lmasa yaratiladi. */
export async function setDirector(dbName: string, d: { fullName: string; login: string; password: string }) {
  const problem = passwordProblem(d.password);
  if (problem) throw new Error(problem);
  const db = tenantDb(dbName);
  const passwordHash = await bcrypt.hash(d.password, 10);
  const taken = await db.user.findUnique({ where: { login: d.login }, select: { id: true, role: true } });
  if (taken && taken.role !== "DIRECTOR") throw new Error(`"${d.login}" logini korxonada boshqa xodimga tegishli`);
  if (taken) {
    await db.user.update({
      where: { id: taken.id },
      data: { passwordHash, fullName: d.fullName, isActive: true, sessionVersion: { increment: 1 } },
    });
    return { id: taken.id, created: false };
  }
  const u = await db.user.create({ data: { login: d.login, fullName: d.fullName, role: "DIRECTOR", passwordHash } });
  return { id: u.id, created: true };
}

/** To'xtatish / qayta yoqish — korxona bazasidagi belgi: xodimlar veb va mobilda darhol chiqib ketadi. */
export async function setSuspended(dbName: string, suspended: boolean, reason?: string | null) {
  await tenantDb(dbName).companySettings.upsert({
    where: { id: "main" },
    update: { suspendedAt: suspended ? new Date() : null, suspendReason: suspended ? reason ?? null : null },
    create: { id: "main", suspendedAt: suspended ? new Date() : null, suspendReason: suspended ? reason ?? null : null },
  });
}

/** Korxona SSO kaliti — HMAC(CONTROL_SECRET, slug). Panelda CONTROL_SECRET bo'lmasa bo'sh (SSO o'chiq). */
export function tenantSsoKey(slug: string): string {
  const secret = (process.env.CONTROL_SECRET ?? "").trim();
  return secret.length >= 32 ? deriveTenantSsoKey(secret, slug) : "";
}

const rnd = (bytes: number) => randomBytes(bytes).toString("base64url");

/**
 * Korxona jarayonining .env fayli. Sirlar shu yerda yaratiladi va faqat serverdagi faylda qoladi (0600).
 * Global CONTROL_SECRET bu yerga YOZILMAYDI — faqat shu korxonaga xos hosila kalit (CONTROL_SSO_KEY).
 */
export function renderEnv(t: Pick<Tenant, "slug" | "port" | "dbName" | "domain" | "ecoApiUrl">): string {
  const dataRoot = process.env.TENANT_DATA_ROOT || "/var/lib/insof";
  const url = t.domain ? `https://${t.domain}` : "";
  return [
    `# Insof ERP — "${t.slug}" korxonasi jarayoni. Markaziy panel yaratgan: ${new Date().toISOString()}`,
    `# Ishga tushirish: sudo bash scripts/tenant-up.sh ${t.slug}`,
    `# Barcha kalitlar va izohlari: .env.example`,
    `NODE_ENV=production`,
    `TZ=Asia/Tashkent`,
    `PORT=${t.port}`,
    `TENANT_SLUG=${t.slug}`,
    `DATABASE_URL=${tenantDbUrl(t.dbName)}`,
    `AUTH_SECRET=${randomBytes(48).toString("base64")}`,
    `# Markaziy panel SSO kaliti — HMAC(CONTROL_SECRET, "${t.slug}"): faqat shu korxona uchun yaroqli`,
    `CONTROL_SSO_KEY=${tenantSsoKey(t.slug)}`,
    `UPLOADS_DIR=${dataRoot}/${t.slug}/uploads`,
    `APP_URL=${url}`,
    // Panel test rejimida bo'lsa (lokal QA) — korxona ham test rejimida: real kalitsiz, lokal OSRM
    ...(isTestMode() ? [`INSOF_ENV=test`, `OSRM_URL=http://127.0.0.1:9`] : []),
    ``,
    `# ── Webhook sirlari (yaratilganda tasodifiy) ──`,
    `# Telegram: ENV_FILE=tenants/${t.slug}.env npm run bot:webhook -- ${url || "https://<domen>"}`,
    `TELEGRAM_WEBHOOK_SECRET=${rnd(32)}`,
    `# ECO → ERP webhook imzosi: ECO'da integration:create bergan qiymat bilan ALMASHTIRING`,
    `ECO_WEBHOOK_SECRET=${rnd(32)}`,
    ``,
    `# ── Ixtiyoriy integratsiyalar (korxonaning o'z kalitlari; bo'sh — o'chiq) ──`,
    `ECO_API_URL=${t.ecoApiUrl ?? ""}`,
    `ECO_API_KEY=`,
    `ANTHROPIC_API_KEY=`,
    `GROQ_API_KEY=`,
    `TELEGRAM_BOT_TOKEN=`,
    `TELEGRAM_GATEWAY_TOKEN=`,
    `EXPO_ACCESS_TOKEN=`,
    `DGIS_API_KEY=`,
    `YANDEX_SUGGEST_KEY=`,
    `YANDEX_GEOCODER_KEY=`,
    `YANDEX_ROUTER_KEY=`,
    `# OSRM_URL=http://127.0.0.1:5000   # o'z OSRM serveringiz (bo'sh — ochiq router.project-osrm.org)`,
    ``,
  ].join("\n");
}

export async function writeEnvFile(t: Pick<Tenant, "slug" | "port" | "dbName" | "domain" | "ecoApiUrl">): Promise<string> {
  const file = envPathFor(t.slug);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, renderEnv(t), { mode: 0o600, flag: "wx" }).catch(async (e: NodeJS.ErrnoException) => {
    // Mavjud faylni (qo'lda to'ldirilgan kalitlar bilan) bosib yozmaymiz
    if (e.code !== "EEXIST") throw e;
  });
  return file;
}

export type ProvisionResult = { tenant: Tenant; envFile: string; migrateLog: string };

export async function provisionTenant(input: NewTenantInput): Promise<ProvisionResult> {
  const err = validateNewTenant(input);
  if (err) throw new Error(err);
  if (await control.tenant.findUnique({ where: { slug: input.slug } })) throw new Error("Bu qisqa nomli korxona bor");
  if (input.domain && (await control.tenant.findUnique({ where: { domain: input.domain } }))) throw new Error("Bu domen boshqa korxonaga ulangan");

  const port = await nextPort();
  const dbName = dbNameFor(input.slug);
  const tenant = await control.tenant.create({
    data: {
      slug: input.slug, name: input.name.trim(), domain: input.domain || null, plan: input.plan || "standard",
      contactName: input.contactName || null, contactPhone: input.contactPhone || null, note: input.note || null,
      ecoApiUrl: input.ecoApiUrl || null, port, dbName, internalUrl: `http://127.0.0.1:${port}`,
      directorLogin: input.director.login, status: "PROVISIONING",
    },
  });
  let dbCreated = false;
  try {
    await createDatabase(dbName);
    dbCreated = true;
    const migrateLog = await migrateTenant(dbName);
    const db = tenantDb(dbName);
    await db.companySettings.upsert({ where: { id: "main" }, update: { name: tenant.name }, create: { id: "main", name: tenant.name } });
    // reset-data.ts bilan bir xil minimum: faol "Asosiy sklad" (lib/trips.ts faol sklad bo'lishini talab qiladi).
    // Kassa/bank hisoblari reset-data'da ham yaratilmaydi — direktor Sozlamalar sahifasidan qo'shadi.
    await db.warehouse.upsert({ where: { id: "main" }, update: { isActive: true }, create: { id: "main", name: "Asosiy sklad", isActive: true } });
    await setDirector(dbName, input.director);
    const envFile = await writeEnvFile(tenant);
    return { tenant, envFile, migrateLog };
  } catch (e) {
    // Baza ham yaratilmagan bo'lsa — iz qoldirmaymiz (shu nom bilan qayta urinish mumkin).
    // Baza yaratilgan bo'lsa qator qoladi: panelda xato ko'rinadi, IT qo'lda tekshiradi (ma'lumot o'chirilmaydi).
    if (!dbCreated) await control.tenant.delete({ where: { id: tenant.id } });
    else await control.tenant.update({ where: { id: tenant.id }, data: { lastError: `Yaratishda xato: ${(e as Error).message}`.slice(0, 1000) } });
    throw e;
  }
}
