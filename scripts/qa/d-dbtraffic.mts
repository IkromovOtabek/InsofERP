/**
 * QA (D): Baza va trafik moduli — SQL niqoblash, nginx parserlari, agregator, amal tekshiruvi (unit) + lokal integratsiya.
 *
 *   npx tsx scripts/qa/d-dbtraffic.mts                  unit + integratsiya (~40 s)
 *   DBT_QA_UNIT_ONLY=1 npx tsx scripts/qa/d-dbtraffic.mts   faqat unit testlar (bazasiz)
 *
 * Integratsiya: vaqtinchalik `insof_test_ctl_dbt` (control) va `insof_test_dbt_t1` (korxona) bazalari (boshida qayta
 * yaratiladi, oxirida O'CHIRILADI); haqiqiy insof-agent fixture nginx loglari bilan ishga tushiriladi:
 * db:stats (jadvallar, o'lik qatorlar, tarix), traffic:nginx CRIT (5xx), traffic:upstream:<domen> CRIT + RESTART_UNIT tavsiyasi;
 * PG_CANCEL (faol so'rov → bekor), PG_TERMINATE (faol → rad), VACUUM_ANALYZE (jadval / yo'q jadval / noma'lum baza).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maskSql } from "../../src/lib/control/dbtraffic/sql";
import * as N from "../../src/lib/control/dbtraffic/nginx";
import { validateDbAction, dbConfirmPhrase } from "../../src/lib/control/dbtraffic/contract";
import { updateSizeHistory, asDbStats, asTraffic } from "../../src/lib/control/dbtraffic/types";
import { validateAction } from "../../src/lib/control/monitor/parse";
import { confirmPhrase } from "../../src/lib/control/monitor/shared";
import { readLinesBackward } from "../agent/dbtraffic";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let ok = 0, fail = 0;
function check(name: string, cond: unknown, info?: unknown) {
  if (cond) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${info !== undefined ? ` — ${typeof info === "string" ? info : JSON.stringify(info)?.slice(0, 400)}` : ""}`); }
}
const section = (t: string) => console.log(`\n── ${t}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");
/** nginx $time_local (UTC, +0000) */
const tl = (ms: number) => { const d = new Date(ms); return `${p2(d.getUTCDate())}/${MON[d.getUTCMonth()]}/${d.getUTCFullYear()}:${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000`; };
/** error.log vaqti (mahalliy) */
const el = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };

/* ═════════════════════════ 1. Unit ═════════════════════════ */

section("SQL literallarini yashirish");
{
  const q = `SELECT * FROM "Customer" WHERE phone = '+998901234567' AND name = E'O\\'tkir' AND id IN (1, 2, 3, 4) AND x = $1 AND t1.c > 12.5e3 -- izoh 'maxfiy'\n/* blok 998 */ AND d = $tag$Ali Valiyev$tag$`;
  const m = maskSql(q, 1000);
  check("telefon, ism, sonlar, izohlar yo'q", !/998|O.tkir|Ali|maxfiy|12\.5/.test(m), m);
  check("identifikator va $1, t1 saqlanadi", m.includes(`"Customer"`) && m.includes("$1") && m.includes("t1.c"), m);
  check("IN ro'yxati qisqaradi", /IN \(\?, …\)/.test(m), m);
  check("yopilmagan (kesilgan) literal ham yashiriladi", !maskSql("UPDATE u SET pass = 'secretpa").includes("secret"));
  check("uzun matn qisqartiriladi", maskSql("SELECT " + "a, ".repeat(400) + "b", 100).length <= 100);
  check("bo'sh → bo'sh", maskSql(null) === "");
}

