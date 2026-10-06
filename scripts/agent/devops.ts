/**
 * insof-agent: DevOps amallari — relizlar (DEPLOY, ROLLBACK), relizlar holati (git fetch → ServiceCheck release:info)
 * va loglar (LOG_TAIL). scripts/insof-agent.ts dan chaqiriladi (initDevops, devopsExecute, devopsTick).
 *
 * DEPLOY/ROLLBACK agent jarayonidan AJRATILADI, chunki deploy.sh oxirida insof-agent ni qayta ishga tushiradi
 * (systemd KillMode=mixed agent cgroup'idagi barcha bolalarni ham o'ldiradi):
 *   1) `systemd-run --user` (deploy foydalanuvchisining user manager'i, `loginctl enable-linger deploy` kerak) — deploy
 *      agent cgroup'idan tashqarida, uning MemoryMax/CPUQuota cheklovlarisiz ishlaydi; agent qayta ishga tushsa ham davom etadi.
 *   2) bo'lmasa — detached bola jarayon (setsid) + SKIP_AGENT_RESTART=1: deploy.sh agentni qayta ishga tushirmaydi,
 *      agent natijani yozib, yangi relizdan ishlash uchun O'ZI chiqadi (systemd Restart=always). Bu rejimda build
 *      agentning MemoryMax=400M chegarasiga urilishi mumkin — PLATFORMA.md → «Relizlar paneli».
 * Chiqish /var/log/insof-deploy.log ga (AGENT_DEPLOY_LOG); boshida/oxirida chegara qatorlari (DEPLOY_MARK) — agentning
 * keyingi nusxasi natijani (exit kodi) shu log va current/RELEASE bo'yicha yakunlaydi. Holat: $APP_DIR/.deploy-state.json.
 * Bir vaqtda bitta deploy: deploy.sh dagi flock ($APP_DIR/.deploy.lock) + bu yerda holat fayli va flock tekshiruvi.
 *
 * Hamma buyruqlar shell'siz (spawn, argv massiv, to'liq yo'l). Yagona `bash -c` — O'ZGARMAS o'ram matni; foydalanuvchi
 * qiymatlari unga faqat pozitsion argument sifatida (actionId — cuid, skript yo'li — APP_DIR dan) beriladi.
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { access, constants, open, readFile, readdir, readlink, realpath, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma, PrismaClient } from "@/generated/control";
import { scrubSecrets, trimOutput } from "@/lib/control/monitor/parse";
import {
  DEPLOY_MARK, DETACHED_ACTIONS, LOG_FILES, LOG_MAX_BYTES, LOG_MAX_LINES, LOG_PRIORITIES, LOG_UNIT_RE, RELEASE_CHECK_KEY,
  isLogFile, isLogPriority, type DevopsAction, type DevopsParams, type ReleaseCommit, type ReleaseDir, type ReleaseInfo,
} from "@/lib/control/devops/contract";

export type DevopsOutcome = { status: "DONE" | "FAILED" | "REJECTED" | "RUNNING"; output: string; limit?: number };

export type DevopsCtx = {
  control: PrismaClient;
  appDir: string;
  linux: boolean;
  test: boolean;
  childEnv: Record<string, string>;
  hasSystemd: () => Promise<boolean>;
  releaseVersion: () => string | null;
  log: (m: string) => void;
  warn: (m: string) => void;
  /** detached rejimda deploy tugagach: agent chiqadi, systemd uni yangi relizdan qayta ishga tushiradi. */
  requestSelfRestart: (reason: string) => void;
};

let ctx!: DevopsCtx;
let P!: ReturnType<typeof paths>;

