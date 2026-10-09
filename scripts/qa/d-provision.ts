/**
 * QA (agent D): korxonani lib orqali yaratish — panel tugmasi chaqiradigan `provisionTenant` ning o'zi.
 *   CONTROL_ENV_FILE=<sinov control.env> npx tsx scripts/qa/d-provision.ts <slug> <domen> <direktor-login> <parol>
 * Faqat test rejimida (INSOF_ENV=test) ishlaydi — baza nomi insof_test_t_<slug> (yoki TEST_TENANT_DB_PREFIX<slug>, d-env.sh).
 */
import { loadEnv } from "../env";
loadEnv(process.env.CONTROL_ENV_FILE || "");

async function main() {
  const [slug, domain, login, password] = process.argv.slice(2);
  if (!slug || !login || !password) throw new Error("Ishlatish: d-provision.ts <slug> <domen> <login> <parol>");
  const { isTestMode } = await import("../../src/lib/test-mode");
  if (!isTestMode()) throw new Error("Faqat INSOF_ENV=test (sinov control.env) bilan");
  const { provisionTenant } = await import("@/lib/control/provision");
  const { control } = await import("@/lib/control/db");
  const r = await provisionTenant({
    slug, name: `QA ${slug} beton`, domain: domain || null,
    director: { fullName: `Direktor ${slug}`, login, password },
  });
  await control.controlEvent.create({ data: { tenantId: r.tenant.id, action: "TENANT_CREATE", detail: { slug, viaQa: true } } });
  console.log(JSON.stringify({ slug: r.tenant.slug, db: r.tenant.dbName, port: r.tenant.port, envFile: r.envFile }));
  await control.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); });