section("nginx access.log");
{
  const now = Date.UTC(2026, 9, 6, 12, 0, 0);
  const comb = `203.0.113.7 - - [${tl(now - 60_000)}] "GET /api/orders/12345?token=abc HTTP/1.1" 502 157 "-" "Mozilla/5.0"`;
  const r = N.parseAccessLine(comb);
  check("combined: ip, status, vaqt", r?.ip === "203.0.113.7" && r?.status === 502 && r?.t === now - 60_000, r);
  check("query string tashlanadi, id → :id", r?.path === "/api/orders/:id", r?.path);
  check("combined: host va rt yo'q", r?.host === null && r?.rt === null);
  const ext = N.parseAccessLine(`10.0.0.1 - - [${tl(now)}] "POST /login HTTP/2.0" 429 0 "https://x/" "ua \\"q\\"" host=Insof-ERP.uz rt=0.250 urt="0.240, 0.010"`);
  check("insof_main: host (kichik harf), rt, urt", ext?.host === "insof-erp.uz" && ext?.rt === 0.25 && ext?.urt === 0.24, ext);
  const vh = N.parseAccessLine(`files.insof-erp.uz:443 198.51.100.2 - - [${tl(now)}] "GET /f/c1234567890abcdefghijklmn.pdf HTTP/1.1" 200 10 "-" "-"`);
  check("vhost_combined: host prefiksi", vh?.host === "files.insof-erp.uz" && vh?.ip === "198.51.100.2", vh);
  const v6 = N.parseAccessLine(`2001:db8::1 - - [${tl(now)}] "GET / HTTP/1.1" 200 1 "-" "-"`);
  check("IPv6 manzil host deb olinmaydi", v6?.ip === "2001:db8::1" && v6?.host === null, v6);
  const bad = N.parseAccessLine(`1.2.3.4 - - [${tl(now)}] "\\x16\\x03\\x01" 400 157 "-" "-"`);
  check("buzuq so'rov satri", bad?.status === 400 && bad?.path.includes("noto'g'ri"), bad);
  check("ixtiyoriy matn → null", N.parseAccessLine("salom dunyo") === null);
  check("normalizePath: uuid, statik", N.normalizePath("/a/0b7c5a2e-1f2a-4c3d-9e8f-0123456789ab/b") === "/a/:id/b" && N.normalizePath("/_next/static/chunks/x.js") === "/_next/static/*");
}

section("nginx error.log");
{
  const now = Date.now();
  const e1 = N.parseErrorLine(`${el(now)} [error] 812#812: *4411 connect() failed (111: Connection refused) while connecting to upstream, client: 203.0.113.9, server: files.insof-erp.uz, request: "GET /f/1?sig=SECRET HTTP/1.1", upstream: "http://127.0.0.1:9010/f/1?sig=SECRET", host: "files.insof-erp.uz"`);
  check("upstream refused: domen, upstream manzil", e1?.kind === "upstream" && e1.sub === "refused" && e1.domain === "files.insof-erp.uz" && e1.upstream === "127.0.0.1:9010", e1);
  check("so'rov/sig chiqmaydi", !JSON.stringify(e1).includes("SECRET"));
  const e2 = N.parseErrorLine(`${el(now)} [warn] 812#812: *9 limiting requests, excess: 10.500 by zone "insof_auth", client: 1.2.3.4, server: insof-erp.uz, request: "POST /login HTTP/1.1", host: "insof-erp.uz"`);
  check("limit_req zonasi", e2?.kind === "limit" && e2.zone === "insof_auth", e2);
  const e3 = N.parseErrorLine(`${el(now)} [error] 1#1: *2 upstream timed out (110: Connection timed out) while reading response header from upstream, client: 1.2.3.4, server: _, request: "GET / HTTP/1.1", upstream: "http://127.0.0.1:3101/", host: "insof-erp.uz:443"`);
  check("timeout, host:port → domen", e3?.sub === "timeout" && e3.domain === "insof-erp.uz", e3);
}

