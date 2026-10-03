/**
 * Korxonalar (tenant) bilan ishlash — serverda, markaziy panel .env (control.env) bilan.
 *
 *   npm run tenant -- list
 *   npm run tenant -- register --slug insof --name "Insof beton" --db insof_erp --port 3000 --domain insof-erp.uz
 *       Mavjud (bitta korxonali) o'rnatishni panelga qo'shish. Baza va jarayon o'zgarmaydi.
 *   npm run tenant -- env <slug>         korxona .env faylini (bo'lmasa) yaratish — tenant-up.sh chaqiradi
 *   npm run tenant -- migrate-all        barcha korxona bazalariga `prisma migrate deploy` (deploy.sh chaqiradi)
 *   npm run tenant -- stats              barcha korxonalarni tekshirib, natijani chiqarish (cron uchun ham)
 *   npm run tenant -- sso-key <slug>     korxonaning CONTROL_SSO_KEY qiymati (HMAC(CONTROL_SECRET, slug)) —
 *       eski korxona .env idagi global CONTROL_SECRET o'rniga yoziladi (docs/deploy/PLATFORMA.md)
 */
import { loadEnv } from "./env";
loadEnv(process.env.CONTROL_ENV_FILE || "control.env");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];
  const { control } = await import("@/lib/control/db");
  const prov = await import("@/lib/control/provision");

  if (cmd === "list") {
    const all = await control.tenant.findMany({ orderBy: { port: "asc" } });
    for (const t of all) console.log(`${t.slug.padEnd(16)} ${t.status.padEnd(13)} :${t.port}  ${t.dbName.padEnd(22)} ${t.domain ?? "-"}`);
  } else if (cmd === "register") {
    const slug = arg("slug"), name = arg("name"), dbName = arg("db"), port = Number(arg("port"));
    if (!slug || !name || !dbName || !port) throw new Error("--slug --name --db --port kerak");
    if (!prov.SLUG_RE.test(slug)) throw new Error("slug noto'g'ri");
    const t = await control.tenant.create({
      data: { slug, name, dbName, port, domain: arg("domain") ?? null, internalUrl: arg("url") ?? `http://127.0.0.1:${port}`, status: "ACTIVE", ecoApiUrl: arg("eco") ?? null },
    });
    await control.controlEvent.create({ data: { tenantId: t.id, action: "TENANT_REGISTER", detail: { slug, dbName, port } } });
    console.log(`✓ ${t.name} ro'yxatga olindi. Shu jarayon .env iga TENANT_SLUG=${slug} va CONTROL_SSO_KEY qo'shing: npm run -s tenant -- sso-key ${slug}`);
  } else if (cmd === "env") {
    const slug = process.argv[3];
    const t = await control.tenant.findUniqueOrThrow({ where: { slug } });
    console.log(await prov.writeEnvFile(t));
  } else if (cmd === "migrate-all") {
    const all = await control.tenant.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { port: "asc" } });
    let failed = 0;
    for (const t of all) {
      process.stdout.write(`▶ ${t.slug} (${t.dbName}) … `);
      try { await prov.migrateTenant(t.dbName); console.log("ok"); } catch (e) { failed++; console.log("XATO\n" + (e as Error).message); }
    }
    if (failed) process.exitCode = 1;
  } else if (cmd === "stats") {
    const { collectAll } = await import("@/lib/control/stats");
    const all = await control.tenant.findMany();
    const res = await collectAll();
    for (const t of all) {
      const s = res.get(t.id);
      console.log(`${t.slug.padEnd(16)} web:${s?.web.up ? "ok" : "DOWN"} db:${s?.db.ok ? "ok" : "DOWN"} eco:${s?.eco.configured ? (s.eco.up ? "ok" : "DOWN") : "-"} users:${s?.users.active ?? "-"} orders/oy:${s?.orders.month ?? "-"}`);
    }
  } else if (cmd === "sso-key") {
    const slug = process.argv[3] ?? "";
    if (!prov.SLUG_RE.test(slug)) throw new Error("Ishlatish: npm run -s tenant -- sso-key <slug>");
    const key = prov.tenantSsoKey(slug);
    if (!key) throw new Error("control.env da CONTROL_SECRET yo'q yoki 32 belgidan qisqa");
    console.log(`CONTROL_SSO_KEY=${key}`);
  } else {
    console.log("Buyruqlar: list | register | env <slug> | migrate-all | stats | sso-key <slug>");
  }
  await control.$disconnect();
  process.exit();
}

main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); });