function paths(appDir: string) {
  return {
    script: path.join(appDir, "scripts", "deploy.sh"),
    state: path.join(appDir, ".deploy-state.json"),
    lock: process.env.DEPLOY_LOCK || path.join(appDir, ".deploy.lock"),
    releases: process.env.RELEASES_DIR || path.join(appDir, "releases"),
    current: process.env.CURRENT_LINK || path.join(appDir, "current"),
    repo: process.env.AGENT_REPO_DIR || appDir,
    deployLog: process.env.AGENT_DEPLOY_LOG || LOG_FILES.deploy.path,
    npmCache: path.join(process.env.INSOF_SECURITY_CACHE_DIR || "/var/cache/insof-agent", "npm"),
  };
}

const firstExisting = (list: string[]) => list.find((p) => existsSync(p)) ?? list[0];
const BIN = {
  bash: "/bin/bash",
  systemdRun: "/usr/bin/systemd-run",
  systemctl: "/usr/bin/systemctl",
  journalctl: "/usr/bin/journalctl",
  flock: "/usr/bin/flock",
  git: firstExisting(["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"]),
};

const DEPLOY_TIMEOUT_MS = Number(process.env.AGENT_DEPLOY_TIMEOUT_MS) >= 60_000 ? Number(process.env.AGENT_DEPLOY_TIMEOUT_MS) : 90 * 60_000;
const RELEASE_EVERY_MS = 5 * 60_000;
const ORPHAN_AFTER_MS = 2 * 60_000;
const DEPLOY_OUTPUT_LIMIT = 16 * 1024;
const ID_RE = /^[a-z0-9]{10,40}$/i;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/**
 * Ajratilgan deploy o'rami — O'ZGARMAS matn. $1 = actionId, $2 = deploy.sh yo'li. Exit kodi END qatorida.
 */
const WRAPPER = [
  'ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }',
  `printf '\\n%s %s %s\\n' "${DEPLOY_MARK.begin}" "$1" "$(ts)"`,
  '/bin/bash "$2"; rc=$?',
  `printf '%s %s %s %s\\n' "${DEPLOY_MARK.end}" "$1" "$rc" "$(ts)"`,
  'exit "$rc"',
].join("\n");

export function initDevops(c: DevopsCtx) {
  ctx = c;
  P = paths(c.appDir);
}

/* ───────────────────────── Yordamchilar ───────────────────────── */

type Exec = { code: number | null; out: string; err: string; timedOut: boolean; missing: boolean };

/** Shell'siz buyruq; stdout (maxBytes gacha, oxiri saqlanadi) va stderr alohida. */
function exec(file: string, args: string[], opt: { timeoutMs: number; cwd?: string; env?: Record<string, string>; maxBytes?: number }): Promise<Exec> {
  const max = opt.maxBytes ?? 1024 * 1024;
  return new Promise((resolve) => {
    let out = "", err = "", timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, { cwd: opt.cwd, env: (opt.env ?? ctx.childEnv) as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], shell: false });
    } catch (e) {
      resolve({ code: null, out: "", err: (e as Error).message, timedOut: false, missing: true });
      return;
    }
    child.stdout?.on("data", (b: Buffer) => { out += b.toString("utf8"); if (out.length > max) out = out.slice(-max); });
    child.stderr?.on("data", (b: Buffer) => { err += b.toString("utf8"); if (err.length > 16384) err = err.slice(-16384); });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 3000).unref(); }, opt.timeoutMs);
    child.on("error", (e: NodeJS.ErrnoException) => { clearTimeout(timer); resolve({ code: null, out, err: err + e.message, timedOut, missing: e.code === "ENOENT" }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err, timedOut, missing: false }); });
  });
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);
/** ANSI ranglari va boshqaruv belgilari (tab va yangi qatordan tashqari) olib tashlanadi. */
export const cleanText = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

/** Faylning oxirgi maxBytes qismi (katta log to'liq o'qilmaydi); fromOffset — shu joydan oldingisi kerak emas. */
async function readTail(file: string, maxBytes: number, fromOffset = 0): Promise<{ text: string; size: number; partial: boolean }> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const start = Math.max(fromOffset > size ? 0 : fromOffset, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    if (len > 0) await fh.read(buf, 0, len, start);
    let text = buf.toString("utf8");
    const partial = start > fromOffset;
    if (partial) text = text.slice(text.indexOf("\n") + 1); // birinchi chala qator
    return { text, size, partial };
  } finally { await fh.close(); }
}