section("Agregator va holat");
{
  const now = Date.now();
  const agg = new N.TrafficAgg(now);
  const mk = (ago: number, ip: string, status: number, host = "insof-erp.uz", rt = 0.1) => N.parseAccessLine(`${ip} - - [${tl(now - ago)}] "GET /p/${status === 429 ? "slow" : "fast"} HTTP/1.1" ${status} 10 "-" "-" host=${host} rt=${rt}`)!;
  for (let i = 0; i < 30; i++) agg.access(mk(60_000, "203.0.113.7", i < 10 ? 502 : 200));
  for (let i = 0; i < 5; i++) agg.access(mk(30 * 60_000, "198.51.100.1", 429, "api.insof-erp.uz", 3));
  check("60 daqiqadan eski → false", agg.access(mk(61 * 60_000, "1.1.1.1", 200)) === false);
  const d = agg.result({ access: "a", error: "e", accessLines: 0, errorLines: 0, truncated: false, problems: [] });
  check("5 daq: 30 so'rov, 5xx 33.3%", d.w5.total === 30 && d.w5.pct5xx === 33.3, d.w5);
  check("60 daq: 35 so'rov, 429 = 5", d.w60.total === 35 && d.w60.s429 === 5, d.w60);
  check("domenlar va IP'lar", d.domains[0].domain === "insof-erp.uz" && d.topIps[0].ip === "203.0.113.7" && d.topIps[0].e5 === 10, { dom: d.domains, ips: d.topIps });
  check("sekin yol: /p/slow o'rtacha 3000 ms", d.slowPaths[0]?.path === "GET /p/slow" && d.slowPaths[0].avgMs === 3000, d.slowPaths);
  check("daqiqalik qator 60-61 ta", d.perMinute.length >= 60 && d.perMinute.length <= 61);
  check("trafficStatus: 33% 5xx → CRIT", N.trafficStatus(d) === "CRIT");
  check("trafficStatus: kam so'rov → OK", N.trafficStatus({ w5: { ...d.w5, total: 5 } }) === "OK");
  check("upstreamStatus: 5 refused → CRIT, 3 → WARN, 1 → OK", N.upstreamStatus({ n5: 5, refused5: 5 }) === "CRIT" && N.upstreamStatus({ n5: 3, refused5: 0 }) === "WARN" && N.upstreamStatus({ n5: 1, refused5: 1 }) === "OK");
  check("asTraffic: o'z natijasini o'qiydi; axlat → null", asTraffic(JSON.parse(JSON.stringify(d)))?.w5.total === 30 && asTraffic({ x: 1 }) === null);
}

section("Amallar: tekshiruv va tasdiq so'zi");
{
  check("PG_CANCEL {db,pid} → ok", validateAction("PG_CANCEL", { db: "insof_erp", pid: "1234" }).ok);
  check("PG_CANCEL pid son ham qabul (satrga)", (validateAction("PG_CANCEL", { db: "insof_erp", pid: 77 }) as { params?: { pid?: string } }).params?.pid === "77");
  for (const bad of ["0", "-1", "12a", "1;SELECT", "99999999999", ""]) check(`PG_CANCEL pid "${bad}" → rad`, !validateAction("PG_CANCEL", { db: "insof_erp", pid: bad }).ok);
  for (const bad of ["Insof", "a", "insof erp", "insof_erp;", "../x"]) check(`db "${bad}" → rad`, !validateAction("PG_TERMINATE", { db: bad, pid: "5" }).ok);
  check("VACUUM_ANALYZE jadvalsiz → ok", validateAction("VACUUM_ANALYZE", { db: "insof_erp" }).ok);
  check("VACUUM_ANALYZE \"Product\" → ok", validateAction("VACUUM_ANALYZE", { db: "insof_erp", table: "Product" }).ok);
  for (const bad of [`x"; DROP TABLE y; --`, "public.Product", "a b", "1abc", "a".repeat(64)]) check(`jadval "${bad.slice(0, 20)}" → rad`, !validateAction("VACUUM_ANALYZE", { db: "insof_erp", table: bad }).ok);
  const v = validateDbAction("PG_CANCEL", { db: "insof_erp", pid: "5", extra: "rm -rf /" });
  check("ortiqcha parametr tashlanadi", v?.ok === true && !("extra" in v.params), v);
  check("tasdiq: PG_CANCEL → pid, TERMINATE → TASDIQLAYMAN, VACUUM → baza", confirmPhrase("PG_CANCEL", { pid: "42" }) === "42" && confirmPhrase("PG_TERMINATE", {}) === "TASDIQLAYMAN" && confirmPhrase("VACUUM_ANALYZE", { db: "insof_erp" }) === "insof_erp");
  check("boshqa tur — dbConfirmPhrase undefined", dbConfirmPhrase("RUN_BACKUP", {}) === undefined && confirmPhrase("RUN_BACKUP", {}) === null);
}

