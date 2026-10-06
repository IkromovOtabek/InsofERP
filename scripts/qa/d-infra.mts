/**
 * QA (D): infratuzilma moduli — parserlar, amal parametrlari tekshiruvi, agent tomoni (scripts/agent/infra.ts) soxta
 * muhitda (vaqtinchalik papkalar, stub baza va sudo — hech qanday tizim buyrug'i root bilan bajarilmaydi), tenant-up.sh
 * statik tekshiruvi (bash -n, root'siz rad, root egaligi talabi).
 *
 *   npx tsx scripts/qa/d-infra.mts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "../../src/lib/control/infra/contract";
import * as P from "../../src/lib/control/infra/parse";
import { scrubSecrets, validateAction } from "../../src/lib/control/monitor/parse";
import { ACTION_TYPES } from "../../src/lib/control/monitor/contract";
import { confirmPhrase, actionLabel } from "../../src/lib/control/monitor/shared";
import { createInfra, type InfraDeps } from "../agent/infra";

const E40 = "eeeeeeee0123456789abcdef0123456789abcdef"; // to'liq git sha kabi (40 belgi)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let ok = 0, fail = 0;
function check(name: string, cond: unknown, info?: unknown) {
  if (cond) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${info !== undefined ? ` — ${typeof info === "string" ? info : JSON.stringify(info)?.slice(0, 400)}` : ""}`); }
}
const section = (t: string) => console.log(`\n── ${t}`);

/* ═════════ 1. Shartnoma va parametrlar ═════════ */
section("Shartnoma");
{
  for (const t of C.INFRA_ACTION_TYPES) check(`${t} ACTION_TYPES da va yorlig'i bor`, (ACTION_TYPES as readonly string[]).includes(t) && actionLabel(t) !== t);
  const pol = { base: "insof-erp.uz", list: "zavod2.insof.uz" };
  check("domen: base ostida", C.domainAllowed("sharq.insof-erp.uz", pol.base, pol.list));
  check("domen: base o'zi", C.domainAllowed("insof-erp.uz", pol.base, pol.list));
  check("domen: ro'yxatda", C.domainAllowed("zavod2.insof.uz", pol.base, pol.list));
  for (const bad of ["evil.com", "insof-erp.uz.evil.com", "xinsof-erp.uz", "-a.insof-erp.uz", "a..insof-erp.uz", "A.insof-erp.uz", "a.insof-erp.uz/x", "a.insof-erp.uz x"]) {
    check(`domen rad: "${bad}"`, !C.domainAllowed(bad, pol.base, pol.list));
  }
  check("domen: siyosat bo'sh → rad", !C.domainAllowed("sharq.insof-erp.uz", "", ""));

  const v = (t: C.InfraActionType, p: Record<string, unknown>) => C.validateInfraParams(t, p, pol);
  check("REBOOT {} → at=now", JSON.stringify(v("REBOOT", {})) === JSON.stringify({ ok: true, params: { at: "now" } }));
  check("REBOOT 03:30 → ok", v("REBOOT", { at: "03:30" }).ok);
  for (const bad of ["24:00", "3:30", "03:60", "now; rm", "+1", "-c", 330]) check(`REBOOT at="${bad}" → rad`, !v("REBOOT", { at: bad }).ok);
  check("TENANT_UP slug → ok", v("TENANT_UP", { slug: "sharq" }).ok);
  check("TENANT_UP slug+domen → ok", v("TENANT_UP", { slug: "sharq", domain: "sharq.insof-erp.uz" }).ok);
  for (const bad of ["Sharq", "s", "1abc", "sharq;id", "../x", "-x", "a".repeat(31)]) check(`TENANT_UP slug "${bad}" → rad`, !v("TENANT_UP", { slug: bad }).ok);
  check("TENANT_UP begona domen → rad", !v("TENANT_UP", { slug: "sharq", domain: "evil.com" }).ok);
  const extra = v("TENANT_UP", { slug: "sharq", cmd: "rm -rf /" });
  check("TENANT_UP ortiqcha kalit tashlanadi", extra.ok && !("cmd" in extra.params), extra);
  check("CLEAN_RELEASES ortiqcha param tashlanadi", JSON.stringify(v("CLEAN_RELEASES", { keep: "0" })) === JSON.stringify({ ok: true, params: {} }));

  // validateAction (agent) — process.env siyosati bilan
  process.env.TENANT_BASE_DOMAIN = "insof-erp.uz"; process.env.TENANT_DOMAINS = "";
  check("validateAction TENANT_UP ok", validateAction("TENANT_UP", { slug: "alfa", domain: "alfa.insof-erp.uz" }).ok);
  check("validateAction TENANT_UP begona domen → rad", !validateAction("TENANT_UP", { slug: "alfa", domain: "alfa.com" }).ok);
  check("validateAction REBOOT yomon vaqt → rad", !validateAction("REBOOT", { at: "25:00" }).ok);
  check("validateAction RESTART_UNIT hali ishlaydi", validateAction("RESTART_UNIT", { unit: "insof-control" }).ok);

  check("tasdiq: REBOOT → TASDIQLAYMAN", confirmPhrase("REBOOT", { at: "now" }) === "TASDIQLAYMAN");
  check("tasdiq: CLEAN_RELEASES/JOURNAL_VACUUM → TASDIQLAYMAN", confirmPhrase("CLEAN_RELEASES", {}) === "TASDIQLAYMAN" && confirmPhrase("JOURNAL_VACUUM", {}) === "TASDIQLAYMAN");
  check("tasdiq: TENANT_UP → slug", confirmPhrase("TENANT_UP", { slug: "alfa" }) === "alfa");
  check("tasdiq: RUN_RESTORE_TEST/REBOOT_CANCEL → oddiy", confirmPhrase("RUN_RESTORE_TEST", {}) === null && confirmPhrase("REBOOT_CANCEL", {}) === null);
  check("tasdiq: eski amallar o'zgarmagan", confirmPhrase("BLOCK_IP", { ip: "1.2.3.4" }) === "1.2.3.4" && confirmPhrase("RUN_BACKUP", {}) === null);

  const now = new Date(2026, 9, 6, 14, 0);
  check("rebootWhen 03:00 → ertaga", C.rebootWhen("03:00", now).label === "ertaga 03:00");
  check("rebootWhen 22:30 → bugun", C.rebootWhen("22:30", now).label === "bugun 22:30");
}