/** systemd --user uchun muhit (user manager D-Bus soketi). */
function userEnv(): Record<string, string> {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const rt = `/run/user/${uid}`;
  return { ...ctx.childEnv, XDG_RUNTIME_DIR: rt, DBUS_SESSION_BUS_ADDRESS: `unix:path=${rt}/bus` };
}

/* ───────────────────────── Holat fayli ───────────────────────── */

type DeployState = {
  actionId: string; type: "DEPLOY" | "ROLLBACK"; ref: string | null;
  mode: "systemd-run" | "detached"; unit: string | null; pid: number | null;
  logPath: string; offset: number; startedAt: string; prev: string | null; agentRelease: string | null;
};

async function readState(): Promise<DeployState | null> {
  try {
    const s = JSON.parse(await readFile(P.state, "utf8")) as DeployState;
    return s && typeof s.actionId === "string" && ID_RE.test(s.actionId) ? s : null;
  } catch { return null; }
}
const clearState = () => unlink(P.state).catch(() => {});

async function currentRelease(): Promise<{ sha: string | null; file: string | null }> {
  let sha: string | null = null;
  try { sha = path.basename(await realpath(P.current)); } catch {
    try { sha = path.basename(await readlink(P.current)); } catch { /* yo'q */ }
  }
  let file: string | null = null;
  try { file = (await readFile(path.join(P.current, "RELEASE"), "utf8")).trim() || null; } catch { /* yo'q */ }
  return { sha: sha && SHA_RE.test(sha) ? sha : file && SHA_RE.test(file) ? file : sha, file };
}

/** Deploy qulfi band-mi (deploy.sh ichidagi flock). flock yo'q bo'lsa — null (noma'lum). */
async function lockBusy(): Promise<boolean | null> {
  if (!existsSync(BIN.flock)) return null;
  const r = await exec(BIN.flock, ["-n", "-E", "75", P.lock, "/bin/true"], { timeoutMs: 5000 });
  return r.code === 75 ? true : r.code === 0 ? false : null;
}

/* ───────────────────────── DEPLOY / ROLLBACK: ishga tushirish ───────────────────────── */

