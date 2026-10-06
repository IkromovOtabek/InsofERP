/**
 * QA (D): DevOps amallari — DEPLOY/ROLLBACK (ajratilgan jarayon, log, yakunlash, qulf), LOG_TAIL, relizlar holati (git).
 *
 *   npx tsx scripts/qa/d-devops.mts
 *
 * Bazasiz: control o'rniga xotiradagi soxta obyekt; vaqtinchalik APP_DIR (soxta scripts/deploy.sh, releases/, current),
 * vaqtinchalik git repo + "origin" (bare). macOS'da systemd yo'q — detached rejim sinaladi. Hech narsa serverga tegmaydi.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

let ok = 0, fail = 0;
function check(name: string, cond: unknown, info?: unknown) {
  if (cond) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${info !== undefined ? ` — ${typeof info === "string" ? info.slice(0, 600) : JSON.stringify(info)?.slice(0, 600)}` : ""}`); }
}
const section = (t: string) => console.log(`\n── ${t}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TMP = mkdtempSync(path.join(os.tmpdir(), "insof-devops-"));
const APP = path.join(TMP, "app");
const LOG = path.join(TMP, "insof-deploy.log");
mkdirSync(path.join(APP, "scripts"), { recursive: true });
writeFileSync(LOG, "");
process.env.AGENT_DEPLOY_LOG = LOG;
process.env.AGENT_GIT_FETCH = "1";
process.env.DEPLOY_LOCK = path.join(APP, ".deploy.lock");

const P = await import("../../src/lib/control/monitor/parse");
const C = await import("../../src/lib/control/devops/contract");
const { DEVOPS_PARAMS } = await import("../../src/lib/control/devops/params");
const D = await import("../agent/devops");

/* ───────── unit: tekshiruvlar ───────── */
section("validateAction / DEVOPS_PARAMS");
check("DEPLOY {} → ref main", (() => { const v = P.validateAction("DEPLOY", {}); return v.ok && v.params.ref === "main"; })());
check("DEPLOY sha → ok", P.validateAction("DEPLOY", { ref: "abc1234" }).ok && P.validateAction("DEPLOY", { ref: "a".repeat(40) }).ok);
for (const bad of ["v1.0", "abc12", "ABC1234", "main; rm -rf /", "origin/main", "-x", "a".repeat(41), 5]) {
  check(`DEPLOY ref ${JSON.stringify(bad)} → rad`, !P.validateAction("DEPLOY", { ref: bad }).ok);
}
check("ROLLBACK ortiqcha parametrlar tashlanadi", (() => { const v = P.validateAction("ROLLBACK", { x: "rm" }); return v.ok && Object.keys(v.params).length === 0; })());
check("LOG_TAIL insof-erp@alfa 200 → ok", P.validateAction("LOG_TAIL", { source: "insof-erp@alfa", lines: "200" }).ok);
check("LOG_TAIL fayl manbalari → ok", Object.keys(C.LOG_FILES).every((s) => P.validateAction("LOG_TAIL", { source: s, lines: 10 }).ok));
for (const bad of ["sshd", "/etc/shadow", "../x", "insof-erp@A", "postgresql", "nginx-error.log"]) {
  check(`LOG_TAIL manba ${bad} → rad`, !P.validateAction("LOG_TAIL", { source: bad, lines: 10 }).ok);
}
check("LOG_TAIL lines 0 / 501 / 'x' → rad", ![0, 501, "x"].some((l) => P.validateAction("LOG_TAIL", { source: "nginx", lines: l }).ok));
check("LOG_TAIL filtr boshqaruv belgisi → rad", !P.validateAction("LOG_TAIL", { source: "nginx", lines: 5, filter: "a\nb" }).ok);
check("LOG_TAIL filtr > 100 → rad", !P.validateAction("LOG_TAIL", { source: "nginx", lines: 5, filter: "x".repeat(101) }).ok);
check("LOG_TAIL daraja noma'lum → rad", !P.validateAction("LOG_TAIL", { source: "nginx", lines: 5, priority: "verbose" }).ok);
check("LOG_TAIL daraja err → ok", P.validateAction("LOG_TAIL", { source: "nginx", lines: 5, priority: "err" }).ok);
check("zod DEPLOY {ref:'main'} ok, {} rad", DEVOPS_PARAMS.DEPLOY.safeParse({ ref: "main" }).success && !DEVOPS_PARAMS.DEPLOY.safeParse({}).success);
check("zod LOG_TAIL to'liq ok", DEVOPS_PARAMS.LOG_TAIL.safeParse({ source: "deploy", lines: "100", filter: "", priority: "" }).success);
check("zod LOG_TAIL ortiqcha kalit rad", !DEVOPS_PARAMS.LOG_TAIL.safeParse({ source: "deploy", lines: "100", filter: "", priority: "", cmd: "x" }).success);
check("sameSha qisqa/uzun", C.sameSha("abcdef123456", "abcdef1234567890abcd") && !C.sameSha("abcdef1", "abcdef2"));