/* ═════════ 2. Parserlar ═════════ */
section("Parserlar");
{
  const log = [
    "[2026-10-04 02:30:01] → control: pg_dump", "[2026-10-04 02:31:00] ✓ Zaxira nusxa tugadi",
    "[2026-10-05 02:30:01] → control: pg_dump", "[2026-10-05 02:30:09] ✗ rclone: yuklash yoki tekshiruv xato",
    "[2026-10-05 02:30:10] ✗ Zaxira nusxa XATO (qadam: yakun (1 ta xato), kod 1)",
  ].join("\n");
  const r = P.lastRun(log, P.BACKUP_OK_RE, P.BACKUP_FAIL_RE);
  check("backup log: oxirgisi FAILED, vaqti, faqat oxirgi ishga tushish", r.status === "FAILED" && r.at === "2026-10-05T02:30:10" && r.tail.length === 3, r);
  const r2 = P.lastRun(log + "\n[2026-10-06 02:30:01] → control: pg_dump\n[2026-10-06 02:40:00] ✓ Zaxira nusxa tugadi", P.BACKUP_OK_RE, P.BACKUP_FAIL_RE);
  check("backup log: yangi OK", r2.status === "OK" && r2.tail.length === 2, r2);
  check("bo'sh log → UNKNOWN", P.lastRun("", P.BACKUP_OK_RE, P.BACKUP_FAIL_RE).status === "UNKNOWN");
  const rl = P.lastRun("[2026-10-05 05:30:00] Oxirgi nusxa: /x\n[2026-10-05 05:31:00] ✓ Barcha dump'lar tiklandi va tekshirildi", P.RESTORE_OK_RE, P.RESTORE_FAIL_RE);
  check("restore log OK", rl.status === "OK", rl);

  check("os-release", P.parseOsRelease('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 22.04.5 LTS"\n') === "Ubuntu 22.04.5 LTS");
  check("yadro solishtirish", P.compareKernel("5.15.0-122-generic", "5.15.0-91-generic") > 0 && P.compareKernel("6.8.0-1", "5.15.0-200") > 0);
  check("kutilayotgan yadro", P.pendingKernel(["vmlinuz", "vmlinuz-5.15.0-91-generic", "vmlinuz-5.15.0-122-generic", "initrd.img"], "5.15.0-91-generic") === "5.15.0-122-generic");
  check("yadro yangi emas → null", P.pendingKernel(["vmlinuz-5.15.0-91-generic"], "5.15.0-91-generic") === null);
  check("journal disk-usage", P.parseJournalDiskUsage("Archived and active journals take up 1.5G in the file system.") === Math.round(1.5 * 1024 ** 3));
  check("du", P.parseDu("123\t/var/log\ndu: cannot read directory '/x': Permission denied\n456\t/var/backups/insof\n").get("/var/backups/insof") === 456);
  const sch = P.parseShutdownScheduled("USEC=1791241200000000\nWARN_WALL=1\nMODE=reboot\n");
  check("shutdown scheduled", sch?.mode === "reboot" && sch.at === new Date(1791241200000).toISOString(), sch);
  check("20auto-upgrades", P.parseAutoUpgrades('APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";') === true && P.parseAutoUpgrades('APT::Periodic::Unattended-Upgrade "0";') === false);
  check("rclone lsf", JSON.stringify(P.parseRcloneLsf("2026-10-06_0230/\nfoo/\n2026-10-05_0230/\n")) === JSON.stringify(["2026-10-05_0230", "2026-10-06_0230"]));
  check("rclone about", P.parseRcloneAbout('{"total":16106127360,"used":1000,"free":15000000000,"trashed":0}')?.free === 15000000000 && P.parseRcloneAbout("xato") === null);
  check("RESULT qatori", JSON.stringify(P.parseTenantUpResult("..\nRESULT systemd=active health=200 nginx=ok certbot=fail\n")) === JSON.stringify({ systemd: "active", health: "200", nginx: "ok", certbot: "fail" }));

  const del = P.releasesToClean([
    { name: "r1", mtimeMs: 1 }, { name: "r2", mtimeMs: 2 }, { name: "r3", mtimeMs: 3 }, { name: "r4", mtimeMs: 4 }, { name: "r5", mtimeMs: 5 },
    { name: "r6.tmp", mtimeMs: 6 },
  ], "r1", 10 * 3600_000);
  check("releasesToClean: 3 yangi + current saqlanadi, eski .tmp o'chadi", JSON.stringify(del) === JSON.stringify(["r2", "r6.tmp"]), del);
  check("releasesToClean: yangi .tmp tegilmaydi", !P.releasesToClean([{ name: "x.tmp", mtimeMs: 100 }], null, 200).length);

  const f = P.forecastDisk({ mount: "/", total: 100e9, used: 60e9, avail: 40e9, copies: Array(5).fill({ bytes: 1e9 }), keepDays: 14,
    history: [{ at: 0, used: 50e9 }, { at: 5 * 864e5, used: 60e9 }] });
  check("prognoz: o'sish 2 GB/kun, barqaror 14 GB, to'lish (40-9)/2 ≈ 15.5 kun", f.growthPerDay === 2e9 && f.steadyStateBytes === 14e9 && f.daysToFull === 15.5, f);
}