async function startDetached(actionId: string, type: "DEPLOY" | "ROLLBACK", ref: string | null): Promise<DevopsOutcome> {
  if (ctx.test) return { status: "FAILED", output: `[test-mode] ${type} test rejimida bajarilmaydi` };
  if (!ID_RE.test(actionId)) return { status: "REJECTED", output: "amal id noto'g'ri" };

  const prevState = await readState();
  if (prevState && prevState.actionId !== actionId) {
    const other = await ctx.control.agentAction.findUnique({ where: { id: prevState.actionId }, select: { status: true } });
    if (other?.status === "RUNNING") return { status: "FAILED", output: `Boshqa ${prevState.type} hozir ishlayapti (amal ${prevState.actionId}) — tugashini kuting` };
    await clearState();
  }
  if ((await lockBusy()) === true) return { status: "FAILED", output: `Deploy qulfi band (${P.lock}) — serverda boshqa deploy (qo'lda?) ishlayapti` };
  if (!existsSync(P.script)) return { status: "FAILED", output: `${P.script} topilmadi` };

  // Log fayli deploy foydalanuvchisiga yoziladigan bo'lsin (root yaratadi — PLATFORMA.md)
  let offset = 0;
  try {
    await access(P.deployLog, constants.W_OK);
    offset = (await stat(P.deployLog)).size;
  } catch {
    return { status: "FAILED", output: `${P.deployLog} ga yozib bo'lmaydi. Serverda bir marta:\n  sudo install -o deploy -g deploy -m 640 /dev/null ${P.deployLog}` };
  }

  const prev = (await currentRelease()).sha;
  const env: Record<string, string> = { ...ctx.childEnv, APP_DIR: ctx.appDir, TERM: "dumb" };
  if (type === "ROLLBACK") env.ROLLBACK = "1";
  else env.DEPLOY_REF = ref && ref !== "main" ? ref : "origin/main";
  const wrapperArgs = ["-c", WRAPPER, "insof-deploy", actionId, P.script];
  const notes: string[] = [];

  // 1) systemd-run --user — agent cgroup'idan tashqarida
  if (ctx.linux && (await ctx.hasSystemd()) && existsSync(BIN.systemdRun) && process.env.AGENT_DEPLOY_MODE !== "detached") {
    const unit = `insof-deploy-${actionId.slice(-12).toLowerCase()}`;
    const r = await exec(BIN.systemdRun, [
      "--user", "--quiet", "--collect", `--unit=${unit}`, `--description=Insof ${type} (${actionId})`,
      "-p", `StandardOutput=append:${P.deployLog}`, "-p", `StandardError=append:${P.deployLog}`,
      "-p", `WorkingDirectory=${ctx.appDir}`,
      ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`),
      BIN.bash, ...wrapperArgs,
    ], { timeoutMs: 30_000, env: userEnv() });
    if (r.code === 0) {
      await writeState({ actionId, type, ref, mode: "systemd-run", unit, pid: null, logPath: P.deployLog, offset, startedAt: new Date().toISOString(), prev, agentRelease: ctx.releaseVersion() });
      ctx.log(`${type} boshlandi: systemd-run --user ${unit}`);
      return { status: "RUNNING", output: `${type}${ref ? ` ${ref}` : ""} boshlandi — systemd-run --user (${unit}), log: ${P.deployLog}\nJoriy reliz: ${prev ?? "—"}` };
    }
    notes.push(`systemd-run --user ishlamadi (${(r.err || r.out).trim().split("\n")[0].slice(0, 200) || `kod ${r.code}`}) — detached rejim. Tavsiya: sudo loginctl enable-linger deploy`);
  }

  // 2) detached bola jarayon: o'z sessiyasi (setsid), chiqish logga; agentni deploy.sh emas, agent o'zi qayta ishga tushiradi
  const denv = { ...env, SKIP_AGENT_RESTART: "1", npm_config_cache: P.npmCache };
  let fd: number | null = null;
  try {
    fd = openSync(P.deployLog, "a");
    const child = spawn(BIN.bash, wrapperArgs, { cwd: ctx.appDir, env: denv as unknown as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", fd, fd], shell: false });
    const pid = child.pid ?? null;
    child.on("error", (e) => ctx.warn(`deploy jarayoni: ${errMsg(e)}`));
    child.on("exit", () => { void devopsTick(); });
    child.unref();
    if (!pid) return { status: "FAILED", output: `${notes.join("\n")}\ndeploy jarayoni ishga tushmadi` };
    await writeState({ actionId, type, ref, mode: "detached", unit: null, pid, logPath: P.deployLog, offset, startedAt: new Date().toISOString(), prev, agentRelease: ctx.releaseVersion() });
    ctx.log(`${type} boshlandi: detached pid ${pid}`);
    return { status: "RUNNING", output: [...notes, `${type}${ref ? ` ${ref}` : ""} boshlandi — detached (pid ${pid}), log: ${P.deployLog}`, `Joriy reliz: ${prev ?? "—"}`].join("\n") };
  } catch (e) {
    return { status: "FAILED", output: `${notes.join("\n")}\ndeploy jarayoni ishga tushmadi: ${errMsg(e)}` };
  } finally {
    if (fd != null) closeSync(fd);
  }
}

async function writeState(s: DeployState) {
  await writeFile(P.state, JSON.stringify(s, null, 2), { mode: 0o600 });
}

/* ───────────────────────── DEPLOY: kuzatish va yakunlash ───────────────────────── */

async function deployAlive(s: DeployState): Promise<boolean> {
  if (s.mode === "systemd-run" && s.unit) {
    const r = await exec(BIN.systemctl, ["--user", "is-active", s.unit], { timeoutMs: 10_000, env: userEnv() });
    return /^(active|activating|reloading|deactivating)/.test(r.out.trim());
  }
  if (s.pid) {
    try { process.kill(s.pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
  }
  return false;
}

function endMarker(text: string, id: string): number | null {
  const re = new RegExp(`^${DEPLOY_MARK.end} ${id} (\\d{1,3})\\b`, "m");
  const m = re.exec(text);
  return m ? Number(m[1]) : null;
}

async function logSince(s: DeployState): Promise<{ text: string; size: number }> {
  try {
    const r = await readTail(s.logPath, 256 * 1024, s.offset);
    return { text: cleanText(r.text), size: r.size };
  } catch (e) { return { text: `(log o'qilmadi: ${errMsg(e)})`, size: -1 }; }
}

let lastLogSize = -1;

async function finalize(s: DeployState, rc: number | null, text: string, reason?: string) {
  const cur = await currentRelease();
  const ok = rc === 0;
  const head = [
    `${s.type}${s.ref ? ` ${s.ref}` : ""}: ${ok ? "muvaffaqiyatli" : reason ?? `xato (chiqish kodi ${rc})`}`,
    `Reliz: ${s.prev?.slice(0, 12) ?? "—"} → ${cur.sha?.slice(0, 12) ?? "—"}${cur.file && cur.sha && cur.file !== cur.sha ? ` (RELEASE ${cur.file.slice(0, 12)})` : ""}`,
    `Rejim: ${s.mode}${s.unit ? ` (${s.unit})` : s.pid ? ` (pid ${s.pid})` : ""}; log: ${s.logPath}`,
    "────────",
  ].join("\n");
  await ctx.control.agentAction.updateMany({
    where: { id: s.actionId, status: "RUNNING" },
    data: { status: ok ? "DONE" : "FAILED", finishedAt: new Date(), output: trimOutput(`${head}\n${text}`, DEPLOY_OUTPUT_LIMIT) },
  });
  await clearState();
  lastLogSize = -1;
  ctx.log(`${s.type} yakunlandi: ${ok ? "DONE" : "FAILED"} (${s.actionId})`);
  void refreshRelease(true);
  // detached rejimda deploy.sh agentni qayta ishga tushirmadi — yangi relizdan ishlash uchun agent o'zi chiqadi
  if (s.mode === "detached" && s.type === "DEPLOY" && ok && cur.sha && ctx.releaseVersion() && !cur.sha.startsWith(ctx.releaseVersion()!)) {
    ctx.requestSelfRestart(`deploy tugadi — yangi reliz ${cur.sha.slice(0, 12)}`);
  }
}

async function watchDeploy(): Promise<string> {
  const s = await readState();
  if (!s) return "deploy yo'q";
  const row = await ctx.control.agentAction.findUnique({ where: { id: s.actionId }, select: { status: true } });
  if (!row || row.status !== "RUNNING") { await clearState(); return "eski holat tozalandi"; }

  let { text, size } = await logSince(s);
  let rc = endMarker(text, s.actionId);
  if (rc != null) { await finalize(s, rc, text); return `yakunlandi (${rc})`; }

  if (!(await deployAlive(s))) {
    await new Promise((r) => setTimeout(r, 500));
    ({ text, size } = await logSince(s));
    rc = endMarker(text, s.actionId);
    await finalize(s, rc, text, rc == null ? "deploy jarayoni kutilmaganda to'xtadi (END qatori yo'q) — logni tekshiring" : undefined);
    return "jarayon yo'q — yakunlandi";
  }
  if (Date.now() - Date.parse(s.startedAt) > DEPLOY_TIMEOUT_MS) {
    if (s.mode === "systemd-run" && s.unit) await exec(BIN.systemctl, ["--user", "stop", s.unit], { timeoutMs: 30_000, env: userEnv() });
    else if (s.pid) { try { process.kill(-s.pid, "SIGTERM"); } catch { /* yo'q */ } }
    await finalize(s, null, text, `vaqt tugadi (${Math.round(DEPLOY_TIMEOUT_MS / 60_000)} daqiqa) — to'xtatildi`);
    return "vaqt tugadi";
  }
  // Jonli: log o'zgargan bo'lsa — chiqishni yangilaymiz (panel 2–3 s da so'raydi)
  if (size !== lastLogSize) {
    lastLogSize = size;
    const head = `${s.type}${s.ref ? ` ${s.ref}` : ""}: bajarilmoqda (${s.mode}${s.unit ? `, ${s.unit}` : s.pid ? `, pid ${s.pid}` : ""}), boshlangan ${s.startedAt}\n────────`;
    await ctx.control.agentAction.updateMany({ where: { id: s.actionId, status: "RUNNING" }, data: { output: trimOutput(`${head}\n${text}`, DEPLOY_OUTPUT_LIMIT) } });
  }
  return "bajarilmoqda";
}

/** Holat fayli yo'q RUNNING DEPLOY/ROLLBACK (holat yozilmay qolgan, qo'lda o'chirilgan) — FAILED. */
async function orphans(activeId: string | null) {
  const rows = await ctx.control.agentAction.findMany({
    where: { status: "RUNNING", type: { in: [...DETACHED_ACTIONS] }, startedAt: { lt: new Date(Date.now() - ORPHAN_AFTER_MS) } },
    select: { id: true },
  });
  for (const r of rows) {
    if (r.id === activeId) continue;
    await ctx.control.agentAction.updateMany({ where: { id: r.id, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date(), output: `deploy holati (${P.state}) topilmadi — natija noma'lum. ${LOG_FILES.deploy.label} ni «Loglar» sahifasida tekshiring.` } });
  }
}

/* ───────────────────────── Relizlar holati (ServiceCheck release:info) ───────────────────────── */

let releaseRunning: Promise<void> | null = null;
let releaseAt = 0;

const gitEnv = () => ({ ...ctx.childEnv, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15", LC_ALL: "C" });
const git = (args: string[], timeoutMs = 20_000) => exec(BIN.git, ["-C", P.repo, ...args], { timeoutMs, env: gitEnv(), maxBytes: 256 * 1024 });

export async function collectReleaseInfo(fetch = true): Promise<ReleaseInfo> {
  const cur = await currentRelease();
  const st = await readState();
  const info: ReleaseInfo = {
    current: cur.sha, releaseFile: cur.file, releases: [], originMain: null, ahead: null, commits: [],
    fetchedAt: null, fetchError: null, deployLog: P.deployLog, mode: st?.mode ?? null,
  };
  try {
    const names = (await readdir(P.releases, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.endsWith(".tmp") && SHA_RE.test(d.name));
    const rows: ReleaseDir[] = await Promise.all(names.map(async (d) => {
      const dir = path.join(P.releases, d.name);
      const s = await stat(dir);
      return { sha: d.name, mtime: s.mtime.toISOString(), built: existsSync(path.join(dir, ".next", "BUILD_ID")), current: d.name === cur.sha, subject: null };
    }));
    info.releases = rows.sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, 20);
  } catch { /* releases yo'q */ }

  if (!existsSync(path.join(P.repo, ".git"))) { info.fetchError = `${P.repo} git repo emas`; return info; }
  if (fetch && process.env.AGENT_GIT_FETCH !== "0" && !ctx.test) {
    const f = await git(["fetch", "--quiet", "--no-tags", "origin", "main"], 90_000);
    if (f.code === 0) info.fetchedAt = new Date().toISOString();
    else info.fetchError = `git fetch: ${f.timedOut ? "vaqt tugadi" : (f.err || f.out).trim().split("\n").slice(-1)[0]?.slice(0, 200) || `kod ${f.code}`}`;
  }
  const om = await git(["rev-parse", "--verify", "-q", "origin/main^{commit}"]);
  info.originMain = om.code === 0 ? om.out.trim() || null : null;
  if (!info.originMain && !info.fetchError) info.fetchError = "origin/main topilmadi (git fetch hali bo'lmagan?)";

  const base = cur.sha && SHA_RE.test(cur.sha) ? cur.sha : null;
  if (base && info.originMain) {
    const cnt = await git(["rev-list", "--count", `${base}..${info.originMain}`]);
    if (cnt.code === 0) {
      info.ahead = Number(cnt.out.trim()) || 0;
      const lg = await git(["log", "-n", "50", "--no-merges", "--format=%H%x1f%an%x1f%aI%x1f%s", `${base}..${info.originMain}`]);
      info.commits = lg.out.split("\n").filter(Boolean).map((l): ReleaseCommit => {
        const [sha, author, date, subject] = l.split("\x1f");
        return { sha, author: author ?? "", date: date ?? "", subject: (subject ?? "").slice(0, 200) };
      }).filter((c) => SHA_RE.test(c.sha));
    } else {
      info.fetchError = (info.fetchError ? `${info.fetchError}; ` : "") + `joriy reliz ${base.slice(0, 12)} repoda topilmadi`;
    }
  }
  // Relizlar sarlavhasi (commit xabari)
  await Promise.all(info.releases.slice(0, 8).map(async (r) => {
    const s = await git(["log", "-1", "--format=%s", r.sha], 5000);
    if (s.code === 0) r.subject = s.out.trim().slice(0, 200) || null;
  }));
  return info;
}

async function writeReleaseCheck(info: ReleaseInfo) {
  const now = new Date();
  const status = info.fetchError ? "UNKNOWN" : "OK";
  const message = scrubSecrets(`joriy ${info.current?.slice(0, 12) ?? "—"}; origin/main ${info.originMain?.slice(0, 12) ?? "—"}${info.ahead != null ? ` (+${info.ahead} commit)` : ""}${info.fetchError ? `; ${info.fetchError}` : ""}`).slice(0, 500);
  const data = JSON.parse(scrubSecrets(JSON.stringify(info))) as Prisma.InputJsonValue;
  const prev = await ctx.control.serviceCheck.findUnique({ where: { key: RELEASE_CHECK_KEY }, select: { status: true, changedAt: true } });
  const row = { kind: "release", target: "Relizlar", tenantId: null, status, message, latencyMs: null, data, checkedAt: now, changedAt: prev && prev.status === status ? prev.changedAt : now } as const;
  await ctx.control.serviceCheck.upsert({ where: { key: RELEASE_CHECK_KEY }, create: { key: RELEASE_CHECK_KEY, ...row }, update: row });
}

export function refreshRelease(force = false): Promise<void> {
  if (releaseRunning) return releaseRunning;
  if (!force && Date.now() - releaseAt < RELEASE_EVERY_MS) return Promise.resolve();
  releaseAt = Date.now();
  releaseRunning = collectReleaseInfo(true)
    .then(writeReleaseCheck)
    .catch((e) => ctx.warn(`relizlar holati: ${errMsg(e)}`))
    .finally(() => { releaseRunning = null; });
  return releaseRunning;
}

/* ───────────────────────── LOG_TAIL ───────────────────────── */

function filterLines(lines: string[], filter: string | undefined, n: number): string[] {
  const f = filter?.toLowerCase();
  const out = f ? lines.filter((l) => l.toLowerCase().includes(f)) : lines;
  return out.slice(-n);
}

export async function logTail(p: DevopsParams): Promise<DevopsOutcome> {
  const source = p.source ?? "";
  const n = Math.min(Math.max(1, p.lines ?? 100), LOG_MAX_LINES);
  const filter = p.filter || undefined;
  const prio = p.priority && isLogPriority(p.priority) ? p.priority : undefined;
  let lines: string[];
  let label: string;

  if (LOG_UNIT_RE.test(source)) {
    label = `journalctl -u ${source}`;
    if (!(await ctx.hasSystemd()) || !existsSync(BIN.journalctl)) return { status: "FAILED", output: "journalctl yo'q (Linux/systemd emas)" };
    // Filtr bilan ko'proq qator olinadi va agentda oddiy matn bo'yicha saralanadi (journalctl --grep regex — ishlatilmaydi)
    const args = ["-u", source, "-n", String(filter ? 5000 : n), "-q", "--no-pager", "-o", "short-iso", ...(prio ? ["-p", prio] : [])];
    const r = await exec(BIN.journalctl, args, { timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 });
    if (r.code !== 0 && !r.out.trim()) {
      const hint = /permission|insufficient|not seeing messages/i.test(r.err) ? "\ndeploy `systemd-journal` guruhida emas: sudo usermod -aG systemd-journal deploy && sudo systemctl restart insof-agent" : "";
      return { status: "FAILED", output: `$ journalctl ${args.join(" ")}\n${r.err.trim().slice(0, 1000)}${hint}` };
    }
    lines = cleanText(r.out).split("\n");
    if (/insufficient permissions|not seeing messages from other users/i.test(r.err)) lines.unshift("⚠ journal: huquq yetarli emas — deploy `systemd-journal` guruhida bo'lsin");
  } else if (isLogFile(source)) {
    const file = source === "deploy" ? P.deployLog : LOG_FILES[source].path;
    label = file;
    try {
      const t = await readTail(file, 4 * 1024 * 1024);
      lines = cleanText(t.text).split("\n");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const hint = code === "EACCES" ? (source.startsWith("nginx") ? " — deploy `adm` guruhida bo'lsin: sudo usermod -aG adm deploy && sudo systemctl restart insof-agent" : " — fayl huquqi") : code === "ENOENT" ? " — fayl hali yo'q" : "";
      return { status: "FAILED", output: `${file}: ${code ?? errMsg(e)}${hint}` };
    }
  } else {
    return { status: "REJECTED", output: "log manbai oq ro'yxatda emas" };
  }

  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const picked = filterLines(lines, filter, n);
  const head = `# ${label} — ${picked.length} qator${filter ? `, filtr «${filter}»` : ""}${prio && LOG_UNIT_RE.test(source) ? `, daraja: ${LOG_PRIORITIES[prio]}` : ""} · ${new Date().toISOString()}`;
  const body = picked.length ? picked.join("\n") : filter ? "(filtrga mos qator yo'q)" : "(log bo'sh)";
  return { status: "DONE", output: `${head}\n${body}`, limit: LOG_MAX_BYTES };
}

/* ───────────────────────── Kirish nuqtalari ───────────────────────── */

export async function devopsExecute(actionId: string, type: DevopsAction, params: DevopsParams): Promise<DevopsOutcome> {
  if (type === "LOG_TAIL") return logTail(params);
  return startDetached(actionId, type, type === "DEPLOY" ? params.ref ?? "main" : null);
}

let cleanupAt = 0;

/** Har ~3 s: ishlayotgan deploy logi/yakuni; har 5 daq relizlar holati; har soat eski LOG_TAIL chiqishlari tozalanadi. */
export async function devopsTick(): Promise<string> {
  let res = "";
  try { res = await watchDeploy(); } catch (e) { ctx.warn(`deploy kuzatuvi: ${errMsg(e)}`); res = `xato: ${errMsg(e)}`; }
  const st = await readState();
  await orphans(st?.actionId ?? null).catch((e) => ctx.warn(`deploy orphans: ${errMsg(e)}`));
  void refreshRelease(false);
  if (Date.now() - cleanupAt > 3600_000) {
    cleanupAt = Date.now();
    // LOG_TAIL chiqishlari katta (≤ 64 KB) — bir kundan keyin matni o'chiriladi, amal yozuvi (kim/qachon) qoladi
    await ctx.control.agentAction.updateMany({
      where: { type: "LOG_TAIL", finishedAt: { lt: new Date(Date.now() - 24 * 3600_000) }, NOT: { output: null } },
      data: { output: null },
    }).catch(() => {});
  }
  return res;
}
