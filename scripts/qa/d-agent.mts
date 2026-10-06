/**
 * QA (D): insof-agent — parserlar/chegaralar/hodisa mantiqi/amal tekshiruvi (unit) + lokal integratsiya.
 *
 *   npx tsx scripts/qa/d-agent.mts                 unit + integratsiya (~60 s)
 *   AGENT_QA_UNIT_ONLY=1 npx tsx scripts/qa/d-agent.mts   faqat unit testlar (bazasiz)
 *
 * Integratsiya: vaqtinchalik control baza `insof_test_ctl_agent` (lokal Postgres, joriy foydalanuvchi; boshida qayta
 * yaratiladi, oxirida O'CHIRILADI), soxta korxona yopiq portda → CRIT hodisa; amallar navbati (RUN_HEALTH_CHECK → DONE,
 * noma'lum tur / yomon unit / 127.0.0.1 bloki → REJECTED, test rejimida restart → FAILED, FIX_SECRET_PERMS → 600);
 * korxona "tiklanadi" → hodisa 2 ta OK dan keyin RESOLVED; ikkinchi nusxa qulf tufayli chiqadi; SIGTERM → toza to'xtash;
 * xavfsizlik moduli stub bilan → "security" hodisasi. macOS da /proc va systemctl yo'q — tegishli tekshiruvlar UNKNOWN.
 * Boshqa bazalarga (insof_erp, insof_test, insof_test_golden) tegilmaydi.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as P from "../../src/lib/control/monitor/parse";
import { UNIT_RE, IPV4_RE, checkKey } from "../../src/lib/control/monitor/contract";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let ok = 0, fail = 0;
function check(name: string, cond: unknown, info?: unknown) {
  if (cond) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${info !== undefined ? ` — ${typeof info === "string" ? info : JSON.stringify(info)?.slice(0, 300)}` : ""}`); }
}
const section = (t: string) => console.log(`\n── ${t}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ═════════════════════════ 1. Unit testlar ═════════════════════════ */