/* ═════════ 3. Agent moduli (soxta muhit) ═════════ */
section("Agent moduli (scripts/agent/infra.ts)");
const tmp = mkdtempSync(path.join(os.tmpdir(), "insof-infra-qa-"));
try {
  const app = path.join(tmp, "app"); const bdir = path.join(tmp, "backups");
  for (const r of ["aaa111", "bbb222", "ccc333", "ddd444", E40]) mkdirSync(path.join(app, "releases", r), { recursive: true });
  ["aaa111", "bbb222", "ccc333", "ddd444", E40].forEach((r, i) => utimesSync(path.join(app, "releases", r), new Date(), new Date(Date.now() - (5 - i) * 3600_000)));
  // current → eng eski (aaa111) — saqlanishi shart
  spawnSync("ln", ["-s", path.join(app, "releases", "aaa111"), path.join(app, "current")]);
  mkdirSync(path.join(app, "scripts"), { recursive: true });
  writeFileSync(path.join(app, "scripts", "restore-test.sh"), "echo '[2026-10-06 05:31:00] ✓ Barcha dump'\"'\"'lar tiklandi va tekshirildi'\n");
  for (const n of ["2026-10-05_0230", "2026-10-06_0230"]) {
    mkdirSync(path.join(bdir, n), { recursive: true });
    writeFileSync(path.join(bdir, n, "control.dump"), "x".repeat(1000));
    if (n.endsWith("06_0230")) writeFileSync(path.join(bdir, n, "SHA256SUMS"), "abc  control.dump\n");
  }
  const blog = path.join(tmp, "backup.log"); const rlog = path.join(tmp, "restore.log");
  writeFileSync(blog, "[2026-10-06 02:30:01] → control PGPASSWORD=\"s3cr3t\" path=C:\\x\ttab password: \"q\"\n[2026-10-06 02:31:00] ✓ Zaxira nusxa tugadi\n");
  const benv = path.join(tmp, "backup.env");
  writeFileSync(benv, `OFFSITE=local\nOFFSITE_DIR=${path.join(tmp, "offsite")}\nKEEP_DAYS=14\n`);
  mkdirSync(path.join(tmp, "offsite", "2026-10-05_0230"), { recursive: true });

  const sudoCalls: string[][] = []; const tg: string[] = [];
  const tenants: Record<string, { id: string; status: string; domain: string | null }> = { alfa: { id: "t1", status: "PROVISIONING", domain: "alfa.insof-erp.uz" } };
  const stubControl = {
    hostSnapshot: { findFirst: async () => null },
    superAdmin: { findUnique: async () => ({ fullName: "Test Admin", login: "test" }) },
    tenant: { findUnique: async ({ where }: { where: { slug: string } }) => tenants[where.slug] ?? null, update: async () => ({}) },
  };
  const run: InfraDeps["run"] = (file, args, opt) => new Promise((resolve) => {
    const r = spawnSync(file, args, { cwd: opt.cwd, env: opt.env, encoding: "utf8", timeout: opt.timeoutMs });
    resolve({ code: r.status, signal: r.signal, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, timedOut: false, missing: !!r.error });
  });
  const infra = createInfra({
    control: stubControl as unknown as InfraDeps["control"], run,
    sudo: async (args) => { sudoCalls.push(args); return { ok: true, text: `$ sudo -n ${args.join(" ")}\n(chiqish kodi 0)` }; },
    fmt: (cmd, r) => `$ ${cmd.join(" ")}\n${r.out.trim()}\n(chiqish kodi ${r.code})`,
    telegram: async (t) => { tg.push(t); return true; }, log: () => {}, linux: false, test: false, hasSystemd: async () => false,
    appDir: app, backupDir: bdir, backupEnv: benv, backupLog: blog, restoreLog: rlog, childEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: os.homedir() },
    host: "qa-host", bin: { systemctl: "/usr/bin/false", journalctl: "/nonexistent/journalctl", bash: "/bin/bash" },
    runningTypes: () => [], afterChange: () => {},
  });

  const [inv, sys] = await infra.collect();
  const bi = inv.data as unknown as C.BackupInventory;
  check("inventar: 2 nusxa, yangisi birinchi, SHA bor/yo'q", bi.copies.length === 2 && bi.copies[0].name === "2026-10-06_0230" && bi.copies[0].sha256sums && !bi.copies[1].sha256sums, bi.copies);
  check("inventar: masofa (local) — eski bor, yangisi yo'q", bi.remote.ok === true && bi.copies[1].remote === true && bi.copies[0].remote === false, bi.remote);
  check("inventar: oxirgi backup OK (log)", bi.lastBackup.status === "OK");
  check("inventar: restore logi yo'q → WARN", inv.status === "WARN" && bi.problems.some((p) => p.includes("tiklash")), bi.problems);
  check("inventar: disk prognozi", bi.disk != null && bi.disk.backupsBytes === 2000 + "abc  control.dump\n".length, bi.disk);
  let roundtrip = true;
  try { JSON.parse(scrubSecrets(JSON.stringify(inv.data))); JSON.parse(scrubSecrets(JSON.stringify(sys.data))); } catch { roundtrip = false; }
  check("data: agent upsertOne (scrubSecrets JSON ustida) buzmaydi", roundtrip);
  check("data: log'dagi parol yashirilgan", !JSON.stringify(inv.data).includes("s3cr3t"));
  const si = sys.data as unknown as C.SystemInfo;
  check("tizim: 40 belgili reliz nomi qisqa (*** emas)", si.releases.some((r) => r.name === E40.slice(0, 12)) && !JSON.stringify(si.releases).includes("***"), si.releases.map((r) => r.name));
  check("tizim: macOS → UNKNOWN, relizlar 5, current belgilangan", sys.status === "UNKNOWN" && si.releases.length === 5 && si.releases.find((r) => r.current)?.name === "aaa111", si.releases);

  const rt = await infra.execute("RUN_RESTORE_TEST", {}, "a1");
  check("RUN_RESTORE_TEST: DONE va logga yozildi", rt.status === "DONE" && existsSync(rlog) && readFileSync(rlog, "utf8").includes("tiklandi"), rt);
  const [inv2] = await infra.collect();
  check("RUN_RESTORE_TEST dan keyin restore holati OK", (inv2.data as unknown as C.BackupInventory).lastRestoreTest.status === "OK");

  mkdirSync(path.join(app, "releases", "fff666.tmp"));
  const cl1 = await infra.execute("CLEAN_RELEASES", {}, "a1");
  check("CLEAN_RELEASES: yangi .tmp bor → deploy ketmoqda, hech narsa o'chmadi", cl1.status === "FAILED" && existsSync(path.join(app, "releases", "bbb222")), cl1.output);
  rmSync(path.join(app, "releases", "fff666.tmp"), { recursive: true });
  const cl = await infra.execute("CLEAN_RELEASES", {}, "a1");
  const left = ["aaa111", "bbb222", "ccc333", "ddd444", E40].filter((r) => existsSync(path.join(app, "releases", r)));
  check("CLEAN_RELEASES: current (eng eski) + 3 yangi qoldi, bbb222 o'chdi", cl.status === "DONE" && JSON.stringify(left) === JSON.stringify(["aaa111", "ccc333", "ddd444", E40]), { out: cl.output, left });
  const cl2 = await infra.execute("CLEAN_RELEASES", {}, "a1");
  check("CLEAN_RELEASES: takror — o'chiriladigan yo'q", cl2.status === "DONE" && cl2.output.includes("yo'q"), cl2.output);

  const rb = await infra.execute("REBOOT", { at: "now" }, "a1");
  check("REBOOT now → sudo shutdown -r +1, Telegram oldindan", rb.status === "DONE" && JSON.stringify(sudoCalls.at(-1)) === JSON.stringify(["/usr/sbin/shutdown", "-r", "+1"]) && tg.some((t) => t.startsWith("[REBOOT]") && t.includes("Test Admin")), { rb, sudoCalls, tg });
  await infra.execute("REBOOT", { at: "03:15" }, "a1");
  check("REBOOT 03:15 → shutdown -r 03:15", JSON.stringify(sudoCalls.at(-1)) === JSON.stringify(["/usr/sbin/shutdown", "-r", "03:15"]));
  const rbBad = await infra.execute("REBOOT", { at: "now; reboot" }, "a1");
  check("REBOOT yomon vaqt → REJECTED (sudo chaqirilmadi)", rbBad.status === "REJECTED" && JSON.stringify(sudoCalls.at(-1)) === JSON.stringify(["/usr/sbin/shutdown", "-r", "03:15"]));
  mkdirSync(path.join(bdir, "2026-10-06_0300.partial"));
  const rbBusy = await infra.execute("REBOOT", { at: "now" }, "a1");
  check("REBOOT: zaxira olinmoqda (.partial) → rad", rbBusy.status === "FAILED" && rbBusy.output.includes("Zaxira"), rbBusy.output);
  rmSync(path.join(bdir, "2026-10-06_0300.partial"), { recursive: true });
  await infra.execute("REBOOT_CANCEL", {}, "a1");
  check("REBOOT_CANCEL → shutdown -c", JSON.stringify(sudoCalls.at(-1)) === JSON.stringify(["/usr/sbin/shutdown", "-c"]));
  await infra.execute("JOURNAL_VACUUM", {}, "a1");
  check("JOURNAL_VACUUM → journalctl --vacuum-time=14d", JSON.stringify(sudoCalls.at(-1)) === JSON.stringify(["/nonexistent/journalctl", "--vacuum-time=14d"]));

  process.env.TENANT_BASE_DOMAIN = "insof-erp.uz";
  const n0 = sudoCalls.length;
  check("TENANT_UP: yo'q korxona → REJECTED", (await infra.execute("TENANT_UP", { slug: "yoq" }, "a1")).status === "REJECTED");
  check("TENANT_UP: domen mos emas → REJECTED", (await infra.execute("TENANT_UP", { slug: "alfa", domain: "beta.insof-erp.uz" }, "a1")).status === "REJECTED");
  check("TENANT_UP: domensiz, lekin korxonada domen bor → REJECTED", (await infra.execute("TENANT_UP", { slug: "alfa" }, "a1")).status === "REJECTED");
  tenants.alfa.status = "ARCHIVED";
  check("TENANT_UP: ARCHIVED → REJECTED", (await infra.execute("TENANT_UP", { slug: "alfa", domain: "alfa.insof-erp.uz" }, "a1")).status === "REJECTED");
  tenants.alfa.status = "PROVISIONING";
  const tu = await infra.execute("TENANT_UP", { slug: "alfa", domain: "alfa.insof-erp.uz" }, "a1");
  const installed = existsSync("/usr/local/sbin/insof-tenant-up");
  check(installed ? "TENANT_UP: sudo /usr/local/sbin/insof-tenant-up alfa alfa.insof-erp.uz" : "TENANT_UP: root nusxa o'rnatilmagan → FAILED (sudo chaqirilmadi)",
    installed ? JSON.stringify(sudoCalls.at(-1)) === JSON.stringify(["/usr/local/sbin/insof-tenant-up", "alfa", "alfa.insof-erp.uz"]) : tu.status === "FAILED" && sudoCalls.length === n0 && tu.output.includes("install -o root"), tu);
  check("TENANT_UP: rad etilganlarda sudo chaqirilmagan", installed ? sudoCalls.length === n0 + 1 : sudoCalls.length === n0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/* ═════════ 4. tenant-up.sh (statik) ═════════ */
section("scripts/tenant-up.sh");
{
  const sh = path.join(REPO, "scripts/tenant-up.sh");
  check("bash -n", spawnSync("bash", ["-n", sh]).status === 0);
  const r = spawnSync("bash", [sh, "alfa"], { encoding: "utf8" });
  check("root'siz → aniq xato", r.status !== 0 && r.stderr.includes("sudo bilan"), r.stderr);
  const src = readFileSync(sh, "utf8");
  check("shablonlar repo'dan EMAS, /usr/local/share/insof dan", src.includes("TPL_DIR=/usr/local/share/insof") && !/\$APP\/docs\/deploy/.test(src));
  check("root egaligi tekshiruvi (root_only)", /root_only "\$TPL_DIR\/insof-erp@\.service"/.test(src) && src.includes("8#022"));
  check("deploy joylari faqat runuser bilan (root chown -R yo'q)", !/chown -R/.test(src) && src.includes("runuser -u"));
  check("joylar muhitdan olinmaydi", !/\$\{APP_DIR:-|\$\{TENANT_DATA_ROOT:-|\$\{RUN_AS:-/.test(src));
  check("RESULT qatori", src.includes("RESULT systemd="));
  const sudoers = readFileSync(path.join(REPO, "docs/deploy/sudoers-insof-agent"), "utf8");
  check("sudoers: faqat root nusxa, repo yo'li yo'q", sudoers.includes("/usr/local/sbin/insof-tenant-up [a-z]*") && !/scripts\/tenant-up\.sh\s*[,\\]?\s*$/m.test(sudoers.split("\n").filter((l) => !l.startsWith("#")).join("\n")));
  const vis = spawnSync("/usr/sbin/visudo", ["-cf", path.join(REPO, "docs/deploy/sudoers-insof-agent")], { encoding: "utf8" });
  if (!vis.error) check("visudo -cf: parsed OK", vis.status === 0, vis.stdout + vis.stderr);
}

console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${ok} o'tdi, ${fail} xato\x1b[0m`);
process.exit(fail ? 1 : 0);
