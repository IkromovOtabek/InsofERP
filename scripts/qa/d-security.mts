/**
 * QA (agent D): kiberxavfsizlik moduli (src/lib/control/security) — tizimga tegmaydigan sinov.
 *   npx tsx scripts/qa/d-security.mts
 *
 *  1. Parser/evaluator'lar fixture'lar bilan: journald SSH qatorlari, sshd_config variantlari (Include bilan), ss chiqishi,
 *     ufw, sir fayllari huquqi (vaqtinchalik papka), HTTP sarlavhalar (soxta fetch), nginx log, apt, npm audit (sharp), ilova telemetriyasi.
 *  2. runSecurityChecks — shu mashinada (macOS'da journalctl/ss/ufw yo'q) xato tashlamaydi, yo'q vositalar UNKNOWN/INFO.
 *  3. runAiAnalysis — test rejimida stub (haqiqiy API chaqirilmaydi) → SecurityReport qatori; AI hodisasi takrorlanmaydi.
 *
 * Baza: faqat vaqtinchalik `insof_test_ctl_sec` (lokal, joriy foydalanuvchi) — migrate deploy, oxirida o'chiriladi.
 * Haqiqiy .env, insof_erp / insof_test bazalari va tashqi API'larga tegilmaydi.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PGUSER = process.env.D_PGUSER || os.userInfo().username;
const PG = `postgresql://${PGUSER}@127.0.0.1:5432`;
const DB = "insof_test_ctl_sec";
const TMP = mkdtempSync(path.join(os.tmpdir(), "insof-sec-"));

// Test muhiti — modullar import qilinishidan OLDIN (db.ts import paytida tekshiradi)
Object.assign(process.env, {
  INSOF_ENV: "test",
  CONTROL_DATABASE_URL: `${PG}/${DB}?connection_limit=3`,
  TENANT_DATABASE_URL: `${PG}/{db}`,
  ANTHROPIC_API_KEY: "",
  CONTROL_ENV_FILE: "",
  TENANT_BASE_DOMAIN: "",
  CONTROL_DOMAIN: "",
  NGINX_ACCESS_LOG: path.join(TMP, "yo'q-access.log"),
  INSOF_BACKUP_ENV: path.join(TMP, "backup.env"),
  INSOF_SECURITY_CACHE_DIR: path.join(TMP, "cache"),
});

let fails = 0, oks = 0;
function check(ok: unknown, name: string, extra = "") {
  if (ok) { oks++; console.log(`\x1b[1;32mPASS\x1b[0m ${name}`); }
  else { fails++; console.log(`\x1b[1;31mFAIL\x1b[0m ${name}${extra ? ` — ${extra}` : ""}`); }
}
const psql = (sql: string) => spawnSync("psql", [`${PG}/postgres`, "-qAtc", sql], { encoding: "utf8" });

const P = await import("../../src/lib/control/security/parsers");
const H = await import("../../src/lib/control/security/host-checks");
const A = await import("../../src/lib/control/security/app-checks");
const { ACTION_TYPES, IPV4_RE } = await import("../../src/lib/control/monitor/contract");
type Finding = import("../../src/lib/control/security/types").Finding;
const byKey = (fs: Finding[], name: string) => fs.find((f) => f.key === `security:${name}`);
const SEVS = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
function validShape(f: Finding): boolean {
  return /^security:[a-z0-9-]+$/.test(f.key) && ["security", "config", "update", "certificate"].includes(f.category) && SEVS.includes(f.severity)
    && typeof f.title === "string" && f.title.length > 0
    && (f.suggestedActions ?? []).every((a) => (ACTION_TYPES as readonly string[]).includes(a.type) && (a.type !== "BLOCK_IP" || IPV4_RE.test(a.params?.ip ?? "")));
}

try {
  /* ═════════ 1. SSH ═════════ */
  const now = Date.UTC(2026, 9, 6, 10, 0, 0);
  const t = (minAgo: number) => ((now - minAgo * 60_000) / 1000).toFixed(6);
  const sshLines: string[] = [];
  for (let i = 0; i < 14; i++) sshLines.push(`${t(5 + i)} vps sshd[100${i}]: Failed password for root from 203.0.113.7 port ${40000 + i} ssh2`);
  for (let i = 0; i < 6; i++) sshLines.push(`${t(10 + i)} vps sshd[200${i}]: Invalid user admin from 198.51.100.9 port ${50000 + i}`);
  for (let i = 0; i < 6; i++) sshLines.push(`${t(10 + i)} vps sshd[300${i}]: Failed password for invalid user admin from 198.51.100.9 port ${50000 + i} ssh2`);
  for (let i = 0; i < 12; i++) sshLines.push(`${t(20 + i)} vps sshd[400${i}]: Failed password for root from 10.0.0.5 port ${30000 + i} ssh2`);
  sshLines.push(`${t(300)} vps sshd[5000]: Accepted publickey for deploy from 192.0.2.10 port 51000 ssh2: ED25519 SHA256:xxx`);
  sshLines.push(`${t(2)} vps sshd[5001]: Accepted publickey for deploy from 192.0.2.10 port 51001 ssh2: ED25519 SHA256:xxx`);
  const ev = P.parseSshJournal(sshLines.join("\n"));
  check(ev.filter((e) => e.kind === "fail").length === 38 && ev.filter((e) => e.kind === "accept").length === 2, "ssh: journald qatorlari o'qildi (38 xato, 2 kirish)", JSON.stringify(ev.length));
  let fs = H.evaluateSsh(ev, now);
  const bf = byKey(fs, "ssh-bruteforce")!;
  check(bf.severity === "HIGH", "ssh: ≥10/soat → HIGH", bf.severity);
  const blocked = (bf.suggestedActions ?? []).map((a) => a.params?.ip);
  check(blocked.includes("203.0.113.7") && blocked.includes("198.51.100.9") && !blocked.includes("10.0.0.5"), "ssh: BLOCK_IP faqat ommaviy IP'lar (10.0.0.5 — xususiy, taklif qilinmaydi)", JSON.stringify(blocked));
  check(byKey(fs, "ssh-login")!.severity === "INFO", "ssh: tanish IP dan kalit bilan kirish → INFO", byKey(fs, "ssh-login")!.severity);

  const newIp = P.parseSshJournal(`${t(3)} vps sshd[1]: Accepted password for deploy from 192.0.2.99 port 1 ssh2`);
  fs = H.evaluateSsh([...ev, ...newIp], now);
  check(byKey(fs, "ssh-login")!.severity === "MEDIUM", "ssh: yangi IP dan parol bilan kirish → MEDIUM", byKey(fs, "ssh-login")!.severity);
  const pwned = P.parseSshJournal(`${t(1)} vps sshd[2]: Accepted password for root from 203.0.113.7 port 2 ssh2`);
  fs = H.evaluateSsh([...ev, ...pwned], now);
  check(byKey(fs, "ssh-login")!.severity === "CRITICAL", "ssh: brute force IP dan muvaffaqiyatli kirish → CRITICAL", byKey(fs, "ssh-login")!.severity);
  fs = H.evaluateSsh(P.parseSshJournal(sshLines.slice(0, 3).join("\n")), now);
  check(byKey(fs, "ssh-bruteforce")!.severity === "INFO", "ssh: 3 ta urinish → INFO");
  check(P.parseSshJournal("Failed password for root from 203.0.113.8 port 1 ssh2").length === 1, "ssh: -o cat (vaqtsiz) qator ham o'qiladi");

  /* ═════════ 2. sshd_config ═════════ */
  const evalCfg = (texts: string[]) => H.evaluateSshd(P.parseSshdConfig(texts), "fixture");
  let f = evalCfg(["PermitRootLogin yes\nPasswordAuthentication no\nMaxAuthTries 3\n"]);
  check(f.severity === "HIGH", "sshd: PermitRootLogin yes → HIGH", f.severity);
  f = evalCfg(["# standart Ubuntu\nPermitRootLogin prohibit-password\nMaxAuthTries 3\n"]);
  check(f.severity === "MEDIUM" && JSON.stringify(f.detail).includes("fail2ban"), "sshd: PasswordAuthentication standart (yes) → MEDIUM + kalit/fail2ban tavsiyasi", f.severity);
  f = evalCfg(["PermitRootLogin no\nPasswordAuthentication no\n"]);
  check(f.severity === "LOW", "sshd: MaxAuthTries yo'q → LOW", f.severity);
  f = evalCfg(["PermitRootLogin no\nPasswordAuthentication no\nMaxAuthTries 3\nMatch User sftp\n  PasswordAuthentication yes\n"]);
  check(f.severity === "INFO", "sshd: mustahkam + Match bloki global emas → INFO", f.severity);
  // Include: drop-in birinchi o'qiladi va ustun (OpenSSH: birinchi qiymat amal qiladi)
  const sshDir = path.join(TMP, "ssh");
  mkdirSync(path.join(sshDir, "sshd_config.d"), { recursive: true });
  writeFileSync(path.join(sshDir, "sshd_config"), `Include ${sshDir}/sshd_config.d/*.conf\nPermitRootLogin no\nPasswordAuthentication no\nMaxAuthTries 3\n`);
  writeFileSync(path.join(sshDir, "sshd_config.d", "50-cloud-init.conf"), "PasswordAuthentication yes\n");
  f = H.evaluateSshd(P.parseSshdConfig(H.readSshdFiles(path.join(sshDir, "sshd_config"))), "fixture");
  check(f.severity === "MEDIUM" && (f.detail as { passwordAuthentication: string }).passwordAuthentication === "yes", "sshd: cloud-init drop-in PasswordAuthentication yes ustun keladi", JSON.stringify(f.detail));

  /* ═════════ 3. Firewall ═════════ */
  check(P.parseUfwStatus("Status: active\n\nTo Action From\n22 ALLOW Anywhere") === "active", "ufw: active o'qildi");
  check(H.evaluateFirewall("inactive", null, "").severity === "HIGH", "ufw: inactive → HIGH");
  const unk = H.evaluateFirewall(null, null, "sudo ruxsat bermadi");
  check(unk.severity === "INFO" && (unk.detail as { status: string }).status === "UNKNOWN", "ufw: holat noma'lum → INFO/UNKNOWN");
  check(H.evaluateFirewall(null, P.parseUfwConf("# x\nENABLED=no\n"), "").severity === "HIGH", "ufw: ufw.conf ENABLED=no → HIGH");

  /* ═════════ 4. Portlar ═════════ */
  const ssBad = [
    'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))',
    "LISTEN 0 511 0.0.0.0:443 0.0.0.0:*",
    "LISTEN 0 511 [::]:80 [::]:*",
    'LISTEN 0 511 *:3000 *:* users:(("next-server",pid=9,fd=20))',
    "LISTEN 0 244 [::]:5432 [::]:*",
    "LISTEN 0 511 127.0.0.1:3101 0.0.0.0:*",
    "LISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:*",
    "LISTEN 0 511 0.0.0.0:8080 0.0.0.0:*",
  ].join("\n");
  f = H.evaluatePorts(P.parseSs(ssBad));
  const exp = (f.detail as { exposed: { port: number }[] }).exposed.map((e) => e.port);
  check(f.severity === "HIGH" && exp.join(",") === "3000,5432,8080" && f.title.includes("3000"), "ss: *:3000, [::]:5432, 0.0.0.0:8080 → HIGH; 127.0.0.1/127.0.0.53 hisoblanmaydi", `${f.severity} ${exp}`);
  f = H.evaluatePorts(P.parseSs(ssBad.split("\n").filter((l) => /:(22|80|443|3101|53) /.test(l)).join("\n")));
  check(f.severity === "INFO", "ss: faqat 22/80/443 ochiq → INFO", f.severity);

  /* ═════════ 5. Sirlar ═════════ */
  const app = path.join(TMP, "app");
  mkdirSync(path.join(app, "tenants"), { recursive: true });
  const SECRET_A = "qisqa-sir-12345";
  const SECRET_B = "x".repeat(48);
  const CTL = "control-sir-qiymati-" + "y".repeat(40);
  writeFileSync(path.join(app, "control.env"), `AUTH_SECRET=${SECRET_B}\nCONTROL_SECRET=${CTL}\n`, { mode: 0o600 });
  writeFileSync(path.join(app, "build.env"), "APP_URL=x\n", { mode: 0o644 });
  writeFileSync(path.join(app, "tenants", "alfa.env"), `AUTH_SECRET="${SECRET_A}"\nCONTROL_SECRET=${CTL}\n`, { mode: 0o600 });
  writeFileSync(path.join(app, "tenants", "beta.env"), `AUTH_SECRET=${SECRET_B}\n`, { mode: 0o640 });
  writeFileSync(process.env.INSOF_BACKUP_ENV!, "X=1\n", { mode: 0o640 });
  chmodSync(path.join(app, "build.env"), 0o644);
  writeFileSync(path.join(app, ".env"), "OLD=1\n", { mode: 0o600 });
  const ctxBase = { appDir: app, tenants: [], now: new Date(now), log: () => {} };
  fs = await H.checkSecrets(ctxBase);
  const perm = byKey(fs, "secret-perms")!;
  check(perm.severity === "HIGH" && perm.title.includes("build.env (644)") && !perm.title.includes("beta.env") && perm.suggestedActions?.[0]?.type === "FIX_SECRET_PERMS", "sirlar: build.env 644 → HIGH + FIX_SECRET_PERMS; 640 ruxsat", perm.title);
  check(byKey(fs, "root-env")!.severity === "MEDIUM", "sirlar: ildizda .env → MEDIUM");
  const ts = byKey(fs, "tenant-secrets")!;
  check(ts.severity === "HIGH" && ts.title.includes("CONTROL_SECRET") && ts.title.includes("alfa.env") && !ts.title.includes("beta.env (") , "sirlar: alfa — CONTROL_SECRET va qisqa AUTH_SECRET → HIGH", ts.title);
  const dump = JSON.stringify(fs);
  check(!dump.includes(SECRET_A) && !dump.includes(SECRET_B) && !dump.includes(CTL), "sirlar: topilmalarda sir qiymati YO'Q");
  chmodSync(path.join(app, "build.env"), 0o600);
  rmSync(path.join(app, ".env"));
  writeFileSync(path.join(app, "tenants", "alfa.env"), `AUTH_SECRET=${SECRET_B}\n`, { mode: 0o600 });
  fs = await H.checkSecrets(ctxBase);
  check(fs.every((x) => x.severity === "INFO"), "sirlar: tuzatilgandan keyin hammasi INFO", JSON.stringify(fs.map((x) => x.severity)));

  /* ═════════ 6. HTTP sarlavhalar ═════════ */
  const fakeFetch = (async (url: string) => {
    const h = new Headers({ "x-content-type-options": "nosniff" });
    if (String(url).includes("alfa")) { h.set("strict-transport-security", "max-age=63072000"); h.set("content-security-policy", "default-src 'self'"); }
    return new Response(null, { status: 200, headers: h });
  }) as unknown as typeof fetch;
  const hctx = { ...ctxBase, tenants: [
    { slug: "alfa", port: 3101, domain: "alfa.example.uz", dbName: "insof_test_t_alfa", status: "ACTIVE" },
    { slug: "beta", port: 3102, domain: "beta.example.uz", dbName: "insof_test_t_beta", status: "ACTIVE" },
    { slug: "gamma", port: 3103, domain: "gamma.example.uz", dbName: "insof_test_t_gamma", status: "SUSPENDED" },
  ] };
  fs = await H.checkHeaders(hctx, fakeFetch);
  f = byKey(fs, "http-headers")!;
  check(f.severity === "MEDIUM" && f.title.includes("beta.example.uz") && !f.title.includes("alfa.example.uz") && !f.title.includes("gamma"), "sarlavhalar: beta'da HSTS/CSP yo'q → MEDIUM (to'xtatilgan gamma tekshirilmaydi)", f.title);
  fs = await H.checkHeaders(hctx, fakeFetch, () => false);
  check((byKey(fs, "http-headers")!.detail as { status: string }).status === "UNKNOWN", "sarlavhalar: tashqi so'rov taqiqlangan (test rejimi) → UNKNOWN");

  /* ═════════ 7. nginx ═════════ */
  const ng: string[] = [];
  const L = (ip: string, p: string, st: number) => `${ip} - - [06/Oct/2026:10:00:00 +0500] "GET ${p} HTTP/1.1" ${st} 123 "-" "Mozilla/5.0"`;
  for (let i = 0; i < 150; i++) ng.push(L("192.0.2.50", `/dashboard?i=${i}`, 200));
  for (const p of ["/.env", "/wp-admin/setup.php", "/.git/config", "/phpmyadmin/", "/wp-login.php", "/vendor/phpunit/x"]) ng.push(L("203.0.113.66", p, 404));
  ng.push(L("10.1.1.1", "/.env", 404), L("10.1.1.1", "/.git/HEAD", 404), L("10.1.1.1", "/wp-admin", 404));
  for (let i = 0; i < 5; i++) ng.push(L("198.51.100.20", "/api/login", 429));
  ng.push('198.51.100.21 - - [06/Oct/2026:10:00:01 +0500] "\\x16\\x03\\x01" 400 157 "-" "-"');
  fs = H.evaluateNginx(ng.join("\n"));
  f = byKey(fs, "nginx-scanners")!;
  const nb = (f.suggestedActions ?? []).map((a) => a.params?.ip);
  check(f.severity === "MEDIUM" && nb.includes("203.0.113.66") && !nb.includes("10.1.1.1"), "nginx: skaner → MEDIUM + BLOCK_IP (xususiy IP'siz)", `${f.severity} ${nb}`);
  const ne = byKey(fs, "nginx-errors")!;
  check(ne.severity === "INFO" && (ne.detail as { s429: number }).s429 === 5, "nginx: 429 sanaldi, 5xx yo'q → INFO", JSON.stringify(ne.detail));
  for (let i = 0; i < 30; i++) ng.push(L("192.0.2.50", "/dashboard", 502));
  check(byKey(H.evaluateNginx(ng.join("\n")), "nginx-errors")!.severity === "MEDIUM", "nginx: 5xx ≥5% → MEDIUM");
  const big = path.join(TMP, "access.log");
  writeFileSync(big, Array.from({ length: 25_000 }, (_, i) => L("192.0.2.1", `/p${i}`, 200)).join("\n") + "\n");
  const tail = H.tailFile(big, 10_000).split("\n").filter(Boolean);
  check(tail.length === 10_000 && tail.at(-1)!.includes("/p24999"), "nginx: tailFile oxirgi 10k qatorni o'qiydi", String(tail.length));
  fs = await H.checkNginx(big);
  check(byKey(fs, "nginx-scanners")!.severity === "INFO", "nginx: toza log → INFO");

  /* ═════════ 9. apt ═════════ */
  const apt = [
    "Listing... Done",
    "libssl3/jammy-updates,jammy-security 3.0.2-0ubuntu1.18 amd64 [upgradable from: 3.0.2-0ubuntu1.15]",
    "openssl/jammy-updates,jammy-security 3.0.2-0ubuntu1.18 amd64 [upgradable from: 3.0.2-0ubuntu1.15]",
    "vim/jammy-updates 2:8.2.3995-1ubuntu2.20 amd64 [upgradable from: 2:8.2.3995-1ubuntu2.19]",
    "tzdata/jammy-security 2026a-0ubuntu0.22.04 all [upgradable from: 2025b-0ubuntu0.22.04]",
  ].join("\n");
  const a = P.parseAptUpgradable(apt);
  check(a.total === 4 && a.security === 3 && a.critical.includes("openssl"), "apt: 4 yangilanish, 3 xavfsizlik, openssl muhim", JSON.stringify(a));
  fs = H.evaluateApt(apt, ["linux-image-5.15.0-120-generic"], now);
  check(byKey(fs, "os-updates")!.severity === "HIGH" && byKey(fs, "reboot-required")!.severity === "LOW", "apt: openssl xavfsizlik → HIGH; reboot-required → LOW");
  fs = H.evaluateApt("Listing... Done\ntzdata/jammy-security 2026a all [upgradable from: 2025b]", null, now);
  check(byKey(fs, "os-updates")!.severity === "MEDIUM" && byKey(fs, "reboot-required")!.severity === "INFO", "apt: 1 oddiy xavfsizlik → MEDIUM");

  /* ═════════ 10. npm audit ═════════ */
  const audit = (vulns: Record<string, unknown>, meta: Record<string, number>) => JSON.stringify({ auditReportVersion: 2, vulnerabilities: vulns, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...meta } } });
  const onlySharp = audit({ sharp: { name: "sharp", severity: "high", via: [{ title: "libvips CVE" }], fixAvailable: true } }, { high: 1, total: 1 });
  fs = H.evaluateAudit(P.parseNpmAudit(onlySharp), now);
  check(byKey(fs, "npm-audit")!.severity === "INFO" && byKey(fs, "npm-accepted-risk")!.severity === "LOW" && JSON.stringify(byKey(fs, "npm-accepted-risk")!.detail).includes("CPU"), "npm audit: faqat sharp → qabul qilingan xavf (LOW, yumshatish matni bilan)");
  const mixed = audit({
    sharp: { severity: "high", via: [{}] },
    next: { severity: "critical", via: [{}], fixAvailable: { name: "next", version: "15.9.9" } },
    "some-sharp-dep": { severity: "high", via: ["sharp"] },
    lodash: { severity: "moderate", via: [{}] },
  }, { high: 2, critical: 1, moderate: 1 });
  const pa = P.parseNpmAudit(mixed)!;
  check(pa.effective.critical === 1 && pa.effective.high === 0 && pa.accepted.length === 2, "npm audit: sharp orqali kelgan zaiflik ham qabul qilingan", JSON.stringify(pa.effective));
  check(byKey(H.evaluateAudit(pa, now), "npm-audit")!.severity === "CRITICAL", "npm audit: next critical → CRITICAL");
  check(P.parseNpmAudit("npm ERR! network") === null, "npm audit: JSON emas → null");

  /* ═════════ 8. Ilova telemetriyasi (sof qism) ═════════ */
  const rows = [
    { action: "UPDATE", before: { role: "SALES" }, after: { role: "DIRECTOR" }, createdAt: new Date(now) },
    { action: "UPDATE", before: { perms: {} }, after: { perms: { a: 1 } }, createdAt: new Date(now) },
    { action: "UPDATE", before: null, after: { passwordReset: true }, createdAt: new Date(now) },
    { action: "UPDATE", before: null, after: { itKirish: true, admin: "otabek" }, createdAt: new Date(now) },
  ];
  const sum = A.summarizeAudit("alfa", rows, 0);
  check(sum.roleToPriv === 1 && sum.permChanges === 1 && sum.passwordResets === 1 && sum.itLogins === 1, "telemetriya: AuditLog — rol ko'tarilishi, ruxsat, parol, IT kirish", JSON.stringify(sum));
  fs = A.evaluateTenantTelemetry([{ ...sum, loginLocks: 2, ipLocks: ["203.0.113.5"] }]);
  check(byKey(fs, "app-privileges")!.severity === "MEDIUM" && byKey(fs, "app-logins")!.severity === "LOW" && byKey(fs, "app-logins")!.suggestedActions?.[0]?.params?.ip === "203.0.113.5", "telemetriya: yangi direktor → MEDIUM; IP qulfi → LOW + BLOCK_IP");
  const locks = P.parseLoginGuardLocks("[login-guard] qulf: l:ali (15 daqiqa)\n[login-guard] qulf: ip:203.0.113.5 (15 daqiqa)\nboshqa qator");
  check(locks.loginLocks === 1 && locks.ipLocks[0] === "203.0.113.5", "telemetriya: login-guard jurnal qatorlari");
  check(!JSON.stringify(A.evaluateTenantTelemetry([{ ...sum, loginLocks: 1, ipLocks: [] }])).includes("ali"), "telemetriya: login nomlari topilmaga chiqmaydi");
  const night = new Date(Date.UTC(2026, 9, 6, 20, 30)); // Toshkent 01:30
  fs = A.evaluateControlActivity([
    { action: "SSO", createdAt: night, ip: "192.0.2.1", tenantSlug: "alfa" },
    { action: "ADMIN_LOGIN", createdAt: new Date(Date.UTC(2026, 9, 6, 6, 0)), ip: "192.0.2.1" },
  ], { loginLocks: 0, ipLocks: [] });
  check(byKey(fs, "control-activity")!.severity === "LOW" && byKey(fs, "control-activity")!.title.includes("ish vaqtidan tashqari"), "panel: tungi SSO → LOW", byKey(fs, "control-activity")!.title);
  fs = A.evaluateControlActivity([{ action: "ADMIN_CREATE", createdAt: new Date(now), ip: null }], { loginLocks: 1, ipLocks: ["198.51.100.3"] });
  check(byKey(fs, "control-activity")!.severity === "MEDIUM" && byKey(fs, "control-activity")!.suggestedActions?.[0]?.type === "BLOCK_IP", "panel: yangi superadmin + login qulfi → MEDIUM + BLOCK_IP");

  /* ═════════ Control baza (vaqtinchalik) ═════════ */
  psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  const cr = psql(`CREATE DATABASE ${DB}`);
  if (cr.status !== 0) throw new Error(`createdb ${DB}: ${cr.stderr}`);
  const mig = spawnSync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/control/schema.prisma"], {
    cwd: REPO, encoding: "utf8", env: { ...process.env, CONTROL_DATABASE_URL: `${PG}/${DB}` },
  });
  check(mig.status === 0, "control baza: migrate deploy", mig.stderr.slice(-300));

  /* ═════════ 2. runSecurityChecks (shu mashinada) ═════════ */
  const { runSecurityChecks, runAiAnalysis } = await import("../../src/lib/control/security/index");
  const logs: string[] = [];
  const all = await runSecurityChecks({
    appDir: app,
    tenants: [{ slug: "yoq", port: 3299, domain: null, dbName: "insof_test_ctl_sec_yoq", status: "ACTIVE" }],
    now: new Date(), log: (m) => logs.push(m),
  });
  check(all.length >= 12, `runSecurityChecks: ${all.length} topilma, xato tashlamadi`);
  check(all.every(validShape), "runSecurityChecks: hamma topilma shartnoma shaklida (kalit, kategoriya, daraja, oq ro'yxat amallari)", JSON.stringify(all.filter((x) => !validShape(x)).slice(0, 2)));
  check(new Set(all.map((x) => x.key)).size === all.length, "runSecurityChecks: kalitlar takrorlanmaydi");
  if (process.platform === "darwin") {
    const st = (n: string) => (byKey(all, n)?.detail as { status?: string } | undefined)?.status;
    check(st("ssh-bruteforce") === "UNKNOWN" && st("open-ports") === "UNKNOWN" && byKey(all, "ssh-bruteforce")!.severity === "INFO", "macOS: journalctl/ss yo'q → INFO/UNKNOWN, sababi bilan",
      JSON.stringify([byKey(all, "ssh-bruteforce")?.detail, byKey(all, "open-ports")?.detail]));
    check(st("npm-audit") === "UNKNOWN", "macOS: current/package-lock.json yo'q → npm audit UNKNOWN (tarmoqqa chiqilmaydi)");
  }
  check(byKey(all, "app-tenants")?.severity === "INFO" && (byKey(all, "app-tenants")!.detail as { status: string }).status === "UNKNOWN", "telemetriya: yo'q korxona bazasi → UNKNOWN, boshqalar ishlayveradi", JSON.stringify(all.map((x) => [x.key, x.severity, x.detail?.status])));
  check(byKey(all, "control-activity")?.severity === "INFO", "panel faolligi: bo'sh control baza → INFO", JSON.stringify(byKey(all, "control-activity")));

  /* ═════════ 3. runAiAnalysis (stub) ═════════ */
  const { control } = await import("../../src/lib/control/db");
  const { redact, gatherInput, saveReport, aiIncidentKey } = await import("../../src/lib/control/security/ai");
  const red = redact('url postgresql://insof:Parol123@127.0.0.1/x AUTH_SECRET=abcdef tel +998901234567 tok sk-ant-api03-zzz ' + "Q".repeat(40) + " ip 203.0.113.7 /var/www/insof-erp/current/package-lock.json");
  check(!/Parol123|abcdef|901234567|api03|QQQQ/.test(red) && red.includes("203.0.113.7") && red.includes("package-lock.json"), "AI: redact — parol/kalit/telefon/token yashirildi, IP va yo'l qoldi", red);

  await control.incident.create({ data: { key: "security:ssh-bruteforce", source: "security", category: "security", severity: "HIGH", title: "SSH: parol taxmin qilish", detail: { secretLike: "AUTH_SECRET=zzzzzz", big: "x".repeat(5000) } } });
  for (let i = 0; i < 120; i++) {
    await control.serviceCheck.create({ data: { key: `security:fake-${i}`, kind: "security", target: "x", status: "WARN", message: "m".repeat(300), data: { blob: "b".repeat(2000) }, checkedAt: new Date(), changedAt: new Date() } });
  }
  for (let i = 0; i < 60; i++) {
    await control.incident.create({ data: { key: `monitor:fake-${i}`, source: "monitor", category: "availability", severity: "LOW", status: "ACKED", title: `Sinov hodisasi ${i}`, detail: { blob: "d".repeat(3000) } } });
  }
  const gi = await gatherInput();
  check(gi.text.length <= 20_000 && gi.truncated && !gi.text.includes("zzzzzz"), `AI: kirish ≤ 20k belgi (${gi.text.length}), sirlarsiz`);

  const r1 = await runAiAnalysis("manual", "admin-1");
  const rep = r1 ? await control.securityReport.findUnique({ where: { id: r1.id } }) : null;
  check(rep && rep.model === "stub-test" && rep.grade === "D" && rep.trigger === "manual" && rep.requestedById === "admin-1" && Array.isArray(rep.items) && (rep.inputMeta as { stub?: boolean }).stub === true,
    "AI: test rejimida stub → SecurityReport (baho D — HIGH hodisa bor)", JSON.stringify(rep));
  check((await control.incident.count({ where: { source: "ai" } })) === 0, "AI: ochiq hodisa bilan bir xil tavsiya uchun yangi hodisa ochilmaydi");

  const report = { grade: "C" as const, summary: "Sinov", items: [
    { title: "fail2ban o'rnatilmagan", severity: "HIGH" as const, why: "w", fix: "f", actionType: "RUN_SECURITY_SCAN" as const },
    { title: "IP bloklash", severity: "CRITICAL" as const, why: "w", fix: "f", actionType: "BLOCK_IP" as const },
    { title: "Kichik narsa", severity: "LOW" as const, why: "w", fix: "f", actionType: undefined },
  ] };
  await saveReport("scheduled", "test", report, {});
  await saveReport("scheduled", "test", report, {});
  const aiInc = await control.incident.findMany({ where: { source: "ai" }, orderBy: { title: "asc" } });
  check(aiInc.length === 2 && aiInc.some((i) => i.key === aiIncidentKey("fail2ban o'rnatilmagan")), "AI: HIGH/CRITICAL → 2 ta 'ai' hodisa, ikkinchi hisobotda takrorlanmadi", JSON.stringify(aiInc.map((i) => i.title)));
  const blk = aiInc.find((i) => i.title === "IP bloklash");
  const scan = aiInc.find((i) => i.title.startsWith("fail2ban"));
  check(!blk?.suggestedActions && JSON.stringify(scan?.suggestedActions).includes("RUN_SECURITY_SCAN"), "AI: parametr talab qiluvchi amal (BLOCK_IP) hodisaga biriktirilmaydi");
  check((await control.securityReport.count()) === 3, "AI: 3 ta hisobot saqlandi");
  await control.$disconnect();
} catch (e) {
  fails++;
  console.log(`\x1b[1;31mFAIL\x1b[0m kutilmagan xato — ${(e as Error).stack}`);
} finally {
  psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${oks} OK, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