section("/proc parserlari");
{
  const a = P.parseProcStat("cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 2 3 4\n");
  const b = P.parseProcStat("cpu  150 0 150 850 50 0 0 0 0 0\n");
  check("parseProcStat: idle+iowait va jami", a?.idle === 800 && a?.total === 1000 && b?.idle === 900 && b?.total === 1200, { a, b });
  check("cpuPctFromDelta: 200 dan 100 band → 50%", P.cpuPctFromDelta(a, b) === 50, P.cpuPctFromDelta(a, b));
  check("cpuPctFromDelta: birinchi namuna → null", P.cpuPctFromDelta(null, b) === null);
  check("parseProcStat: bo'sh → null", P.parseProcStat("intr 1 2") === null);

  const mem = P.parseMeminfo("MemTotal:       4000000 kB\nMemFree:  100000 kB\nMemAvailable:   1000000 kB\nSwapTotal: 2000000 kB\nSwapFree: 1500000 kB\n");
  check("parseMeminfo: used = Total − Available", mem?.memUsed === 3000000 * 1024 && mem?.memTotal === 4000000 * 1024, mem);
  check("parseMeminfo: swap", mem?.swapUsed === 500000 * 1024 && mem?.swapTotal === 2000000 * 1024, mem);
  check("parseMeminfo: MemAvailable yo'q (eski yadro) → Free+Buffers+Cached", P.parseMeminfo("MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 250 kB\n")?.memUsed === 600 * 1024);

  const nd = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999999    10    0    0    0     0          0         0   999999    10    0    0    0     0       0          0
  eth0: 1000    10    0    0    0     0          0         0     2000    20    0    0    0     0       0          0
  eth1:500 1 0 0 0 0 0 0 700 1 0 0 0 0 0 0
`;
  const n1 = P.parseNetDev(nd);
  check("parseNetDev: lo hisobga olinmaydi, interfeyslar yig'iladi", n1?.rx === 1500 && n1?.tx === 2700, n1);
  check("netBps: 2 s da 3000/6000 bayt → 1500/3000 B/s", JSON.stringify(P.netBps({ rx: 0, tx: 0 }, { rx: 3000, tx: 6000 }, 2000)) === JSON.stringify({ rx: 1500, tx: 3000 }));
  check("netBps: hisoblagich qaytdi (reboot) → null", P.netBps({ rx: 5000, tx: 1 }, { rx: 10, tx: 2 }, 1000) === null);
  check("parseLoadavg", JSON.stringify(P.parseLoadavg("0.52 0.58 0.59 1/467 12345\n")) === "[0.52,0.58,0.59]");
  check("parseUptime", P.parseUptime("350735.47 234388.90\n") === 350735);
  check("parseProcStatus: nom va VmRSS", JSON.stringify(P.parseProcStatus("Name:\tnode\nState:\tS\nVmRSS:\t  204800 kB\n")) === JSON.stringify({ name: "node", rss: 204800 * 1024 }));
  check("parseProcStatus: yadro oqimi (VmRSS yo'q) → null", P.parseProcStatus("Name:\tkworker/0:1\nState:\tI\n") === null);
  check("topByRss: eng kattalari tartibda", P.topByRss([{ rss: 1 }, { rss: 9 }, { rss: 5 }, { rss: 7 }], 2).map((x) => x.rss).join() === "9,7");
}

section("systemd / journald");
{
  const out = `Id=insof-erp@alfa.service
LoadState=loaded
ActiveState=active
SubState=running
NRestarts=3
MemoryCurrent=314572800
ActiveEnterTimestamp=Mon 2026-10-05 10:00:00 +05

Id=insof-eco.service
LoadState=loaded
ActiveState=failed
SubState=failed
NRestarts=0
MemoryCurrent=[not set]
ActiveEnterTimestamp=

Id=redis-server.service
LoadState=not-found
ActiveState=inactive
SubState=dead
NRestarts=0
MemoryCurrent=18446744073709551615
ActiveEnterTimestamp=
`;
  const u = P.parseSystemctlShow(out);
  check("parseSystemctlShow: 3 blok", u.length === 3, u);
  check("parseSystemctlShow: NRestarts va MemoryCurrent", u[0].nRestarts === 3 && u[0].memoryCurrent === 314572800 && u[0].activeEnterTimestamp?.startsWith("Mon"), u[0]);
  check("parseSystemctlShow: [not set] / UINT64_MAX → null", u[1].memoryCurrent === null && u[2].memoryCurrent === null);
  check("unitStatus: active → OK", P.unitStatus(u[0], false) === "OK");
  check("unitStatus: active, lekin restart oshgan → WARN", P.unitStatus(u[0], true) === "WARN");
  check("unitStatus: failed → CRIT", P.unitStatus(u[1], false) === "CRIT");
  check("unitStatus: activating → WARN", P.unitStatus({ loadState: "loaded", activeState: "activating" }, false) === "WARN");
  check("unitStatus: not-found → UNKNOWN", P.unitStatus(u[2], false) === "UNKNOWN");
  check("restartsIncreased: 3→4 ha, null→4 yo'q", P.restartsIncreased(3, 4) && !P.restartsIncreased(null, 4) && !P.restartsIncreased(4, 4));
  check("countJournalLines: bo'sh qatorlar sanalmaydi", P.countJournalLines("err one\n\nerr two\n  \nerr three\n") === 3);
  check("countJournalLines: '-- No entries --' → 0", P.countJournalLines("-- No entries --\n") === 0);
}

section("Chegaralar → holat");
{
  check("disk 79.9 OK / 80 WARN / 90 CRIT", P.diskStatus(79.9) === "OK" && P.diskStatus(80) === "WARN" && P.diskStatus(90) === "CRIT");
  check("xotira 84 OK / 85 WARN / 95 CRIT", P.memStatus(84) === "OK" && P.memStatus(85) === "WARN" && P.memStatus(95) === "CRIT");
  check("load/yadro: 2 yadro, load 2.9 OK / 3 WARN / 6 CRIT", P.loadStatus(2.9, 2) === "OK" && P.loadStatus(3, 2) === "WARN" && P.loadStatus(6, 2) === "CRIT");
  check("CPU: bitta sakrash ogohlantirmaydi", P.cpuSustainedStatus([10, 20, 99]) === "OK");
  check("CPU: 3 namuna ≥85 → WARN", P.cpuSustainedStatus([50, 90, 88, 86]) === "WARN");
  check("CPU: 3 namuna ≥95 → CRIT", P.cpuSustainedStatus([96, 97, 99]) === "CRIT");
  check("CPU: namuna yo'q → UNKNOWN", P.cpuSustainedStatus([]) === "UNKNOWN");
  check("SSL: 30 kun OK / 20 WARN / 6 CRIT", P.levelBelow(30, P.THRESHOLDS.sslDays) === "OK" && P.levelBelow(20, P.THRESHOLDS.sslDays) === "WARN" && P.levelBelow(6, P.THRESHOLDS.sslDays) === "CRIT");
  check("null qiymat → UNKNOWN", P.diskStatus(null) === "UNKNOWN");
  check("worst: CRIT > WARN > OK > UNKNOWN", P.worst("OK", "UNKNOWN", "WARN") === "WARN" && P.worst("UNKNOWN") === "UNKNOWN" && P.worst("WARN", "CRIT") === "CRIT");
  check("severityFor: WARN → MEDIUM, CRIT → berilgan/HIGH, OK → null", P.severityFor("WARN") === "MEDIUM" && P.severityFor("CRIT") === "HIGH" && P.severityFor("CRIT", "CRITICAL") === "CRITICAL" && P.severityFor("OK") === null);
  check("statusForSeverity", P.statusForSeverity("CRITICAL") === "CRIT" && P.statusForSeverity("MEDIUM") === "WARN" && P.statusForSeverity("LOW") === "OK");
  check("latestBackupDir: .partial va begona nomlar o'tkaziladi", P.latestBackupDir(["2026-10-04_0230", "2026-10-05_0230.partial", "2026-10-05_0230", "2026-10-05_0230-1", "lost+found", ".lock"]) === "2026-10-05_0230-1");
  check("latestBackupDir: bo'sh → null", P.latestBackupDir([".lock"]) === null);
}

section("Hodisa hayot sikli");
{
  let open = false, streak = 0;
  const step = (s: "OK" | "WARN" | "CRIT" | "UNKNOWN") => {
    const d = P.decideIncident(open, streak, s);
    streak = d.okStreak;
    if (d.op === "open") open = true;
    if (d.op === "resolve") open = false;
    return d.op;
  };
  check("OK (hodisa yo'q) → none", step("OK") === "none");
  check("CRIT → open", step("CRIT") === "open");
  check("WARN → update", step("WARN") === "update");
  check("1-OK → hali yopilmaydi", step("OK") === "none" && open);
  check("UNKNOWN seriyani buzmaydi va yopmaydi", step("UNKNOWN") === "none" && open && streak === 1);
  check("2-OK → resolve", step("OK") === "resolve" && !open);
  step("CRIT"); step("OK");
  check("OK, keyin yana CRIT → seriya 0 dan (update)", step("CRIT") === "update" && streak === 0);
  check("RESOLVE_AFTER_OK = 2", P.RESOLVE_AFTER_OK === 2);
}

section("Amal tekshiruvi va sirlarni tozalash");
{
  check("noma'lum tur → rad", !P.validateAction("RM_RF", {}).ok);
  check("RESTART_UNIT insof-erp@alfa → ok", P.validateAction("RESTART_UNIT", { unit: "insof-erp@alfa" }).ok);
  check("RESTART_UNIT insof-control / insof-eco → ok", P.validateAction("RESTART_UNIT", { unit: "insof-control" }).ok && P.validateAction("RESTART_UNIT", { unit: "insof-eco" }).ok);
  for (const bad of ["nginx", "sshd", "insof-erp@alfa; reboot", "insof-erp@ALFA", "insof-erp@a", "../insof-control", "insof-erp@alfa nginx", ""]) {
    check(`RESTART_UNIT "${bad}" → rad`, !P.validateAction("RESTART_UNIT", { unit: bad }).ok);
  }
  check("RESTART_UNIT unit raqam → rad", !P.validateAction("RESTART_UNIT", { unit: 5 }).ok);
  check("RESTART_UNIT params massiv → rad", !P.validateAction("RESTART_UNIT", ["insof-control"]).ok);
  check("BLOCK_IP 203.0.113.7 → ok", P.validateAction("BLOCK_IP", { ip: "203.0.113.7" }).ok);
  for (const bad of ["256.1.1.1", "1.2.3", "1.2.3.4/8", "1.2.3.4 to any", "::1", "127.0.0.1", "0.0.0.0"]) {
    check(`BLOCK_IP "${bad}" → rad`, !P.validateAction("BLOCK_IP", { ip: bad }).ok);
  }
  check("UNBLOCK_IP 127.0.0.1 → ruxsat (blokni olib tashlash xavfsiz)", P.validateAction("UNBLOCK_IP", { ip: "127.0.0.1" }).ok);
  const v = P.validateAction("RUN_BACKUP", { extra: "rm -rf /" });
  check("ortiqcha parametrlar olinmaydi", v.ok && JSON.stringify(v.params) === "{}", v);
  check("contract regexlari: UNIT_RE / IPV4_RE", UNIT_RE.test("insof-erp@sharq-2") && !UNIT_RE.test("insof-erp@") && IPV4_RE.test("10.0.0.1") && !IPV4_RE.test("10.0.0.01x"));
  check("checkKey shakllari", checkKey.unit("nginx") === checkKey.nginx() && checkKey.tenantHttp("a") === "http:tenant:a");

  const s = P.scrubSecrets([
    "DATABASE_URL=postgresql://insof:Sup3rParol@127.0.0.1:5432/insof_erp",
    "curl https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def",
    "AUTH_SECRET=qwerty123 CONTROL_SSO_KEY: 'abc' password=hunter2&x=1",
    "ANTHROPIC key sk-ant-api03-AAAAAAAAAAAAAAAAAAAA",
    "ok: 3 dump, 2026-10-05_0230",
  ].join("\n"));
  check("scrub: URL paroli yashirildi", !s.includes("Sup3rParol") && s.includes("postgresql://insof:***@127.0.0.1"), s);
  check("scrub: bot tokeni yashirildi", !s.includes("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"), s);
  check("scrub: Bearer", !s.includes("eyJhbGci"), s);
  check("scrub: KEY=qiymat (SECRET, SSO_KEY, password)", !s.includes("qwerty123") && !s.includes("'abc'") && !s.includes("hunter2"), s);
  check("scrub: sk-ant kalit", !s.includes("sk-ant-api03-AAAA"), s);
  check("scrub: oddiy matn saqlanadi", s.includes("ok: 3 dump, 2026-10-05_0230"), s);
  const big = "o'zbekcha ✓ qator\n".repeat(2000) + "OXIRI";
  const t = P.trimOutput(big);
  check("trimOutput: ≤ 8 KB + sarlavha, oxiri saqlanadi", Buffer.byteLength(t) <= P.OUTPUT_LIMIT + 64 && t.endsWith("OXIRI") && t.startsWith("…(boshi"), Buffer.byteLength(t));
  check("trimOutput: UTF-8 buzilmagan", !t.includes("�"));
  check("trimOutput: kichik matn o'zgarmaydi", P.trimOutput("salom\n") === "salom");
}

section("Redaksiya: kalit ro'yxati (_KEY, KEY, COOKIE, SESSION, CREDENTIAL; PASS toraytirilgan)");
{
  const uuid = "3f2b8c1e-9a4d-4e7f-b1c2-0d9e8f7a6b5c";
  const s2 = P.scrubSecrets([
    `YANDEX_MAPS_KEY=${uuid}`,
    "DOTENV_KEY=dotenv://:key_1234@dotenv.org/vault?environment=prod",
    "KEY=abc123def",
    "SESSION_COOKIE=s%3Aabcdef0123",
    "session: 9f8e7d6c5b",
    "GOOGLE_CREDENTIALS=gc-xyz-789",
    "DB_PASS=hunter22 PASS_FILE=/etc/x",
    "tests passed: 12, bypass=on, passes=3, compass: north",
  ].join("\n"));
  check("YANDEX_MAPS_KEY=uuid → yashirildi", !s2.includes(uuid) && s2.includes("YANDEX_MAPS_KEY=***"), s2);
  check("DOTENV_KEY → yashirildi", !s2.includes("key_1234") && s2.includes("DOTENV_KEY=***"), s2);
  check("aynan KEY= → yashirildi", s2.includes("KEY=***") && !s2.includes("abc123def"), s2);
  check("COOKIE / SESSION / CREDENTIAL → yashirildi", !s2.includes("abcdef0123") && !s2.includes("9f8e7d6c5b") && !s2.includes("gc-xyz-789"), s2);
  check("DB_PASS / PASS_FILE → yashirildi", !s2.includes("hunter22") && s2.includes("PASS_FILE=***"), s2);
  check("«passed», «bypass», «passes», «compass» saqlanadi", s2.includes("tests passed: 12, bypass=on, passes=3, compass: north"), s2);
  check("MONKEY=… (KEY so'z ichida) saqlanadi", P.scrubSecrets("MONKEY=banana") === "MONKEY=banana");

  const j = P.scrubJson({
    YANDEX_MAPS_KEY: uuid, DOTENV_KEY: "x", KEY: "y", apiKey: "z", sessionCookie: "c",
    authSecret: ["a1", "a2"], credentials: { user: "u", pass: "p" }, tokens: [{ v: 1 }],
    passed: 12, bypass: "on", note: `password=${"q".repeat(8)}`, list: ["ok"], nested: { DB_PASS: 5 },
  });
  check("scrubJson: sir nomli kalit (satr) → ***", j.YANDEX_MAPS_KEY === "***" && j.DOTENV_KEY === "***" && j.KEY === "***" && j.apiKey === "***" && j.sessionCookie === "***", j);
  check("scrubJson: sir nomli kalit ostidagi massiv/obyekt → butunlay ***", (j.authSecret as unknown) === "***" && (j.credentials as unknown) === "***" && (j.tokens as unknown) === "***", j);
  check("scrubJson: passed/bypass saqlanadi, ichki DB_PASS yashirildi", j.passed === 12 && j.bypass === "on" && (j.nested.DB_PASS as unknown) === "***", j);
  check("scrubJson: oddiy satrdagi password= → ***", j.note === "password=***" && j.list[0] === "ok", j);
}

section("Qayta autentifikatsiya (xavfli amallar)");
{
  const { REAUTH_ACTIONS, needsReauth } = await import("../../src/lib/control/monitor/shared");
  check("REAUTH: DEPLOY, ROLLBACK, REBOOT, TENANT_UP, PG_TERMINATE", ["DEPLOY", "ROLLBACK", "REBOOT", "TENANT_UP", "PG_TERMINATE"].every((t) => needsReauth(t)) && REAUTH_ACTIONS.length === 5);
  check("REAUTH: oddiy amallar (RUN_HEALTH_CHECK, LOG_TAIL, PG_CANCEL) — yo'q", !needsReauth("RUN_HEALTH_CHECK") && !needsReauth("LOG_TAIL") && !needsReauth("PG_CANCEL"));
  const bcrypt = (await import("bcryptjs")).default;
  const { verifyReauth } = await import("../../src/lib/control/reauth");
  const hash = await bcrypt.hash("To'g'riParol1", 4);
  const ip = "198.51.100.77";
  check("to'g'ri parol → null", (await verifyReauth({ login: "qa-reauth", hash, password: "To'g'riParol1", ip })) === null);
  check("bo'sh parol → «kiriting» (hisobga olinmaydi)", /kiriting/.test((await verifyReauth({ login: "qa-reauth", hash, password: "", ip })) ?? ""));
  check("noto'g'ri parol → «Parol noto'g'ri»", (await verifyReauth({ login: "qa-reauth", hash, password: "xato", ip })) === "Parol noto'g'ri");
  check("hash yo'q (admin faol emas) → rad", (await verifyReauth({ login: "qa-reauth2", hash: null, password: "To'g'riParol1", ip })) === "Parol noto'g'ri");
  for (let i = 0; i < 4; i++) await verifyReauth({ login: "qa-reauth", hash, password: `xato${i}`, ip });
  const locked = await verifyReauth({ login: "qa-reauth", hash, password: "To'g'riParol1", ip });
  check("5 ta xato → qulf (to'g'ri parol ham rad, login bilan umumiy hisob)", !!locked && /Juda ko'p/.test(locked), locked);
  const { checkLogin } = await import("../../src/lib/login-guard");
  check("qulf login sahifasiga ham ta'sir qiladi (admin:<login> kaliti)", !checkLogin("admin:qa-reauth", "203.0.113.200").ok);
  const src = (await import("node:fs")).readFileSync(path.join(REPO, "src/app/superadmin/(panel)/monitor-actions.ts"), "utf8");
  check("enqueueAction: parol params/jurnalga tushmaydi (create va logEvent faqat p bilan)", /agentAction\.create\(\{ data: \{ type, params: p as/.test(src) && /logEvent\(a\.id, "AGENT_ACTION", null, \{ actionId: res\.id, type, label: actionLabel\(type\), params: p,/.test(src) && !/params:\s*\{[^}]*password/.test(src));
}

section("Root o'ramlari: insof-restart, insof-ufw (root'siz — faqat tekshiruv qismi)");
{
  const sh = (file: string, args: string[]) => spawnSync("/bin/bash", [path.join(REPO, "scripts", file), ...args], { encoding: "utf8" });
  check("insof-restart.sh: bash -n", spawnSync("bash", ["-n", path.join(REPO, "scripts/insof-restart.sh")]).status === 0);
  check("insof-ufw.sh: bash -n", spawnSync("bash", ["-n", path.join(REPO, "scripts/insof-ufw.sh")]).status === 0);
  for (const bad of [[], ["nginx"], ["insof-erp@"], ["insof-erp@a"], ["insof-erp@-x"], ["insof-erp@alfa;id"], ["insof-erp@alfa", "nginx"], ["insof-erp@ALFA"], ["--help"], ["insof-control.service"]]) {
    const r = sh("insof-restart.sh", bad);
    check(`insof-restart ${JSON.stringify(bad)} → rad (exit 2)`, r.status === 2, r.stderr);
  }
  for (const okUnit of ["insof-erp@alfa", "insof-erp@sharq-2", "insof-control", "insof-eco", "insof-agent"]) {
    const r = sh("insof-restart.sh", [okUnit]);
    check(`insof-restart ${okUnit} → tekshiruvdan o'tdi (root'siz: exit 1 «root kerak»)`, r.status === 1 && /root kerak/.test(r.stderr), r.stderr);
  }
  for (const bad of [["deny"], ["deny", "1.2.3.4", "x"], ["block", "1.2.3.4"], ["deny", "any"], ["deny", "1.2.3.4/8"], ["deny", "256.1.1.1"], ["deny", "01.2.3.4"],
    ["deny", "127.0.0.1"], ["deny", "0.0.0.0"], ["deny", "255.255.255.255"], ["deny", "-1.2.3.4"]]) {
    const r = sh("insof-ufw.sh", bad);
    check(`insof-ufw ${JSON.stringify(bad)} → rad (exit 2)`, r.status === 2, r.stderr);
  }
  for (const a of [["deny", "203.0.113.7"], ["undeny", "203.0.113.7"], ["undeny", "127.0.0.1"]]) {
    const r = sh("insof-ufw.sh", a);
    check(`insof-ufw ${a.join(" ")} → tekshiruvdan o'tdi (root'siz: exit 1)`, r.status === 1 && /root kerak/.test(r.stderr), r.stderr);
  }
  const rsrc = (await import("node:fs")).readFileSync(path.join(REPO, "scripts/insof-restart.sh"), "utf8");
  const usrc = (await import("node:fs")).readFileSync(path.join(REPO, "scripts/insof-ufw.sh"), "utf8");
  check("o'ramlar: to'liq yo'l, `--`, PATH qat'iy", rsrc.includes('exec /usr/bin/systemctl restart -- "$UNIT"') && usrc.includes('exec /usr/sbin/ufw insert 1 deny from "$IP"') && usrc.includes('exec /usr/sbin/ufw delete deny from "$IP"') && /export PATH=\/usr\/sbin/.test(rsrc + usrc));
  const sudoers = (await import("node:fs")).readFileSync(path.join(REPO, "docs/deploy/sudoers-insof-agent"), "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  check("sudoers: eski wildcard qatorlar yo'q (systemctl restart insof-erp@*, ufw … from *)", !/systemctl restart insof-erp@\*/.test(sudoers) && !/ufw (insert 1 deny|delete deny) from \*/.test(sudoers) && !/\/usr\/bin\/systemctl restart/.test(sudoers), sudoers);
  check("sudoers: o'ramlar ruxsat etilgan", sudoers.includes("/usr/local/sbin/insof-restart insof-erp@[a-z0-9]*") && sudoers.includes("/usr/local/sbin/insof-restart insof-agent") && sudoers.includes("/usr/local/sbin/insof-ufw deny [0-9]*") && sudoers.includes("/usr/local/sbin/insof-ufw undeny [0-9]*"));
  const vis = spawnSync("/usr/sbin/visudo", ["-cf", path.join(REPO, "docs/deploy/sudoers-insof-agent")], { encoding: "utf8" });
  if (!vis.error) check("sudoers: visudo -cf parsed OK", vis.status === 0, vis.stdout + vis.stderr);
  const asrc = (await import("node:fs")).readFileSync(path.join(REPO, "scripts/insof-agent.ts"), "utf8");
  check("agent: RESTART_UNIT/BLOCK_IP/UNBLOCK_IP o'ramlar orqali", asrc.includes("sudo([BIN.restart, unit]") && asrc.includes('sudo([BIN.ufwWrap, "deny", params.ip!]') && asrc.includes('sudo([BIN.ufwWrap, "undeny", params.ip!]') && !/sudo\(\[BIN\.(systemctl, "restart"|ufw,)/.test(asrc));
  const dsrc = (await import("node:fs")).readFileSync(path.join(REPO, "scripts/deploy.sh"), "utf8");
  check("deploy.sh: o'ram (yo'q bo'lsa ogohlantirib eski buyruq)", dsrc.includes('sudo "$RESTART_WRAPPER" "$1"') && /RESTART_WRAPPER o'rnatilmagan/.test(dsrc) && (dsrc.match(/^\s*sudo systemctl restart/gm) ?? []).length === 1);
}

section("Xavfsizlik topilmalari (B kelishuvi)");
{
  check("INFO + status OK → OK, muammo emas", P.findingCheckStatus({ severity: "INFO", detail: { status: "OK" } }) === "OK" && !P.findingIsProblem({ severity: "INFO", detail: { status: "OK" } }));
  check("INFO + status UNKNOWN → UNKNOWN, muammo emas", P.findingCheckStatus({ severity: "INFO", detail: { status: "UNKNOWN", reason: "x" } }) === "UNKNOWN" && !P.findingIsProblem({ severity: "INFO", detail: { status: "UNKNOWN" } }));
  check("MEDIUM → WARN (muammo), HIGH/CRITICAL → CRIT", P.findingCheckStatus({ severity: "MEDIUM" }) === "WARN" && P.findingIsProblem({ severity: "LOW" }) && P.findingCheckStatus({ severity: "CRITICAL" }) === "CRIT");
}

if (process.env.AGENT_QA_UNIT_ONLY === "1") finish();

/* ═════════════════════════ 2. Integratsiya (lokal) ═════════════════════════ */

const DB = "insof_test_ctl_agent";
const PGUSER = process.env.D_PGUSER || os.userInfo().username;
const PG = `postgresql://${PGUSER}@localhost:5432`;
const URL_ = `${PG}/${DB}`;
const WORK = path.join(os.tmpdir(), `insof-qa-agent-${process.pid}`);
const TSX = path.join(REPO, "node_modules/tsx/dist/cli.mjs");
const agents: ChildProcess[] = [];