/* ───────── soxta control ───────── */
type Row = { id: string; type: string; status: string; output: string | null; finishedAt: Date | null; startedAt: Date | null };
const actions = new Map<string, Row>();
const checks = new Map<string, Record<string, unknown>>();
const matches = (r: Row, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => {
  if (k === "id" || k === "status") return typeof v === "object" && v && "in" in v ? (v as { in: string[] }).in.includes(r[k]) : r[k] === v;
  if (k === "type") return typeof v === "object" && v && "in" in v ? (v as { in: string[] }).in.includes(r.type) : r.type === v;
  return true; // startedAt/finishedAt/NOT — sinovda ahamiyatsiz
});
const fakeControl = {
  agentAction: {
    findUnique: async ({ where }: { where: { id: string } }) => actions.get(where.id) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => [...actions.values()].filter((r) => matches(r, where) && r.startedAt && Date.now() - r.startedAt.getTime() > 120_000),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      let count = 0;
      for (const r of actions.values()) if (matches(r, where)) { Object.assign(r, data); count++; }
      return { count };
    },
  },
  serviceCheck: {
    findUnique: async ({ where }: { where: { key: string } }) => checks.get(where.key) ?? null,
    upsert: async ({ where, create, update }: { where: { key: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      checks.set(where.key, { ...(checks.get(where.key) ?? create), ...update });
    },
  },
};
let selfRestart = "";
D.initDevops({
  control: fakeControl as never, appDir: APP, linux: false, test: false,
  childEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: os.homedir(), LANG: "C.UTF-8" },
  hasSystemd: async () => false, releaseVersion: () => "000000000000",
  log: () => {}, warn: (m) => console.log(`    (warn) ${m}`), requestSelfRestart: (r) => { selfRestart = r; },
});

/* ───────── git repo + origin ───────── */
const ORIGIN = path.join(TMP, "origin.git");
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "QA", GIT_AUTHOR_EMAIL: "qa@x", GIT_COMMITTER_NAME: "QA", GIT_COMMITTER_EMAIL: "qa@x" } }).trim();
execFileSync("git", ["init", "-q", "--bare", "-b", "main", ORIGIN]);
g(APP, "init", "-q", "-b", "main");
writeFileSync(path.join(APP, "a.txt"), "1");
g(APP, "add", "a.txt"); g(APP, "commit", "-q", "-m", "birinchi reliz");
const SHA1 = g(APP, "rev-parse", "HEAD");
g(APP, "remote", "add", "origin", ORIGIN);
g(APP, "push", "-q", "origin", "main");
// origin'da yana 2 commit (boshqa klon orqali)
const CL = path.join(TMP, "clone");
execFileSync("git", ["clone", "-q", ORIGIN, CL]);
for (const m of ["ikkinchi: token=SUPERSECRET123 qo'shildi", "uchinchi"]) { writeFileSync(path.join(CL, "a.txt"), m); g(CL, "commit", "-qam", m); g(CL, "push", "-q", "origin", "main"); }
const SHA3 = g(CL, "rev-parse", "HEAD");
mkdirSync(path.join(APP, "releases", SHA1, ".next"), { recursive: true });
writeFileSync(path.join(APP, "releases", SHA1, "RELEASE"), SHA1);
writeFileSync(path.join(APP, "releases", SHA1, ".next", "BUILD_ID"), "x");
symlinkSync(path.join(APP, "releases", SHA1), path.join(APP, "current"));