section("Hajm tarixi (kunlik o'sish)");
{
  const h0 = updateSizeHistory(undefined, "2026-10-06", 100);
  check("birinchi kun: o'sish noma'lum", h0.growth1d === null && h0.hist.length === 1);
  const h1 = updateSizeHistory([["2026-09-28", 50], ["2026-10-05", 90], ["2026-10-06", 95]], "2026-10-06", 100);
  check("kechagidan +10, 7 kundan oldingidan +50, bugungi qayta yoziladi", h1.growth1d === 10 && h1.growth7d === 50 && h1.hist.length === 3 && h1.hist[2][1] === 100, h1);
  check("kecha yo'q → 1 kunlik null", updateSizeHistory([["2026-10-01", 1]], "2026-10-06", 5).growth1d === null);
  const many = Array.from({ length: 50 }, (_, i) => [`2026-08-${p2((i % 28) + 1)}`, i] as [string, number]);
  check("35 kundan oshmaydi", updateSizeHistory(many, "2026-10-06", 1).hist.length <= 35);
}

const TMP = path.join(os.tmpdir(), `insof-qa-dbt-${process.pid}`);
mkdirSync(TMP, { recursive: true });

section("Logni oxiridan o'qish (rotatsiya bilan)");
{
  const f = path.join(TMP, "big.log");
  const lines = Array.from({ length: 50_000 }, (_, i) => `qator ${i} ${"ü".repeat(i % 7)}`);
  writeFileSync(f, lines.join("\n") + "\n");
  const got: string[] = [];
  const res = await readLinesBackward(f, (l) => { got.push(l); return got.length < 10; }, { bytes: 1e9 });
  check("oxirgi qatordan boshlaydi va to'xtaydi", res === "stopped" && got[0] === lines[49_999] && got.length === 10, got.slice(0, 2));
  const all: string[] = [];
  await readLinesBackward(f, (l) => { all.push(l); return true; }, { bytes: 1e9 });
  check("hamma qatorlar to'g'ri (chunk chegarasida UTF-8 buzilmaydi)", all.length === 50_000 && all.reverse().every((l, i) => l === lines[i]));
  const lim = await readLinesBackward(f, () => true, { bytes: 300_000 });
  check("bayt chegarasi", lim === "limit");
}

section("Panel himoyasi: sahifalar sessiyasi, qayta autentifikatsiya, bitta deploy");
{
  const { readFileSync } = await import("node:fs");
  const { needsReauth } = await import("../../src/lib/control/monitor/shared");
  const panel = path.join(REPO, "src/app/superadmin/(panel)");
  for (const pg of ["baza", "server", "trafik", "zaxira", "loglar", "relizlar"]) {
    const src = readFileSync(path.join(panel, pg, "page.tsx"), "utf8");
    const body = src.slice(src.indexOf("export default async function"));
    const first = body.split("\n")[1]?.trim() ?? "";
    check(`${pg}/page.tsx: boshida await requireAdmin()`, src.includes('import { requireAdmin } from "@/lib/control/auth"') && first.startsWith("await requireAdmin()"), first);
  }
  check("PG_TERMINATE — qayta parol, PG_CANCEL/VACUUM — yo'q", needsReauth("PG_TERMINATE") && !needsReauth("PG_CANCEL") && !needsReauth("VACUUM_ANALYZE"));
  const ma = readFileSync(path.join(panel, "monitor-actions.ts"), "utf8");
  const tx = ma.slice(ma.indexOf("control.$transaction"), ma.indexOf("tx.agentAction.create"));
  check("enqueueAction: parol tekshiruvi (verifyReauth) bor", /needsReauth\(type\)/.test(ma) && /verifyReauth\(/.test(ma));
  check("enqueueAction: DEPLOY/ROLLBACK band tekshiruvi advisory lock tranzaksiyasida, create'dan oldin", tx.includes("pg_advisory_xact_lock") && tx.includes("DETACHED_ACTIONS"), tx.slice(0, 300));
  const rel = readFileSync(path.join(panel, "relizlar/actions.ts"), "utf8");
  check("relizlar/actions.ts: tranzaksiyasiz alohida busy() yo'q", !/async function busy\(/.test(rel));
}

if (process.env.DBT_QA_UNIT_ONLY) finish();

/* ═════════════════════════ 2. Integratsiya ═════════════════════════ */

const D_PFX = process.env.D_DB_PREFIX || "insof_test_"; // d-env.sh D_DB_PREFIX — parallel yugurishlar uchun
const CTL = `${D_PFX}ctl_dbt`;
const T1 = `${D_PFX}dbt_t1`;
const PGUSER = process.env.D_PGUSER || os.userInfo().username;
const PG = `postgresql://${PGUSER}@localhost:5432`;
const TSX = path.join(REPO, "node_modules/tsx/dist/cli.mjs");
let agent: ChildProcess | null = null;
let agentLog = "";
const psql = (db: string, sql: string) => spawnSync("psql", [`${PG}/${db}`, "-qAtX", "-c", sql], { encoding: "utf8" });

async function until<T>(fn: () => Promise<T | null | undefined | false>, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* hali */ } await sleep(800); }
  return null;
}