function psql(sql: string) {
  return spawnSync("psql", [`${PG}/postgres`, "-qAtX", "-c", sql], { encoding: "utf8" });
}
function dropDb() {
  psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
}

async function freePort(): Promise<number> {
  return new Promise((res) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
}

type AgentRun = { child: ChildProcess; log: () => string; exited: Promise<number | null> };
function startAgent(extraEnv: Record<string, string> = {}): AgentRun {
  let out = "";
  const child = spawn(process.execPath, [TSX, "scripts/insof-agent.ts"], {
    cwd: REPO,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: os.homedir(), TMPDIR: os.tmpdir(),
      CONTROL_ENV_FILE: path.join(WORK, "app/control.env"),
      AGENT_APP_DIR: path.join(WORK, "app"),
      AGENT_ECO_URL: "", AGENT_SSL_DOMAINS: "", BACKUP_ENV: path.join(WORK, "no-backup.env"),
      AGENT_BACKUP_DIR: path.join(WORK, "backups"), AGENT_FAST_MS: "3000", AGENT_SLOW_MS: "8000", AGENT_ACTION_POLL_MS: "1000",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (b) => { out += b; });
  child.stderr!.on("data", (b) => { out += b; });
  agents.push(child);
  const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
  return { child, log: () => out, exited };
}

async function until<T>(fn: () => Promise<T | null | undefined | false>, ms: number, stepMs = 1000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch { /* hali tayyor emas */ }
    await sleep(stepMs);
  }
  return null;
}

async function integration() {
  section("Integratsiya: tayyorlash");
  if (!/^insof_test_[a-z0-9_]+$/.test(DB)) throw new Error("test bazasi nomi");
  dropDb();
  const c = psql(`CREATE DATABASE ${DB}`);
  check(`${DB} yaratildi`, c.status === 0, c.stderr);
  const mig = spawnSync(process.execPath, [path.join(REPO, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", "prisma/control/schema.prisma"], {
    cwd: REPO, encoding: "utf8", env: { ...process.env, CONTROL_DATABASE_URL: URL_ },
  });
  check("control migratsiyasi (monitoring jadvallari bilan)", mig.status === 0, mig.stderr?.slice(-300));

  mkdirSync(path.join(WORK, "app/tenants"), { recursive: true });
  writeFileSync(path.join(WORK, "app/control.env"), `INSOF_ENV=test\nCONTROL_DATABASE_URL=${URL_}\nDATABASE_URL=${URL_}\n`);
  writeFileSync(path.join(WORK, "app/tenants/fake.env"), "PORT=1\nAUTH_SECRET=x\n");
  chmodSync(path.join(WORK, "app/tenants/fake.env"), 0o644);
  // Xavfsizlik moduli stub'i (B moduli o'rnida) — ikkinchi bosqichda AGENT_SECURITY_MODULE bilan
  // B kelishuvi: kalit "security:<nom>"; holat yaxshi — INFO + detail.status "OK"; vosita yo'q — INFO + "UNKNOWN" + reason.
  // WORK/fixed fayli paydo bo'lsa "open-port" tuzalgan deb qaytadi → hodisa 2 skanerdan keyin yopilishi kerak.
  writeFileSync(path.join(WORK, "security-stub.mjs"), `
import { existsSync } from "node:fs";
export async function runSecurityChecks(ctx) {
  ctx.log("stub: " + ctx.tenants.length + " korxona, linux=" + ctx.linux);
  const fixed = existsSync(${JSON.stringify(path.join(WORK, "fixed"))});
  return [
    fixed
      ? { key: "security:open-port", category: "security", severity: "INFO", title: "Portlar joyida", detail: { status: "OK" } }
      : { key: "security:open-port", category: "security", severity: "HIGH", title: "Stub: 5432 port tashqariga ochiq", detail: { url: "postgresql://u:Maxfiy123@h/db" },
          suggestedActions: [{ type: "BLOCK_IP", params: { ip: "203.0.113.9" }, label: "blok" }, { type: "RESTART_UNIT", params: { unit: "sshd" }, label: "yomon" }] },
    { key: "security:sshd-config", category: "config", severity: "INFO", title: "sshd sozlamasi yaxshi", detail: { status: "OK" } },
    { key: "security:os-updates", category: "update", severity: "INFO", title: "apt: tekshirib bo'lmadi", detail: { status: "UNKNOWN", reason: "apt yo'q (macOS)" } },
  ];
}
export async function runAiAnalysis(trigger) { return { id: "stub-" + trigger }; }
`);

  const { PrismaClient } = await import("../../src/generated/control/index.js");
  const db = new PrismaClient({ datasourceUrl: URL_ });
  const port = await freePort(); // hozir yopiq — korxona "ishlamayapti"
  const fake = await db.tenant.create({ data: { slug: "fake", name: "Soxta korxona", internalUrl: `http://127.0.0.1:${port}`, port, dbName: "insof_test_agent_fake_nodb", status: "ACTIVE" } });
  check(`soxta korxona yopiq portda (${port})`, !!fake.id);

  try {
    section("Integratsiya: agent ishga tushdi (B moduli yo'q)");
    // B moduli birlashtirilgan bo'lsa ham "yo'q" holatini sinash uchun — mavjud bo'lmagan yo'l (faqat test rejimida o'qiladi)
    const a = startAgent({ AGENT_SECURITY_MODULE: path.join(WORK, "no-such-security-module.ts") });
    const hb = await until(() => db.agentHeartbeat.findUnique({ where: { id: "main" } }), 30_000);
    check("AgentHeartbeat 'main' yozildi", !!hb, a.log().slice(-800));
    const info = (hb?.info ?? {}) as Record<string, unknown>;
    check("heartbeat info: linux=false, testMode=true", info.linux === false && info.testMode === true, info);

    const second = startAgent();
    const code2 = await Promise.race([second.exited, sleep(30_000).then(() => "timeout")]);
    check("ikkinchi nusxa qulf tufayli chiqadi (exit 3)", code2 === 3, `${code2} ${second.log().slice(-300)}`);

    const httpCrit = await until(async () => {
      const i = await db.incident.findFirst({ where: { key: checkKey.tenantHttp("fake"), status: "OPEN" } });
      return i && i.count >= 2 ? i : null;
    }, 30_000);
    check("yopiq port → http:tenant:fake CRIT hodisa (CRITICAL, count≥2)", httpCrit?.severity === "CRITICAL", httpCrit ?? a.log().slice(-800));
    const sug = httpCrit?.suggestedActions as { type: string; params?: { unit?: string } }[] | null;
    check("tavsiya: RESTART_UNIT insof-erp@fake", sug?.[0]?.type === "RESTART_UNIT" && sug?.[0]?.params?.unit === "insof-erp@fake", sug);
    check("tenantId hodisada", httpCrit?.tenantId === fake.id);

    const checks = await db.serviceCheck.findMany();
    const by = new Map(checks.map((s) => [s.key, s]));
    const st = (k: string) => by.get(k)?.status;
    check("ServiceCheck http:tenant:fake = CRIT", st(checkKey.tenantHttp("fake")) === "CRIT", by.get(checkKey.tenantHttp("fake")));
    check("unit:insof-erp@fake = UNKNOWN (systemd yo'q — aniq xabar)", st(checkKey.unit("insof-erp@fake")) === "UNKNOWN" && /systemd yo'q/.test(by.get(checkKey.unit("insof-erp@fake"))?.message ?? ""), by.get(checkKey.unit("insof-erp@fake")));
    check("host:memory / host:cpu = UNKNOWN (/proc yo'q)", st(checkKey.memory()) === "UNKNOWN" && st(checkKey.cpu()) === "UNKNOWN" && /\/proc yo'q/.test(by.get(checkKey.memory())?.message ?? ""));
    check("host:disk haqiqiy holat (statfs macOS da ham ishlaydi)", ["OK", "WARN", "CRIT"].includes(st(checkKey.disk()) ?? ""), by.get(checkKey.disk()));
    check("db:postgres tekshirildi", ["OK", "WARN", "CRIT"].includes(st(checkKey.postgres()) ?? "") && (by.get(checkKey.postgres())?.latencyMs ?? -1) >= 0, by.get(checkKey.postgres()));
    check("db:tenant:fake = CRIT (baza yo'q)", st(checkKey.tenantDb("fake")) === "CRIT");
    check("ECO o'chiq → UNKNOWN", st(checkKey.eco()) === "UNKNOWN");
    check("unit hodisalari ochilmagan (UNKNOWN → hodisa yo'q)", (await db.incident.count({ where: { key: { startsWith: "unit:" } } })) === 0);
    const snaps = await db.hostSnapshot.findMany({ orderBy: { takenAt: "desc" }, take: 2 });
    check("HostSnapshot yozilmoqda (os-fallback, disk bilan)", snaps.length >= 2 && Number(snaps[0].diskTotal) > 0 && (snaps[0].extra as { source?: string })?.source === "os-fallback", snaps[0]);

    const slowDone = await until(async () => {
      const b = await db.serviceCheck.findUnique({ where: { key: checkKey.backup() } });
      const s = await db.serviceCheck.findUnique({ where: { key: "security:scan" } });
      return b && s ? { b, s } : null;
    }, 30_000);
    check("backup:latest = UNKNOWN (lokal muhit)", slowDone?.b.status === "UNKNOWN", slowDone?.b);
    check("security:scan = UNKNOWN 'modul hali o'rnatilmagan'", slowDone?.s.status === "UNKNOWN" && /o'rnatilmagan/.test(slowDone?.s.message ?? ""), slowDone?.s);
    check("journal / reboot = UNKNOWN", (await db.serviceCheck.findUnique({ where: { key: "journal:all" } }))?.status === "UNKNOWN" && (await db.serviceCheck.findUnique({ where: { key: "host:reboot" } }))?.status === "UNKNOWN");

    section("Integratsiya: amallar navbati");
    const q = (type: string, params: object = {}) => db.agentAction.create({ data: { type, params } });
    const acts = {
      health: await q("RUN_HEALTH_CHECK"),
      bogus: await q("DROP_DATABASE", { name: "insof_erp" }),
      badUnit: await q("RESTART_UNIT", { unit: "sshd; rm -rf /" }),
      okUnitTest: await q("RESTART_UNIT", { unit: "insof-erp@fake" }),
      loopback: await q("BLOCK_IP", { ip: "127.0.0.1" }),
      perms: await q("FIX_SECRET_PERMS"),
      sec: await q("RUN_SECURITY_SCAN"),
    };
    const finished = await until(async () => {
      const rows = await db.agentAction.findMany({ where: { id: { in: Object.values(acts).map((x) => x.id) } } });
      return rows.every((r) => !["PENDING", "RUNNING"].includes(r.status)) ? new Map(rows.map((r) => [r.id, r])) : null;
    }, 40_000);
    const g = (k: keyof typeof acts) => finished?.get(acts[k].id);
    check("RUN_HEALTH_CHECK → DONE", g("health")?.status === "DONE" && /tekshiruv/.test(g("health")?.output ?? ""), g("health"));
    check("noma'lum tur → REJECTED", g("bogus")?.status === "REJECTED", g("bogus"));
    check("RESTART_UNIT yomon unit → REJECTED", g("badUnit")?.status === "REJECTED", g("badUnit"));
    check("RESTART_UNIT test rejimida → FAILED [test-mode] (sudo chaqirilmaydi)", g("okUnitTest")?.status === "FAILED" && /test-mode/.test(g("okUnitTest")?.output ?? ""), g("okUnitTest"));
    check("BLOCK_IP 127.0.0.1 → REJECTED", g("loopback")?.status === "REJECTED", g("loopback"));
    const mode = statSync(path.join(WORK, "app/tenants/fake.env")).mode & 0o777;
    check("FIX_SECRET_PERMS → DONE, fake.env 644 → 600", g("perms")?.status === "DONE" && mode === 0o600 && /644 → 600/.test(g("perms")?.output ?? ""), { mode: mode.toString(8), out: g("perms")?.output });
    check("RUN_SECURITY_SCAN (modul yo'q) → FAILED", g("sec")?.status === "FAILED", g("sec"));
    check("finishedAt / startedAt yozilgan", [...(finished?.values() ?? [])].every((r) => r.finishedAt && (r.status === "REJECTED" || r.startedAt)));

    section("Integratsiya: tiklanish → RESOLVED");
    const srv = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, version: null })); });
    await new Promise<void>((r) => srv.listen(port, "127.0.0.1", () => r()));
    const resolved = await until(() => db.incident.findFirst({ where: { id: httpCrit?.id ?? "-", status: "RESOLVED" } }), 30_000);
    check("korxona javob bera boshladi → 2 ta OK dan keyin RESOLVED", !!resolved?.resolvedAt, a.log().slice(-600));
    check("ServiceCheck http:tenant:fake = OK, changedAt yangilandi", (await db.serviceCheck.findUnique({ where: { key: checkKey.tenantHttp("fake") } }))?.status === "OK");
    srv.close();

    section("Integratsiya: SIGTERM");
    a.child.kill("SIGTERM");
    const code = await Promise.race([a.exited, sleep(20_000).then(() => "timeout")]);
    check("SIGTERM → toza chiqish (exit 0)", code === 0, `${code} ${a.log().slice(-400)}`);
    const hb2 = await db.agentHeartbeat.findUnique({ where: { id: "main" } });
    check("heartbeat info.stopped = true", (hb2?.info as { stopped?: boolean })?.stopped === true, hb2?.info);
    check("agent jurnalida sir yo'q", !/Maxfiy123|AUTH_SECRET=x/.test(a.log()));

    section("Integratsiya: xavfsizlik moduli (stub)");
    const b = startAgent({ AGENT_SECURITY_MODULE: path.join(WORK, "security-stub.mjs") });
    const secInc = await until(() => db.incident.findFirst({ where: { source: "security", key: "security:open-port" } }), 30_000);
    check("Finding → Incident (source security, HIGH, kalit takror prefikssiz)", secInc?.severity === "HIGH" && secInc.status === "OPEN", secInc ?? b.log().slice(-800));
    check("detail dagi parol tozalangan", !JSON.stringify(secInc?.detail ?? {}).includes("Maxfiy123"), secInc?.detail);
    const sa = (secInc?.suggestedActions ?? []) as { type: string }[];
    check("tavsiyalar oq ro'yxat bo'yicha filtrlangan (yomon RESTART_UNIT olib tashlandi)", sa.length === 1 && sa[0].type === "BLOCK_IP", sa);
    check("security:scan = CRIT (HIGH topilma)", (await db.serviceCheck.findUnique({ where: { key: "security:scan" } }))?.status === "CRIT");
    check("INFO + status OK / UNKNOWN uchun hodisa ochilmadi", (await db.incident.count({ where: { key: { in: ["security:sshd-config", "security:os-updates"] } } })) === 0);
    const osu = await db.serviceCheck.findUnique({ where: { key: "security:os-updates" } });
    check("UNKNOWN topilma → ServiceCheck UNKNOWN, sababi bilan", osu?.status === "UNKNOWN" && /apt yo'q/.test(osu.message ?? ""), osu);
    check("OK topilma → ServiceCheck OK", (await db.serviceCheck.findUnique({ where: { key: "security:sshd-config" } }))?.status === "OK");
    writeFileSync(path.join(WORK, "fixed"), "1");
    const secRes = await until(() => db.incident.findFirst({ where: { id: secInc?.id ?? "-", status: "RESOLVED" } }), 40_000);
    check("tuzalgan (INFO, status OK) → 2 skanerdan keyin RESOLVED", !!secRes, b.log().slice(-600));
    const ai = await db.agentAction.create({ data: { type: "RUN_AI_ANALYSIS", params: {} } });
    const aiDone = await until(async () => { const r = await db.agentAction.findUnique({ where: { id: ai.id } }); return r && r.status !== "PENDING" && r.status !== "RUNNING" ? r : null; }, 20_000);
    check("RUN_AI_ANALYSIS → DONE (stub hisobot id)", aiDone?.status === "DONE" && /stub-manual/.test(aiDone.output ?? ""), aiDone);
    b.child.kill("SIGTERM");
    check("ikkinchi bosqich SIGTERM → exit 0", (await Promise.race([b.exited, sleep(20_000).then(() => "timeout")])) === 0);
  } finally {
    for (const ch of agents) if (ch.exitCode === null) ch.kill("SIGKILL");
    await db.$disconnect();
  }
}

function finish(): never {
  console.log(`\n${ok} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

try {
  await integration();
} catch (e) {
  check("integratsiya kutilmagan xatosiz", false, (e as Error).stack ?? String(e));
} finally {
  for (const ch of agents) if (ch.exitCode === null) ch.kill("SIGKILL");
  await sleep(500);
  dropDb();
  check(`${DB} o'chirildi`, !psql(`SELECT 1 FROM pg_database WHERE datname='${DB}'`).stdout.includes("1"));
  rmSync(WORK, { recursive: true, force: true });
}
finish();