section("relizlar holati (git fetch → release:info)");
{
  const info = await D.collectReleaseInfo(true);
  check("current = SHA1", info.current === SHA1, info.current);
  check("RELEASE fayli o'qildi", info.releaseFile === SHA1);
  check("git fetch o'tdi", !!info.fetchedAt && !info.fetchError, info.fetchError);
  check("origin/main = SHA3", info.originMain === SHA3, info.originMain);
  check("ahead = 2, commitlar 2 ta (eng yangisi birinchi)", info.ahead === 2 && info.commits.length === 2 && info.commits[0].subject === "uchinchi", info.commits);
  check("releases ro'yxati: 1 ta, joriy, build bor, xabar", info.releases.length === 1 && info.releases[0].current && info.releases[0].built && info.releases[0].subject === "birinchi reliz", info.releases);
  await D.refreshRelease(true);
  const row = checks.get(C.RELEASE_CHECK_KEY) as { data: { commits: { subject: string }[] }; status: string } | undefined;
  check("ServiceCheck release:info yozildi (OK)", row?.status === "OK", row);
  check("commit xabaridagi sir yashirildi", !!row && !JSON.stringify(row.data).includes("SUPERSECRET123"), row?.data.commits);
}

/* ───────── DEPLOY (detached) ───────── */
const SCRIPT = path.join(APP, "scripts", "deploy.sh");
function fakeDeploy(body: string) { writeFileSync(SCRIPT, `#!/usr/bin/env bash\nset -e\n${body}\n`); }
async function waitDone(id: string, ms = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await D.devopsTick();
    if (actions.get(id)?.status !== "RUNNING") return actions.get(id)!;
    await sleep(300);
  }
  return actions.get(id)!;
}
const newAction = (id: string, type: string) => { const r: Row = { id, type, status: "RUNNING", output: null, finishedAt: null, startedAt: new Date() }; actions.set(id, r); return r; };

section("DEPLOY: muvaffaqiyatli (detached)");
{
  fakeDeploy(`echo "▶ build ref=$DEPLOY_REF rollback=\${ROLLBACK:-0} skip_agent=\${SKIP_AGENT_RESTART:-0}"
echo "DATABASE_URL=postgresql://u:parol123@localhost/db"
printf '\\033[1;32m✓ rangli\\033[0m\\n'
sleep 1
ln -sfn "$APP_DIR/releases/${SHA3}" "$APP_DIR/current.new"; mkdir -p "$APP_DIR/releases/${SHA3}"; echo ${SHA3} > "$APP_DIR/releases/${SHA3}/RELEASE"
perl -e 'rename($ARGV[0],$ARGV[1])' "$APP_DIR/current.new" "$APP_DIR/current"
echo "✓ Deploy tugadi"`);
  const id = "cdeploy0000000001";
  newAction(id, "DEPLOY");
  const out = await D.devopsExecute(id, "DEPLOY", { ref: "main" });
  check("RUNNING qaytdi (detached)", out.status === "RUNNING" && /detached/.test(out.output), out);
  check("holat fayli yozildi", existsSync(path.join(APP, ".deploy-state.json")));
  // ikkinchi deploy shu payt — rad
  newAction("cdeploy0000000002", "DEPLOY");
  const second = await D.devopsExecute("cdeploy0000000002", "DEPLOY", { ref: "main" });
  check("bir vaqtda ikkinchi deploy → FAILED", second.status === "FAILED" && /Boshqa/.test(second.output), second);
  actions.get("cdeploy0000000002")!.status = "FAILED";
  await sleep(400); await D.devopsTick();
  check("jonli chiqish yangilanmoqda", /bajarilmoqda/.test(actions.get(id)?.output ?? "") || actions.get(id)?.status === "DONE", actions.get(id)?.output);
  const r = await waitDone(id);
  check("DONE", r.status === "DONE", r);
  check("natijada DEPLOY_REF=origin/main va SKIP_AGENT_RESTART=1", /ref=origin\/main/.test(r.output ?? "") && /skip_agent=1/.test(r.output ?? ""), r.output);
  check("reliz o'tishi ko'rsatildi (SHA1 → SHA3)", (r.output ?? "").includes(`${SHA1.slice(0, 12)} → ${SHA3.slice(0, 12)}`), r.output);
  check("ANSI ranglari tozalangan", !(r.output ?? "").includes("\x1b["));
  check("parol yashirilgan", !(r.output ?? "").includes("parol123"), r.output);
  check("holat fayli o'chirildi", !existsSync(path.join(APP, ".deploy-state.json")));
  check("detached: agent o'zini qayta ishga tushirishni so'radi", /yangi reliz/.test(selfRestart), selfRestart);
  check("logda BEGIN/END chegaralari", readFileSync(LOG, "utf8").includes(`${C.DEPLOY_MARK.end} ${id} 0`));
}