async function integration() {
  section("Integratsiya: tayyorlash");
  for (const db of [CTL, T1]) { psql("postgres", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); check(`${db} yaratildi`, psql("postgres", `CREATE DATABASE ${db}`).status === 0); }
  const mig = spawnSync(process.execPath, [path.join(REPO, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", "prisma/control/schema.prisma"], { cwd: REPO, encoding: "utf8", env: { ...process.env, CONTROL_DATABASE_URL: `${PG}/${CTL}` } });
  check("control migratsiyasi", mig.status === 0, mig.stderr?.slice(-300));
  const seed = psql(T1, `CREATE TABLE "Product"(id serial primary key, name text) WITH (autovacuum_enabled = false); INSERT INTO "Product"(name) SELECT 'p'||g FROM generate_series(1,30000) g; DELETE FROM "Product" WHERE id % 2 = 0; ANALYZE "Product";`);
  check("korxona bazasi: Product (o'lik qatorlar bilan)", seed.status === 0, seed.stderr);
  psql(CTL, `INSERT INTO "Tenant"(id, slug, name, "internalUrl", port, "dbName", status, "updatedAt") VALUES ('t1', 't1', 'T1', 'http://127.0.0.1:9010', 9010, '${T1}', 'SUSPENDED', now())`);

  const now = Date.now();
  const acc: string[] = [];
  for (let i = 0; i < 40; i++) acc.push(`203.0.113.7 - - [${tl(now - 3 * 60_000 + i * 1000)}] "GET /api/x/${i} HTTP/1.1" ${i % 2 ? 502 : 200} 10 "-" "-" host=insof-erp.uz rt=0.${i % 9 + 1}`);
  const old = Array.from({ length: 5 }, (_, i) => `198.51.100.1 - - [${tl(now - 3 * 3600_000 + i)}] "GET /eski HTTP/1.1" 200 1 "-" "-"`);
  writeFileSync(path.join(TMP, "access.log.1"), old.join("\n") + "\n" + `198.51.100.1 - - [${tl(now - 20 * 60_000)}] "GET /rot HTTP/1.1" 200 1 "-" "-"\n`);
  writeFileSync(path.join(TMP, "access.log"), acc.join("\n") + "\n");
  const errs = Array.from({ length: 6 }, () => `${el(now - 60_000)} [error] 1#1: *1 connect() failed (111: Connection refused) while connecting to upstream, client: 1.2.3.4, server: files.insof-erp.uz, request: "GET /f HTTP/1.1", upstream: "http://127.0.0.1:9010/f", host: "files.insof-erp.uz"`);
  writeFileSync(path.join(TMP, "error.log"), errs.join("\n") + "\n");
  mkdirSync(path.join(TMP, "app/tenants"), { recursive: true });
  writeFileSync(path.join(TMP, "app/control.env"), `INSOF_ENV=test\nCONTROL_DATABASE_URL=${PG}/${CTL}\nTENANT_DATABASE_URL=${PG}/{db}\n`);

  agent = spawn(process.execPath, [TSX, "scripts/insof-agent.ts"], {
    cwd: REPO, stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: os.homedir(), TMPDIR: os.tmpdir(),
      CONTROL_ENV_FILE: path.join(TMP, "app/control.env"), AGENT_APP_DIR: path.join(TMP, "app"),
      AGENT_ECO_URL: "", AGENT_SSL_DOMAINS: "", BACKUP_ENV: path.join(TMP, "none.env"), AGENT_BACKUP_DIR: path.join(TMP, "backups"),
      AGENT_FAST_MS: "5000", AGENT_SLOW_MS: "6000", AGENT_TRAFFIC_MS: "4000", AGENT_ACTION_POLL_MS: "1000",
      AGENT_NGINX_ACCESS_LOG: path.join(TMP, "access.log"), AGENT_NGINX_ERROR_LOG: path.join(TMP, "error.log"),
    },
  });
  agent.stdout!.on("data", (b) => { agentLog += b; });
  agent.stderr!.on("data", (b) => { agentLog += b; });

  process.env.CONTROL_DATABASE_URL = `${PG}/${CTL}`;
  const { PrismaClient } = await import("../../src/generated/control/index.js");
  const db = new PrismaClient();
  try {
    section("Integratsiya: db:stats");
    const row = await until(async () => db.serviceCheck.findUnique({ where: { key: "db:stats" } }), 40_000);
    const d = asDbStats(row?.data);
    check("db:stats yozildi (kind db)", row?.kind === "db" && !!d, agentLog.slice(-800));
    if (d) {
      const t1 = d.databases.find((x) => x.name === T1);
      check("ikkala baza, egasi bilan", !!t1 && t1.owner === "t1" && d.databases.find((x) => x.name === CTL)?.owner === "control", d.databases.map((x) => [x.name, x.owner]));
      check("Product jadvali top ro'yxatda, o'lik qatorlar", !!t1?.detail?.tables.find((t) => t.name === "Product" && (t.dead ?? 0) > 0), t1?.detail);
      check("hajm tarixi bugun bilan", Array.isArray(d.history[T1]) && d.history[T1].length === 1);
      check("ulanishlar va max", d.connections.total > 0 && d.connections.max > 0);
      check("pg_stat_statements holati aniqlangan", ["ok", "not_installed", "not_loaded"].includes(d.statements.state), d.statements);
    }
    const snap = await (await import("../../src/lib/control/monitor/snapshot")).loadMonitorSnapshot().catch(() => null);
    check("monitoring surati db:stats data'sini yubormaydi", !snap || snap.checks.find((c) => c.key === "db:stats")?.data === null);

    section("Integratsiya: trafik");
    const tr = await until(async () => db.serviceCheck.findUnique({ where: { key: "traffic:nginx" } }), 30_000);
    const td = asTraffic(tr?.data);
    check("traffic:nginx CRIT (50% 5xx)", tr?.status === "CRIT" && td?.w5.total === 40, { st: tr?.status, msg: tr?.message });
    check("rotatsiya qilingan .1 dan 60 daq ichidagi qator olindi, eskisi yo'q", td?.w60.total === 41 && !td?.topIps.some((x) => x.topPath === "/eski"), td?.w60);
    check("$host va $request_time aniqlandi", td?.format.hasHost === true && td.format.hasRequestTime === true);
    const up = await until(async () => db.serviceCheck.findUnique({ where: { key: "traffic:upstream:files.insof-erp.uz" } }), 15_000);
    check("files.insof-erp.uz upstream CRIT", up?.status === "CRIT", up);
    const inc = await until(async () => db.incident.findFirst({ where: { key: "traffic:upstream:files.insof-erp.uz", status: "OPEN" } }), 15_000);
    check("hodisa ochildi + RESTART_UNIT insof-erp@t1 tavsiyasi", !!inc && JSON.stringify(inc.suggestedActions).includes("insof-erp@t1"), inc);
    check("traffic:nginx hodisasi", !!(await db.incident.findFirst({ where: { key: "traffic:nginx", status: "OPEN" } })));

    section("Integratsiya: amallar");
    const runAct = async (type: string, params: object) => {
      const a = await db.agentAction.create({ data: { type, params } });
      return until(async () => { const r = await db.agentAction.findUnique({ where: { id: a.id } }); return r && !["PENDING", "RUNNING"].includes(r.status) ? r : null; }, 30_000);
    };
    // Faol uzoq so'rov (shu rol) — psql fon jarayoni
    const sleeper = spawn("psql", [`${PG}/${T1}`, "-qAtX", "-c", "SELECT pg_sleep(25) /* qa-sleeper 998901234567 */"], { stdio: ["ignore", "pipe", "pipe"] });
    let sleeperErr = ""; sleeper.stderr!.on("data", (b) => { sleeperErr += b; }); const sleeperDone = new Promise((r) => { sleeper.on("exit", r); setTimeout(r, 40_000); });
    const pid = await until(async () => { const r = psql("postgres", `SELECT pid FROM pg_stat_activity WHERE query LIKE '%qa-sleeper%' AND pid <> pg_backend_pid() AND state = 'active'`).stdout.trim(); return r ? r.split("\n")[0] : null; }, 10_000);
    check("sinov so'rovi ishga tushdi", !!pid);
    const term = await runAct("PG_TERMINATE", { db: T1, pid: String(pid) });
    check("PG_TERMINATE faol so'rovga → REJECTED", term?.status === "REJECTED", term?.output);
    const wrongDb = await runAct("PG_CANCEL", { db: CTL, pid: String(pid) });
    check("PG_CANCEL boshqa bazadagi pid bilan → FAILED (topilmadi)", wrongDb?.status === "FAILED", wrongDb?.output);
    const cancel = await runAct("PG_CANCEL", { db: T1, pid: String(pid) });
    check("PG_CANCEL → DONE", cancel?.status === "DONE", cancel?.output);
    check("natijada so'rov qiymati yashirin", !!cancel?.output && !cancel.output.includes("998901234567") && cancel.output.includes("pg_sleep"), cancel?.output);
    await sleeperDone;
    check("psql «canceling statement» oldi", /cancel/i.test(sleeperErr), sleeperErr);
    const unk = await runAct("PG_CANCEL", { db: "insof_test_begona", pid: "1" });
    check("ro'yxatda yo'q baza → REJECTED", unk?.status === "REJECTED", unk?.output);
    const vac = await runAct("VACUUM_ANALYZE", { db: T1, table: "Product" });
    check("VACUUM_ANALYZE Product → DONE, o.lik qatorlar 0 ga", vac?.status === "DONE" && vac.output?.includes(`"Product"`) && /15000 → 0/.test(vac.output ?? ""), vac?.output);
    const vacAll = await runAct("VACUUM_ANALYZE", { db: T1 });
    check("VACUUM_ANALYZE butun baza → DONE", vacAll?.status === "DONE", vacAll?.output);
    const vacNo = await runAct("VACUUM_ANALYZE", { db: T1, table: "Yoq" });
    check("mavjud bo'lmagan jadval → FAILED", vacNo?.status === "FAILED", vacNo?.output);
    const inj = await runAct("VACUUM_ANALYZE", { db: T1, table: `Product"; DROP TABLE "Product` });
    check("in'ektsiya → REJECTED, jadval joyida", inj?.status === "REJECTED" && psql(T1, `SELECT count(*) FROM "Product"`).stdout.trim() === "15000", inj?.output);
  } finally {
    await db.$disconnect();
  }
}

function finish(): never {
  rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${ok} o'tdi, ${fail} xato\x1b[0m`);
  process.exit(fail ? 1 : 0);
}

try { await integration(); }
catch (e) { check("integratsiya yiqilmadi", false, (e as Error).stack); }
finally {
  if (agent) { agent.kill("SIGTERM"); await new Promise((r) => { agent!.on("exit", r); setTimeout(r, 15_000); }); }
  for (const db of [CTL, T1]) psql("postgres", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  check("vaqtinchalik bazalar o'chirildi", !psql("postgres", `SELECT 1 FROM pg_database WHERE datname IN ('${CTL}','${T1}')`).stdout.includes("1"));
}
finish();