section("ROLLBACK: xato (exit 1)");
{
  selfRestart = "";
  fakeDeploy(`echo "rollback=\${ROLLBACK:-0}"; echo "✗ Qaytish uchun boshqa reliz yo'q" >&2; exit 1`);
  const id = "crollback00000001";
  newAction(id, "ROLLBACK");
  const out = await D.devopsExecute(id, "ROLLBACK", {});
  check("RUNNING", out.status === "RUNNING", out);
  const r = await waitDone(id);
  check("FAILED, chiqish kodi 1, stderr logda", r.status === "FAILED" && /chiqish kodi 1/.test(r.output ?? "") && /rollback=1/.test(r.output ?? "") && /boshqa reliz yo'q/.test(r.output ?? ""), r.output);
  check("rollback xatosidan keyin agent qayta ishga tushmaydi", selfRestart === "");
}

section("DEPLOY: jarayon kutilmaganda o'ldi");
{
  fakeDeploy(`echo start; sleep 30`);
  const id = "ckilled0000000001";
  newAction(id, "DEPLOY");
  const out = await D.devopsExecute(id, "DEPLOY", { ref: "abc1234" });
  const st = JSON.parse(readFileSync(path.join(APP, ".deploy-state.json"), "utf8")) as { pid: number };
  check("RUNNING, pid bor", out.status === "RUNNING" && st.pid > 0, out);
  await sleep(300);
  process.kill(-st.pid, "SIGKILL");
  const r = await waitDone(id);
  check("FAILED «kutilmaganda to'xtadi»", r.status === "FAILED" && /kutilmaganda/.test(r.output ?? ""), r.output);
}

section("DEPLOY va ROLLBACK parallel: holat fayli atomar (O_EXCL)");
{
  fakeDeploy(`echo "parallel $\{ROLLBACK:-0}"; sleep 2`);
  const a = "cparallel00000001", b = "cparallel00000002";
  newAction(a, "DEPLOY"); newAction(b, "ROLLBACK");
  const [ra, rb] = await Promise.all([D.devopsExecute(a, "DEPLOY", { ref: "main" }), D.devopsExecute(b, "ROLLBACK", {})]);
  const running = [ra, rb].filter((r) => r.status === "RUNNING");
  check("bir vaqtda ikkalasi so'raldi → faqat bittasi RUNNING, ikkinchisi FAILED", running.length === 1 && [ra, rb].some((r) => r.status === "FAILED" && /Boshqa/.test(r.output)), { ra, rb });
  const winner = ra.status === "RUNNING" ? a : b;
  const loser = winner === a ? b : a;
  actions.get(loser)!.status = "FAILED";
  const st = JSON.parse(readFileSync(path.join(APP, ".deploy-state.json"), "utf8")) as { actionId: string; mode: string };
  check("holat fayli g'olibniki, rejim detached", st.actionId === winner && st.mode === "detached", st);
  const busy = await D.deployBusy(APP);
  check("deployBusy: ketayotganda — sabab matni", !!busy && busy.includes(winner), busy);
  const r = await waitDone(winner);
  check("g'olib yakunlandi (DONE)", r.status === "DONE", r);
  check("deployBusy: tugagach — null", (await D.deployBusy(APP)) === null);
  // Buzuq (o'qib bo'lmaydigan) holat fayli: yangisi — band, eskisi — tozalanib deploy boshlanadi
  writeFileSync(path.join(APP, ".deploy-state.json"), "");
  check("deployBusy: bo'sh/yozilayotgan holat fayli (yangi) → band", !!(await D.deployBusy(APP)));
  newAction("cparallel00000003", "DEPLOY");
  const c1 = await D.devopsExecute("cparallel00000003", "DEPLOY", { ref: "main" });
  check("yangi buzuq holat fayli → FAILED «boshlanmoqda»", c1.status === "FAILED" && /boshlanmoqda/.test(c1.output), c1);
  const old = new Date(Date.now() - 10 * 60_000);
  utimesSync(path.join(APP, ".deploy-state.json"), old, old);
  const c2 = await D.devopsExecute("cparallel00000003", "DEPLOY", { ref: "main" });
  check("eski buzuq holat fayli tozalanadi → RUNNING", c2.status === "RUNNING", c2);
  check("yakunlandi", (await waitDone("cparallel00000003")).status === "DONE");
  // Ishga tushirish xato bo'lsa band qilish bekor qilinadi (holat fayli qolmaydi)
  const saved = readFileSync(SCRIPT, "utf8");
  rmSync(SCRIPT);
  newAction("cparallel00000004", "DEPLOY");
  const c3 = await D.devopsExecute("cparallel00000004", "DEPLOY", { ref: "main" });
  check("deploy.sh yo'q → FAILED va holat fayli o'chirildi", c3.status === "FAILED" && !existsSync(path.join(APP, ".deploy-state.json")), c3);
  actions.get("cparallel00000004")!.status = "FAILED";
  writeFileSync(SCRIPT, saved);
}

section("deploy.sh: DEPLOY_REF faqat origin/main tarixidan");
{
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const APP2 = path.join(TMP, "app2");
  mkdirSync(path.join(APP2, "releases", SHA3, ".next"), { recursive: true });
  writeFileSync(path.join(APP2, "control.env"), "");
  writeFileSync(path.join(APP2, "releases", SHA3, "RELEASE"), SHA3);
  writeFileSync(path.join(APP2, "releases", SHA3, ".next", "BUILD_ID"), "x");
  // origin/main da yo'q commit (HEAD ko'chirilmaydi): commit-tree
  const stray = g(APP, "commit-tree", `${SHA1}^{tree}`, "-p", SHA1, "-m", "ko'rib chiqilmagan shoxcha");
  const runDeploy = (env: Record<string, string>) => spawnSync("/bin/bash", [path.join(REPO, "scripts/deploy.sh")], {
    encoding: "utf8", timeout: 60_000,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: os.homedir(), APP_DIR: APP2, REPO_DIR: APP, DEPLOY_LOCK: path.join(APP2, ".deploy.lock"), SKIP_ECO: "1", ...env },
  });
  const bad = runDeploy({ DRY_RUN: "1", DEPLOY_REF: stray });
  const badOut = `${bad.stdout}${bad.stderr}`;
  check("origin/main da yo'q sha → to'xtadi, aniq xabar", bad.status !== 0 && badOut.includes("origin/main tarixida yo'q") && !badOut.includes("build →"), badOut.slice(-600));
  check("build boshlanmadi (releases/<sha>.tmp yo'q)", !existsSync(path.join(APP2, "releases", `${stray}.tmp`)));
  const good = runDeploy({ DRY_RUN: "1", DEPLOY_REF: SHA3 });
  const goodOut = `${good.stdout}${good.stderr}`;
  check("origin/main dagi sha → tekshiruvdan o'tdi (mavjud reliz qayta ishlatiladi)", !goodOut.includes("tarixida yo'q") && goodOut.includes("allaqachon build qilingan"), goodOut.slice(-600));
  const prodBase = runDeploy({ SKIP_PULL: "1", DEPLOY_REF: SHA3, DEPLOY_REF_BASE: "HEAD" });
  check("prodda DEPLOY_REF_BASE → rad", prodBase.status !== 0 && `${prodBase.stdout}${prodBase.stderr}`.includes("DEPLOY_REF_BASE faqat DRY_RUN"), `${prodBase.stdout}${prodBase.stderr}`.slice(-400));
  const dryBase = runDeploy({ DRY_RUN: "1", DEPLOY_REF: stray, DEPLOY_REF_BASE: stray });
  check("DRY_RUN: DEPLOY_REF_BASE bilan sinov bazasi almashtiriladi", !`${dryBase.stdout}${dryBase.stderr}`.includes("tarixida yo'q"), `${dryBase.stdout}${dryBase.stderr}`.slice(-400));
  rmSync(path.join(APP2, "releases", `${stray}.tmp`), { recursive: true, force: true });
}

section("DEPLOY: log faylga yozib bo'lmaydi");
{
  process.env.AGENT_DEPLOY_LOG = path.join(TMP, "yoq", "log");
  D.initDevops({ control: fakeControl as never, appDir: APP, linux: false, test: false, childEnv: { PATH: process.env.PATH ?? "" }, hasSystemd: async () => false, releaseVersion: () => null, log: () => {}, warn: () => {}, requestSelfRestart: () => {} });
  const out = await D.devopsExecute("cnolog00000000001", "DEPLOY", { ref: "main" });
  check("FAILED + o'rnatish ko'rsatmasi", out.status === "FAILED" && /sudo install -o deploy/.test(out.output), out);
  process.env.AGENT_DEPLOY_LOG = LOG;
  D.initDevops({ control: fakeControl as never, appDir: APP, linux: false, test: true, childEnv: { PATH: process.env.PATH ?? "" }, hasSystemd: async () => false, releaseVersion: () => null, log: () => {}, warn: () => {}, requestSelfRestart: () => {} });
  const t = await D.devopsExecute("ctestmode00000001", "DEPLOY", { ref: "main" });
  check("test rejimida DEPLOY → FAILED", t.status === "FAILED" && /test-mode/.test(t.output), t);
}

section("LOG_TAIL");
{
  const lt = await D.logTail({ source: "deploy", lines: 3 });
  const body = lt.output.split("\n");
  check("deploy log: DONE, sarlavha + 3 qator", lt.status === "DONE" && body.length === 4 && lt.limit === C.LOG_MAX_BYTES, lt.output);
  const f = await D.logTail({ source: "deploy", lines: 500, filter: "RANGLI" });
  check("filtr (katta-kichik harfsiz, oddiy matn)", f.status === "DONE" && f.output.split("\n").length === 2 && /rangli/.test(f.output), f.output);
  const rx = await D.logTail({ source: "deploy", lines: 500, filter: ".*" });
  check("filtr regex emas («.*» → 0 qator)", rx.output.split("\n").length === 2 && /mos qator yo'q/.test(rx.output), rx.output);
  const sec = P.trimOutput((await D.logTail({ source: "deploy", lines: 500 })).output, C.LOG_MAX_BYTES);
  check("chiqishda parol yashirilgan (trimOutput)", !sec.includes("parol123") && sec.includes("***"));
  // Filtr sir «oracle»i bo'lmasin: filtr tozalangan qatorlarga qo'llanadi — sir qiymati bo'yicha qidiruv hech narsa topmaydi
  const orc = await D.logTail({ source: "deploy", lines: 500, filter: "parol123" });
  check("filtr sir qiymati bilan («parol123») → 0 qator", /mos qator yo'q/.test(orc.output) && orc.output.split("\n").length === 2, orc.output);
  const orc2 = await D.logTail({ source: "deploy", lines: 500, filter: "u:par" });
  check("filtr sir boshlanishi bilan («u:par») → 0 qator", /mos qator yo'q/.test(orc2.output), orc2.output);
  const byKey = await D.logTail({ source: "deploy", lines: 500, filter: "DATABASE_URL" });
  check("filtr kalit nomi bilan → qator topiladi, qiymat yashirin", /DATABASE_URL/.test(byKey.output) && byKey.output.includes("***") && !byKey.output.includes("parol123"), byKey.output);
  const u = await D.logTail({ source: "insof-control", lines: 10 });
  check("macOS: journald unit → FAILED (journalctl yo'q)", u.status === "FAILED", u);
  const nf = await D.logTail({ source: "restore-test", lines: 10 });
  check("yo'q fayl → FAILED ENOENT", nf.status === "FAILED" && /ENOENT/.test(nf.output), nf);
  const big = path.join(TMP, "big.log");
  writeFileSync(big, Array.from({ length: 20000 }, (_, i) => `qator ${i} ${"x".repeat(30)}`).join("\n"));
  process.env.AGENT_DEPLOY_LOG = big;
  D.initDevops({ control: fakeControl as never, appDir: APP, linux: false, test: false, childEnv: { PATH: process.env.PATH ?? "" }, hasSystemd: async () => false, releaseVersion: () => null, log: () => {}, warn: () => {}, requestSelfRestart: () => {} });
  const b = await D.logTail({ source: "deploy", lines: 500 });
  const trimmed = P.trimOutput(b.output, C.LOG_MAX_BYTES);
  check("katta log: ≤ 500 qator, oxirgisi «qator 19999», ≤ 64 KB", b.output.split("\n").length === 501 && b.output.endsWith(`qator 19999 ${"x".repeat(30)}`) && Buffer.byteLength(trimmed) <= C.LOG_MAX_BYTES + 64);
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${ok} o'tdi, ${fail} xato\x1b[0m`);
process.exit(fail ? 1 : 0);
