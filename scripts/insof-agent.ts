/**
 * insof-agent — serverdagi monitoring va xavfsizlik agenti (uzoq ishlaydigan jarayon, systemd: docs/deploy/insof-agent.service).
 *
 *   cd /var/www/insof-erp/current && CONTROL_ENV_FILE=/var/www/insof-erp/control.env node_modules/.bin/tsx scripts/insof-agent.ts
 *
 * Panel (insof-control) serverga tegmaydi: agent metrikalarni yig'adi, tekshiruvlarni bajaradi va control bazaga yozadi
 * (HostSnapshot, ServiceCheck, Incident, AgentHeartbeat); panel qo'ygan AgentAction larni FAQAT oq ro'yxat bo'yicha
 * (src/lib/control/monitor/contract.ts) bajaradi — execFile/spawn, shell'siz, qat'iy argv, vaqt cheklovi bilan.
 *
 * Sikllar (har biri alohida try/catch + timeout; tekshiruvlar parallel — Promise.allSettled):
 *   15 s   host surati (/proc), systemd unitlar, korxona /api/health, panel, ECO /v1/health, Postgres
 *   5 min  SSL muddati, zaxira nusxa yangiligi, journald xatolari, reboot-required, xavfsizlik moduli (runSecurityChecks)
 *   6 soat AI xavfsizlik tahlili (runAiAnalysis) — panel RUN_AI_ANALYSIS bilan ham
 *   3 s    AgentAction navbati;  1 soat  eski yozuvlarni tozalash
 *   5 min  Postgres statistikasi (db:stats);  60 s  nginx trafik (traffic:*) — scripts/agent/dbtraffic.ts
 * Hodisa: WARN/CRIT → Incident ochiladi/yangilanadi, ketma-ket 2 marta OK → avtomatik RESOLVED.
 * Telegram: yangi HIGH/CRITICAL hodisa va uning yopilishi (ALERT_TG_BOT_TOKEN / ALERT_TG_CHAT_ID).
 *
 * Linux bo'lmagan muhitda (macOS, lokal sinov) /proc va systemctl yo'q — bu tekshiruvlar UNKNOWN deb belgilanadi,
 * agent ishlashda davom etadi. Test rejimi (INSOF_ENV=test): Telegram, rejali AI tahlil va imtiyozli amallar o'chiq.
 *
 * Muhit o'zgaruvchilari (ixtiyoriy): AGENT_APP_DIR (standart control.env papkasi yoki /var/www/insof-erp),
 *   BACKUP_ENV (/etc/insof/backup.env), CONTROL_PORT (3100), AGENT_ECO_URL ("" — o'chiq), AGENT_SSL_DOMAINS
 *   (vergul bilan; standart admin.insof-erp.uz,api.insof-erp.uz + korxona domenlari), AGENT_EXTRA_UNITS (masalan redis-server),
 *   AGENT_FAST_MS, AGENT_SLOW_MS, AGENT_AI_MS, AGENT_ACTION_POLL_MS.
 */
import { loadEnv, readEnvKeys } from "./env";
loadEnv(process.env.CONTROL_ENV_FILE || "control.env");

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readdir, readFile, stat, statfs, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { pathToFileURL } from "node:url";
import type { Prisma, PrismaClient } from "@/generated/control";
import { checkKey, type ActionType } from "@/lib/control/monitor/contract";
import {
  THRESHOLDS, countJournalLines, cpuPctFromDelta, cpuSustainedStatus, decideIncident, diskStatus, latestBackupDir,
  levelAbove, levelBelow, loadStatus, memStatus, netBps, parseLoadavg, parseMeminfo, parseNetDev, parseProcStat,
  parseProcStatus, parseSystemctlShow, parseUptime, restartsIncreased, scrubSecrets, severityFor, sevRank,
  statusForSeverity, topByRss, findingCheckStatus, findingIsProblem, trimOutput, unitStatus, validateAction, worst,
  type ActionParams, type CpuTimes, type NetTotals, type UnitInfo,
} from "@/lib/control/monitor/parse";
import type {
  CheckResult, CheckStatusT, Finding, FindingSeverity, SecurityCtx, SecurityModule, SuggestedAction, TenantRef,
} from "@/lib/control/monitor/types";
import { isTestMode } from "@/lib/test-mode";
import { DETACHED_ACTIONS, isDevopsAction } from "@/lib/control/devops/contract";
import { devopsExecute, devopsTick, initDevops } from "./agent/devops";
import { isDbActionType } from "@/lib/control/dbtraffic/contract";
import { closeDbClients, dbStatsChecks, executeDbAction, trafficChecks, type DbtCtx } from "./agent/dbtraffic";

/* ───────────────────────── Sozlama ───────────────────────── */

const ENV_FILE = process.env.CONTROL_ENV_FILE || "control.env";
const APP_DIR = process.env.AGENT_APP_DIR || (process.env.CONTROL_ENV_FILE ? path.dirname(path.resolve(ENV_FILE)) : "/var/www/insof-erp");
const BACKUP_ENV = process.env.BACKUP_ENV || "/etc/insof/backup.env";
const backupCfg = readEnvKeys(BACKUP_ENV, ["OUT_DIR", "ALERT_TG_BOT_TOKEN", "ALERT_TG_CHAT_ID"]);
const BACKUP_DIR = process.env.AGENT_BACKUP_DIR || backupCfg.OUT_DIR || "/var/backups/insof";
const BACKUP_LOG = process.env.AGENT_BACKUP_LOG || "/var/log/insof-backup.log";
const CONTROL_PORT = Number(process.env.CONTROL_PORT || 3100);
const ECO_URL = process.env.AGENT_ECO_URL ?? "http://127.0.0.1:3010/v1/health";
const SSL_DOMAINS = (process.env.AGENT_SSL_DOMAINS ?? "admin.insof-erp.uz,api.insof-erp.uz").split(",").map((s) => s.trim()).filter(Boolean);
const EXTRA_UNITS = (process.env.AGENT_EXTRA_UNITS ?? "").split(",").map((s) => s.trim()).filter((u) => /^[a-zA-Z0-9@._-]{2,60}$/.test(u));
const ms = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 1000 ? v : d; };
const FAST_MS = ms("AGENT_FAST_MS", 15_000);
const SLOW_MS = ms("AGENT_SLOW_MS", 5 * 60_000);
const AI_MS = ms("AGENT_AI_MS", 6 * 3600_000);
const ACTION_POLL_MS = ms("AGENT_ACTION_POLL_MS", 3_000);
const TRAFFIC_MS = ms("AGENT_TRAFFIC_MS", 60_000);
const RETENTION_MS = 3600_000;
const TEST = isTestMode();
const TG_TOKEN = TEST ? "" : process.env.ALERT_TG_BOT_TOKEN || backupCfg.ALERT_TG_BOT_TOKEN || "";
const TG_CHAT = TEST ? "" : process.env.ALERT_TG_CHAT_ID || backupCfg.ALERT_TG_CHAT_ID || "";
const HOST = os.hostname();
const LINUX = existsSync("/proc/stat");
const STARTED_AT = new Date();
const LOCK_KEY = 7310_0500_01; // pg advisory lock: bitta agent nusxasi
/** Bolalar jarayonlariga beriladigan muhit — control.env sirlari (baza paroli, CONTROL_SECRET) o'tmaydi. */
const CHILD_ENV: Record<string, string> = {
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOME: process.env.HOME || os.homedir(),
  LANG: "C.UTF-8",
  TZ: process.env.TZ || "Asia/Tashkent",
  USER: process.env.USER || os.userInfo().username,
  LOGNAME: process.env.LOGNAME || os.userInfo().username,
};
const BIN = {
  sudo: "/usr/bin/sudo",
  systemctl: "/usr/bin/systemctl",
  journalctl: "/usr/bin/journalctl",
  nginx: "/usr/sbin/nginx",
  ufw: "/usr/sbin/ufw",
  bash: "/bin/bash",
  // apt (python3-certbot) → /usr/bin/certbot; snap → /snap/bin/certbot
  certbot: ["/usr/bin/certbot", "/snap/bin/certbot"].find((p) => existsSync(p)) ?? "/usr/bin/certbot",
};

const log = (msg: string) => console.log(`[agent] ${scrubSecrets(msg)}`);
const warnLog = (msg: string) => console.error(`[agent] ⚠ ${scrubSecrets(msg)}`);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);

let control!: PrismaClient;
let lockDb!: PrismaClient;
let releaseVersion: () => string | null = () => null;
let stopping = false;

/* ───────────────────────── Yordamchilar ───────────────────────── */

function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => t && clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${label}: ${Math.round(timeoutMs / 1000)} s da tugamadi`)), timeoutMs); }),
  ]);
}

type RunResult = { code: number | null; signal: string | null; out: string; timedOut: boolean; missing: boolean };
const running = new Set<ReturnType<typeof spawn>>();

/** Buyruqni shell'siz ishga tushiradi (qat'iy argv). Chiqishning oxirgi 64 KB i saqlanadi (stdout+stderr). */
function run(file: string, args: string[], opt: { timeoutMs: number; cwd?: string; env?: Record<string, string> }): Promise<RunResult> {
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, { cwd: opt.cwd, env: (opt.env ?? CHILD_ENV) as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], shell: false });
    } catch (e) {
      resolve({ code: null, signal: null, out: errMsg(e), timedOut: false, missing: true });
      return;
    }
    running.add(child);
    const add = (b: Buffer) => { out += b.toString("utf8"); if (out.length > 65536) out = out.slice(-65536); };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); }, opt.timeoutMs);
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer); running.delete(child);
      resolve({ code: null, signal: null, out: out + e.message, timedOut, missing: e.code === "ENOENT" });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer); running.delete(child);
      resolve({ code, signal, out, timedOut, missing: false });
    });
  });
}

let systemdOk: boolean | null = null;
async function hasSystemd(): Promise<boolean> {
  if (systemdOk !== null) return systemdOk;
  if (!existsSync("/run/systemd/system")) return (systemdOk = false);
  const r = await run(BIN.systemctl, ["--version"], { timeoutMs: 5000 });
  return (systemdOk = r.code === 0);
}

async function readText(file: string): Promise<string | null> {
  try { return await readFile(file, "utf8"); } catch { return null; }
}

/** Faylning oxirgi qatori (katta log fayl to'liq o'qilmaydi). */
async function lastLine(file: string): Promise<string | null> {
  try {
    const fh = await open(file, "r");
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 4096);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const lines = buf.toString("utf8").split("\n").map((l) => l.trim()).filter(Boolean);
      return lines.length ? lines[lines.length - 1].slice(0, 300) : null;
    } finally { await fh.close(); }
  } catch { return null; }
}

async function httpCheck(url: string, timeoutMs = 5000): Promise<{ status: number | null; ms: number; body: Record<string, unknown> | null; error?: string }> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual", cache: "no-store" });
    let body: Record<string, unknown> | null = null;
    try { body = (await r.json()) as Record<string, unknown>; } catch { /* JSON emas */ }
    return { status: r.status, ms: Date.now() - t0, body };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const reason = err.name === "TimeoutError" ? `javob yo'q (${timeoutMs / 1000} s)` : err.cause?.code === "ECONNREFUSED" ? "ulanish rad etildi (jarayon ishlamayapti)" : errMsg(err.cause ?? err);
    return { status: null, ms: Date.now() - t0, body: null, error: reason };
  }
}

const restartAction = (unit: string): SuggestedAction => ({ type: "RESTART_UNIT", params: { unit }, label: `${unit} ni qayta ishga tushirish` });

/* ───────────────────────── Korxonalar ───────────────────────── */

let tenantsCache: { at: number; list: TenantRef[] } | null = null;
async function tenants(): Promise<TenantRef[]> {
  if (tenantsCache && Date.now() - tenantsCache.at < 60_000) return tenantsCache.list;
  const list = await control.tenant.findMany({
    select: { id: true, slug: true, port: true, domain: true, dbName: true, status: true },
    orderBy: { port: "asc" },
  });
  tenantsCache = { at: Date.now(), list: list.map((t) => ({ ...t, status: String(t.status) })) };
  return tenantsCache.list;
}
const activeTenants = async () => (await tenants()).filter((t) => t.status === "ACTIVE");

function watchedUnits(active: TenantRef[]): string[] {
  return [...active.map((t) => `insof-erp@${t.slug}`), "insof-control", "insof-eco", "nginx", "postgresql@14-main", ...EXTRA_UNITS];
}

/* ───────────────────────── 15 s: host surati ───────────────────────── */

let prevCpu: CpuTimes | null = null;
let prevNet: { at: number; v: NetTotals } | null = null;
let prevOsCpu: { idle: number; total: number } | null = null;
const cpuHistory: number[] = [];

function osCpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { const t = c.times; idle += t.idle; total += t.user + t.nice + t.sys + t.idle + t.irq; }
  return { idle, total };
}

async function diskOf(mount: string) {
  try {
    const s = await statfs(mount);
    const total = s.blocks * s.bsize;
    const used = (s.blocks - s.bfree) * s.bsize;
    const avail = s.bavail * s.bsize;
    // df(1) kabi: ishlatilgan / (ishlatilgan + oddiy foydalanuvchiga ochiq bo'sh joy)
    const pct = used + avail > 0 ? Math.round((used / (used + avail)) * 1000) / 10 : null;
    return { mount, total, used, avail, pct };
  } catch { return null; }
}

async function processes(): Promise<{ count: number; top: { pid: number; name: string; rssMb: number }[] }> {
  const pids = (await readdir("/proc")).filter((n) => /^\d+$/.test(n));
  const rows = await Promise.allSettled(pids.map(async (pid) => {
    const st = parseProcStatus(await readFile(`/proc/${pid}/status`, "utf8"));
    return st ? { pid: Number(pid), name: st.name, rss: st.rss } : null;
  }));
  const list = rows.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  return { count: pids.length, top: topByRss(list, 5).map((p) => ({ pid: p.pid, name: p.name, rssMb: Math.round(p.rss / 1048576) })) };
}

async function hostSnapshot(): Promise<CheckResult[]> {
  const now = Date.now();
  const cores = os.cpus().length || 1;
  const disks = (await Promise.all(["/", "/var"].map(diskOf))).filter((d): d is NonNullable<typeof d> => !!d);
  const root = disks[0] ?? null;
  const diskPct = disks.length ? Math.max(...disks.map((d) => d.pct ?? 0)) : null;
  const unk = (key: string, target: string): CheckResult => ({ key, kind: "host", target, status: "UNKNOWN", message: "/proc yo'q (Linux emas) — tekshirilmadi" });

  let cpuPct: number | null, load: [number, number, number], mem: { memTotal: number; memUsed: number; swapTotal: number; swapUsed: number };
  let uptime: number, net: { rx: number; tx: number } | null = null, procs: Awaited<ReturnType<typeof processes>> | null = null;
  if (LINUX) {
    const [statT, memT, loadT, upT, netT] = await Promise.all(["/proc/stat", "/proc/meminfo", "/proc/loadavg", "/proc/uptime", "/proc/net/dev"].map(readText));
    const cpu = statT ? parseProcStat(statT) : null;
    cpuPct = cpuPctFromDelta(prevCpu, cpu);
    prevCpu = cpu;
    load = (loadT && parseLoadavg(loadT)) || [0, 0, 0];
    const mi = memT ? parseMeminfo(memT) : null;
    mem = mi ?? { memTotal: os.totalmem(), memUsed: os.totalmem() - os.freemem(), swapTotal: 0, swapUsed: 0 };
    uptime = (upT ? parseUptime(upT) : null) ?? Math.floor(os.uptime());
    const nt = netT ? parseNetDev(netT) : null;
    if (nt) { net = netBps(prevNet?.v ?? null, nt, prevNet ? now - prevNet.at : 0); prevNet = { at: now, v: nt }; }
    procs = await processes().catch(() => null);
  } else {
    // macOS / lokal: taxminiy qiymatlar faqat surat uchun (panel grafigi bo'sh qolmasin); tekshiruvlar UNKNOWN
    const c = osCpuTimes();
    cpuPct = prevOsCpu && c.total > prevOsCpu.total ? Math.round((1 - (c.idle - prevOsCpu.idle) / (c.total - prevOsCpu.total)) * 1000) / 10 : null;
    prevOsCpu = c;
    load = os.loadavg() as [number, number, number];
    mem = { memTotal: os.totalmem(), memUsed: os.totalmem() - os.freemem(), swapTotal: 0, swapUsed: 0 };
    uptime = Math.floor(os.uptime());
  }
  if (cpuPct != null) { cpuHistory.push(cpuPct); if (cpuHistory.length > 20) cpuHistory.shift(); }

  await control.hostSnapshot.create({
    data: {
      hostname: HOST, cpuPct: cpuPct ?? 0, load1: load[0], load5: load[1], load15: load[2],
      memTotal: BigInt(Math.round(mem.memTotal)), memUsed: BigInt(Math.round(mem.memUsed)),
      swapTotal: BigInt(Math.round(mem.swapTotal)), swapUsed: BigInt(Math.round(mem.swapUsed)),
      diskTotal: BigInt(Math.round(root?.total ?? 0)), diskUsed: BigInt(Math.round(root?.used ?? 0)),
      uptimeSec: uptime, netRxBps: net ? BigInt(net.rx) : null, netTxBps: net ? BigInt(net.tx) : null,
      extra: {
        source: LINUX ? "proc" : "os-fallback", cores, cpuMeasured: cpuPct != null,
        processes: procs?.count ?? null, top: procs?.top ?? [],
        disks: disks.map((d) => ({ mount: d.mount, total: d.total, used: d.used, pct: d.pct })),
      },
    },
  });

  const memPct = mem.memTotal > 0 ? Math.round((mem.memUsed / mem.memTotal) * 1000) / 10 : null;
  const out: CheckResult[] = [];
  const dStatus = diskStatus(diskPct);
  out.push({
    key: checkKey.disk(), kind: "disk", target: "Disk (/ va /var)", status: dStatus,
    message: diskPct == null ? "statfs ishlamadi" : disks.map((d) => `${d.mount} ${d.pct}%`).join(", "),
    data: { disks: disks.map((d) => ({ mount: d.mount, pct: d.pct, availGb: Math.round(d.avail / 1e8) / 10 })) },
    incident: { category: "performance", title: `Disk to'lmoqda: ${diskPct}%`, critSeverity: "CRITICAL" },
  });
  if (!LINUX) {
    out.push(unk(checkKey.memory(), "Xotira"), unk(checkKey.cpu(), "CPU"), unk("host:load", "Yuklama (load)"));
    return out;
  }
  out.push({
    key: checkKey.memory(), kind: "memory", target: "Xotira", status: memStatus(memPct),
    message: `${memPct}% (${Math.round(mem.memUsed / 1048576)} / ${Math.round(mem.memTotal / 1048576)} MB), swap ${Math.round(mem.swapUsed / 1048576)} MB`,
    data: { memPct, swapUsedMb: Math.round(mem.swapUsed / 1048576), top: procs?.top ?? [] },
    incident: { category: "performance", title: `Xotira yetishmayapti: ${memPct}%` },
  });
  const cpuSt = cpuSustainedStatus(cpuHistory);
  out.push({
    key: checkKey.cpu(), kind: "cpu", target: "CPU", status: cpuSt,
    message: cpuPct == null ? "birinchi namuna (keyingi siklda hisoblanadi)" : `${cpuPct}% (oxirgi ${THRESHOLDS.cpuPct.samples}: ${cpuHistory.slice(-THRESHOLDS.cpuPct.samples).join(", ")})`,
    data: { cpuPct, history: cpuHistory.slice(-THRESHOLDS.cpuPct.samples), top: procs?.top ?? [] },
    incident: { category: "performance", title: `CPU uzoq vaqt band: ${cpuPct}%` },
  });
  out.push({
    key: "host:load", kind: "host", target: "Yuklama (load)", status: loadStatus(load[0], cores),
    message: `load ${load.join(" / ")} (${cores} yadro)`, data: { load, cores },
    incident: { category: "performance", title: `Server yuklamasi yuqori: ${load[0]} (${cores} yadro)` },
  });
  return out;
}

/* ───────────────────────── 15 s: systemd unitlar ───────────────────────── */

const unitMemo = new Map<string, { restarts: number | null; increasedAt: number }>();

async function showUnits(units: string[]): Promise<UnitInfo[] | null> {
  if (!(await hasSystemd())) return null;
  const r = await run(BIN.systemctl, ["show", "-p", "Id,LoadState,ActiveState,SubState,NRestarts,MemoryCurrent,ActiveEnterTimestamp", "--", ...units], { timeoutMs: 10_000 });
  if (r.code !== 0 && !r.out.includes("Id=")) throw new Error(`systemctl show: ${r.out.slice(0, 200)}`);
  return parseSystemctlShow(r.out);
}

function unitResult(unit: string, info: UnitInfo | undefined, active: TenantRef[]): CheckResult {
  const tenant = active.find((t) => unit === `insof-erp@${t.slug}`);
  const base = { key: checkKey.unit(unit), kind: "unit", target: unit, tenantId: tenant?.id ?? null };
  if (!info) return { ...base, status: "UNKNOWN", message: "systemctl javobida yo'q" };
  if (info.loadState === "not-found") return { ...base, status: "UNKNOWN", message: "unit o'rnatilmagan (not-found)" };
  const memo = unitMemo.get(unit);
  const now = Date.now();
  let increasedAt = memo?.increasedAt ?? 0;
  if (restartsIncreased(memo?.restarts, info.nRestarts)) increasedAt = now;
  unitMemo.set(unit, { restarts: info.nRestarts, increasedAt });
  const recentRestart = increasedAt > 0 && now - increasedAt < THRESHOLDS.restartWindowMs;
  const status = unitStatus(info, recentRestart);
  const suggested: SuggestedAction[] = /^(insof-erp@|insof-control$|insof-eco$)/.test(unit) ? [restartAction(unit)]
    : unit === "nginx" ? [{ type: "RELOAD_NGINX", label: "nginx ni tekshirib qayta yuklash" }] : [];
  const critical = /^(insof-erp@|insof-control$|nginx$|postgresql)/.test(unit);
  return {
    ...base, status,
    message: `${info.activeState}/${info.subState}${info.nRestarts ? `, qayta ishga tushgan: ${info.nRestarts}` : ""}${recentRestart ? " (oxirgi 10 daqiqada qayta ishga tushdi)" : ""}`,
    data: { activeState: info.activeState, subState: info.subState, nRestarts: info.nRestarts, memoryMb: info.memoryCurrent != null ? Math.round(info.memoryCurrent / 1048576) : null, since: info.activeEnterTimestamp },
    incident: {
      category: "availability",
      title: status === "CRIT" ? `${unit} ishlamayapti (${info.activeState})` : `${unit}: beqaror (${info.activeState}${recentRestart ? ", qayta ishga tushmoqda" : ""})`,
      critSeverity: critical ? "CRITICAL" : "HIGH",
      suggestedActions: suggested,
    },
  };
}

async function unitChecks(active: TenantRef[]): Promise<CheckResult[]> {
  const units = watchedUnits(active);
  const infos = await showUnits(units);
  if (!infos) return units.map((u) => ({ key: checkKey.unit(u), kind: "unit", target: u, status: "UNKNOWN" as const, message: "systemd yo'q (Linux emas) — tekshirilmadi" }));
  return units.map((u) => unitResult(u, infos.find((i) => i.id === u || i.id === `${u}.service`), active));
}

/* ───────────────────────── 15 s: HTTP ───────────────────────── */

function healthResult(key: string, target: string, tenantId: string | null, r: Awaited<ReturnType<typeof httpCheck>>, unit: string | null, critSeverity: FindingSeverity): CheckResult {
  const version = typeof r.body?.version === "string" ? r.body.version : null;
  const mine = releaseVersion();
  let status: CheckStatusT; let message: string;
  if (r.status === 200) {
    status = r.ms > THRESHOLDS.httpSlowMs ? "WARN" : "OK";
    message = `200 (${r.ms} ms)${version ? `, versiya ${version}` : ""}`;
    if (version && mine && version !== mine && unit) { status = worst(status, "WARN"); message += ` — joriy reliz ${mine} emas (qayta ishga tushmagan?)`; }
  } else if (r.status === 503) { status = "CRIT"; message = "503 — baza javob bermayapti"; }
  else if (r.status != null) { status = "CRIT"; message = `HTTP ${r.status}`; }
  else { status = "CRIT"; message = r.error ?? "javob yo'q"; }
  return {
    key, kind: "http", target, tenantId, status, message, latencyMs: r.status != null ? r.ms : null,
    data: { httpStatus: r.status, version },
    incident: {
      category: "availability", critSeverity,
      title: status === "CRIT" ? `${target} javob bermayapti: ${message}` : `${target}: ${message}`,
      suggestedActions: unit ? [restartAction(unit)] : [],
    },
  };
}

async function httpChecks(active: TenantRef[]): Promise<CheckResult[]> {
  const jobs: Promise<CheckResult>[] = active.map(async (t) =>
    healthResult(checkKey.tenantHttp(t.slug), `${t.slug} /api/health`, t.id, await httpCheck(`http://127.0.0.1:${t.port}/api/health`), `insof-erp@${t.slug}`, "CRITICAL"));
  jobs.push((async () => healthResult("http:control", "IT panel /api/health", null, await httpCheck(`http://127.0.0.1:${CONTROL_PORT}/api/health`), "insof-control", "HIGH"))());
  if (ECO_URL) {
    jobs.push((async () => {
      const r = await httpCheck(ECO_URL);
      const res = healthResult(checkKey.eco(), "ECO API /v1/health", null, r, "insof-eco", "HIGH");
      res.data = { ...res.data, version: null };
      return res;
    })());
  } else {
    jobs.push(Promise.resolve({ key: checkKey.eco(), kind: "http", target: "ECO API", status: "UNKNOWN", message: "AGENT_ECO_URL bo'sh — tekshirilmaydi" }));
  }
  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
}

/* ───────────────────────── 15 s: Postgres ───────────────────────── */

async function postgresChecks(all: TenantRef[]): Promise<CheckResult[]> {
  const t0 = Date.now();
  const [row] = await control.$queryRaw<{ conns: number; max: number; longest: number | null; db: string }[]>`
    SELECT (SELECT count(*) FROM pg_stat_activity)::int AS conns,
           current_setting('max_connections')::int AS max,
           (SELECT EXTRACT(EPOCH FROM max(now() - query_start)) FROM pg_stat_activity
             WHERE state = 'active' AND pid <> pg_backend_pid() AND backend_type = 'client backend')::float AS longest,
           current_database() AS db`;
  const names = [...new Set([row.db, ...all.map((t) => t.dbName)])];
  const sizes = await control.$queryRaw<{ datname: string; size: bigint | null }[]>`
    SELECT datname, CASE WHEN has_database_privilege(datname, 'CONNECT') THEN pg_database_size(datname) END AS size
      FROM pg_database WHERE datname = ANY(${names})`;
  const latency = Date.now() - t0;
  const connPct = row.max > 0 ? Math.round((row.conns / row.max) * 1000) / 10 : null;
  const longest = row.longest != null ? Math.round(row.longest) : 0;
  const status = worst(levelAbove(connPct, THRESHOLDS.pgConnPct), levelAbove(longest, THRESHOLDS.pgQuerySec));
  const sizeMb = Object.fromEntries(sizes.map((s) => [s.datname, s.size != null ? Math.round(Number(s.size) / 1048576) : null]));
  const out: CheckResult[] = [{
    key: checkKey.postgres(), kind: "db", target: "PostgreSQL", status, latencyMs: latency,
    message: `ulanishlar ${row.conns}/${row.max} (${connPct}%), eng uzun so'rov ${longest} s`,
    data: { conns: row.conns, max: row.max, connPct, longestQuerySec: longest, sizeMb },
    incident: { category: "performance", title: connPct != null && connPct >= THRESHOLDS.pgConnPct.warn ? `Postgres ulanishlari tugamoqda: ${row.conns}/${row.max}` : `Postgres: uzoq so'rov ${longest} s` },
  }];
  for (const t of all.filter((x) => x.status === "ACTIVE")) {
    const found = sizes.find((s) => s.datname === t.dbName);
    out.push({
      key: checkKey.tenantDb(t.slug), kind: "db", target: `${t.slug} bazasi`, tenantId: t.id,
      status: found ? "OK" : "CRIT",
      message: found ? `${t.dbName}${sizeMb[t.dbName] != null ? ` — ${sizeMb[t.dbName]} MB` : ""}` : `${t.dbName} bazasi topilmadi`,
      data: { dbName: t.dbName, sizeMb: sizeMb[t.dbName] ?? null },
      incident: { category: "availability", title: `${t.slug}: baza ${t.dbName} topilmadi`, critSeverity: "CRITICAL" },
    });
  }
  return out;
}

/* ───────────────────────── 5 min: SSL ───────────────────────── */

function sslCheck(domain: string, timeoutMs = 8000): Promise<CheckResult> {
  return new Promise((resolve) => {
    const base = { key: checkKey.ssl(domain), kind: "ssl", target: `${domain} SSL` };
    const incident = (title: string) => ({ category: "certificate", title, suggestedActions: [{ type: "RENEW_CERT" as const, label: "Sertifikatlarni yangilash (certbot renew)" }] });
    let done = false;
    const finish = (r: CheckResult) => { if (!done) { done = true; sock.destroy(); resolve(r); } };
    const sock = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = sock.getPeerCertificate();
      if (!cert || !cert.valid_to) return finish({ ...base, status: "CRIT", message: "sertifikat olinmadi", incident: incident(`${domain}: sertifikat yo'q`) });
      const validTo = new Date(cert.valid_to);
      const days = Math.floor((validTo.getTime() - Date.now()) / 864e5);
      let status = levelBelow(days, THRESHOLDS.sslDays);
      const authErr = sock.authorized ? null : String(sock.authorizationError ?? "");
      // Muddati o'tgani alohida (kunlar < 7 → CRIT); boshqa ishonchsizlik (domen mos emas, zanjir) — ham CRIT
      if (authErr && authErr !== "CERT_HAS_EXPIRED") status = "CRIT";
      finish({
        ...base, status,
        message: `${days} kun qoldi (${validTo.toISOString().slice(0, 10)})${authErr ? `, ishonchsiz: ${authErr}` : ""}`,
        data: { validTo: validTo.toISOString(), days, issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null, authorizationError: authErr },
        incident: incident(authErr && authErr !== "CERT_HAS_EXPIRED" ? `${domain}: sertifikat ishonchsiz (${authErr})` : `${domain}: SSL sertifikati ${days} kunda tugaydi`),
      });
    });
    sock.on("timeout", () => finish({ ...base, status: "WARN", message: `443 javob bermadi (${timeoutMs / 1000} s)`, incident: incident(`${domain}: 443 portga ulanib bo'lmadi`) }));
    sock.on("error", (e) => finish({ ...base, status: "WARN", message: `ulanib bo'lmadi: ${errMsg(e)}`, incident: incident(`${domain}: 443 portga ulanib bo'lmadi`) }));
  });
}

/* ───────────────────────── 5 min: zaxira nusxa ───────────────────────── */

async function backupCheck(): Promise<CheckResult> {
  const base = { key: checkKey.backup(), kind: "backup", target: "Zaxira nusxa" };
  const incident = (title: string) => ({ category: "backup", title, critSeverity: "HIGH" as const, suggestedActions: [{ type: "RUN_BACKUP" as const, label: "Hozir zaxira nusxa olish" }] });
  let names: string[];
  try { names = await readdir(BACKUP_DIR); } catch {
    return LINUX
      ? { ...base, status: "CRIT", message: `${BACKUP_DIR} yo'q yoki o'qib bo'lmaydi`, incident: incident("Zaxira nusxa papkasi topilmadi") }
      : { ...base, status: "UNKNOWN", message: `${BACKUP_DIR} yo'q (lokal muhit) — tekshirilmadi` };
  }
  const latest = latestBackupDir(names);
  const logLine = await lastLine(BACKUP_LOG);
  if (!latest) return { ...base, status: "CRIT", message: "hali birorta zaxira nusxa yo'q", data: { logLine }, incident: incident("Zaxira nusxa yo'q") };
  const dir = path.join(BACKUP_DIR, latest);
  const sums = await stat(path.join(dir, "SHA256SUMS")).catch(() => null);
  const dirStat = await stat(dir);
  const ageH = Math.round(((Date.now() - (sums ?? dirStat).mtimeMs) / 3600_000) * 10) / 10;
  let status: CheckStatusT = ageH > THRESHOLDS.backupHours.crit ? "CRIT" : "OK";
  const notes: string[] = [];
  if (!sums) { status = worst(status, "WARN"); notes.push("SHA256SUMS yo'q"); }
  if (logLine && /(✗|XATO|ERROR)/i.test(logLine)) { status = worst(status, "WARN"); notes.push("oxirgi log qatorida xato"); }
  return {
    ...base, status,
    message: `oxirgisi ${latest}, ${ageH} soat oldin${notes.length ? ` — ${notes.join(", ")}` : ""}`,
    data: { latest, ageHours: ageH, sha256sums: !!sums, logLine },
    incident: incident(status === "CRIT" ? `Zaxira nusxa eskirgan: ${ageH} soat` : `Zaxira nusxada muammo: ${notes.join(", ")}`),
  };
}

/* ───────────────────────── 5 min: journald, reboot ───────────────────────── */

async function journalChecks(active: TenantRef[]): Promise<CheckResult[]> {
  const units = watchedUnits(active);
  if (!(await hasSystemd()) || !existsSync(BIN.journalctl)) {
    return [{ key: "journal:all", kind: "journal", target: "journald", status: "UNKNOWN", message: "journalctl yo'q (Linux emas) — tekshirilmadi" }];
  }
  const settled = await Promise.allSettled(units.map(async (u): Promise<CheckResult> => {
    const r = await run(BIN.journalctl, ["-u", u, "-p", "err", "--since", "-5min", "-o", "cat", "-q", "--no-pager"], { timeoutMs: 15_000 });
    if (r.code !== 0 && r.code !== 1) return { key: `journal:${u}`, kind: "journal", target: `${u} jurnali`, status: "UNKNOWN", message: `journalctl xato: ${r.out.slice(0, 120)}` };
    const n = countJournalLines(r.out);
    return {
      key: `journal:${u}`, kind: "journal", target: `${u} jurnali`, status: levelAbove(n, THRESHOLDS.journalErrors),
      message: `oxirgi 5 daqiqada ${n} ta xato`, data: { errors5m: n },
      incident: { category: "availability", title: `${u}: jurnalda ko'p xato (${n} ta / 5 daqiqa)`, critSeverity: "HIGH" },
    };
  }));
  const res = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  // journald guruhiga kirilmagan bo'lsa (deploy ∉ systemd-journal) hamma narsa 0 ko'rinadi — ogohlantiramiz
  return res;
}

async function rebootCheck(): Promise<CheckResult> {
  const base = { key: "host:reboot", kind: "host", target: "Qayta yuklash kerakmi" };
  if (!LINUX) return { ...base, status: "UNKNOWN", message: "Linux emas — tekshirilmadi" };
  if (!existsSync("/var/run/reboot-required")) return { ...base, status: "OK", message: "kerak emas" };
  const pkgs = ((await readText("/var/run/reboot-required.pkgs")) ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    ...base, status: "WARN", message: `yangilanishlar qayta yuklashni kutmoqda${pkgs.length ? `: ${pkgs.slice(0, 5).join(", ")}` : ""}`,
    data: { packages: pkgs.slice(0, 30) },
    incident: { category: "update", title: "Server qayta yuklashni talab qiladi (yadro/kutubxona yangilangan)" },
  };
}

/* ───────────────────────── Xavfsizlik moduli (B) ───────────────────────── */

let secState: "loaded" | "absent" | "error" = "absent";
/**
 * B modulining fayli. tsx tsconfig "@/..." yo'llarini faqat statik/literal importlarda almashtiradi — shuning uchun
 * mutlaq fayl yo'li bilan (modul hali yozilmagan bo'lsa tsc ham, agent ham yiqilmasin). Fayl yo'q → "absent".
 */
function securityModulePath(): string | null {
  if (TEST && process.env.AGENT_SECURITY_MODULE) return path.resolve(process.env.AGENT_SECURITY_MODULE);
  const base = path.resolve(__dirname, "../src/lib/control/security");
  return [path.join(base, "index.ts"), `${base}.ts`].find((f) => existsSync(f)) ?? null;
}

async function loadSecurity(): Promise<SecurityModule | null> {
  const file = securityModulePath();
  if (!file || !existsSync(file)) { secState = "absent"; return null; }
  try {
    const m = (await import(pathToFileURL(file).href)) as Partial<SecurityModule> & { default?: Partial<SecurityModule> };
    const mod = typeof m.runSecurityChecks === "function" ? m : m.default;
    if (mod && typeof mod.runSecurityChecks === "function" && typeof mod.runAiAnalysis === "function") {
      secState = "loaded";
      return mod as SecurityModule;
    }
    secState = "error";
    warnLog("xavfsizlik moduli topildi, lekin runSecurityChecks/runAiAnalysis eksport qilinmagan");
    return null;
  } catch (e) {
    secState = "error";
    warnLog(`xavfsizlik modulini yuklashda xato: ${errMsg(e)}`);
    return null;
  }
}

async function securityCtx(): Promise<SecurityCtx> {
  return { appDir: APP_DIR, tenants: await tenants(), hostname: HOST, linux: LINUX, systemd: await hasSystemd(), testMode: TEST, now: new Date(), log };
}

const secOkStreak = new Map<string, number>();
const securityKey = (k: string) => (k.startsWith("security:") ? k : checkKey.security(k));

async function securityScan(): Promise<string> {
  const mod = await loadSecurity();
  const base = { key: "security:scan", kind: "security", target: "Xavfsizlik skaneri" };
  if (!mod) {
    await applyChecks([{ ...base, status: "UNKNOWN", message: secState === "absent" ? "xavfsizlik moduli hali o'rnatilmagan" : "xavfsizlik moduli yuklanmadi (agent jurnaliga qarang)" }], "monitor");
    return `modul: ${secState}`;
  }
  // B modulining eng sekin tekshiruvi (npm audit) 150 s — chegarani undan katta qo'yamiz
  const findings: Finding[] = await withTimeout(mod.runSecurityChecks(await securityCtx()), 200_000, "runSecurityChecks");
  const valid = (Array.isArray(findings) ? findings : []).filter((f) => f && typeof f.key === "string" && f.key && typeof f.title === "string" && sevRank(f.severity) >= 0);
  const problems = valid.filter((f) => findingIsProblem(f));
  const top = problems.reduce<FindingSeverity>((a, f) => (sevRank(f.severity) > sevRank(a) ? f.severity : a), "INFO");
  const counts: Record<string, number> = {};
  for (const f of problems) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const unknown = valid.filter((f) => findingCheckStatus(f) === "UNKNOWN").length;

  // Har topilma kaliti — ServiceCheck (OK/WARN/CRIT/UNKNOWN); hodisalar pastda, o'z qoidasi bilan
  const rows: CheckResult[] = [{
    ...base, status: problems.length ? worst("WARN", statusForSeverity(top)) : "OK",
    message: `${valid.length} tekshiruv: ${problems.length} muammo${unknown ? `, ${unknown} tekshirib bo'lmadi` : ""}`,
    data: { counts, unknown, total: valid.length },
  }];
  const seenKeys = new Set<string>();
  for (const f of valid) {
    const key = securityKey(f.key);
    if (seenKeys.has(key)) continue; // bir kalitga bir nechta topilma — ServiceCheck bitta qator (birinchisi)
    seenKeys.add(key);
    const d = f.detail ?? {};
    rows.push({
      key, kind: "security", target: scrubSecrets(f.title).slice(0, 120), status: findingCheckStatus(f),
      message: typeof d.reason === "string" ? d.reason : `${f.severity}: ${f.title}`,
      data: { severity: f.severity, category: f.category, ...d },
    });
  }
  await upsertChecks(rows);

  // Hodisalar: faqat haqiqiy muammolar (INFO yoki detail.status OK/UNKNOWN — hodisa ochilmaydi).
  // Yopish: shu kalit OK qaytsa (INFO, detail.status "OK") yoki umuman qaytmasa — ketma-ket 2 skanerdan keyin.
  // UNKNOWN (vosita yo'q/huquq yetmadi) — na ochadi, na yopadi. AI hodisalari (source "ai") runAiAnalysis niki — tegilmaydi.
  const open = await control.incident.findMany({ where: { source: "security", status: { in: ["OPEN", "ACKED"] } } });
  const openByKey = new Map(open.map((i) => [i.key, i]));
  const statusByKey = new Map<string, CheckStatusT>();
  for (const f of valid) {
    const key = securityKey(f.key);
    if (!findingIsProblem(f)) { if (!statusByKey.has(key)) statusByKey.set(key, findingCheckStatus(f)); continue; }
    statusByKey.set(key, "CRIT");
    secOkStreak.set(key, 0);
    const detail = JSON.parse(scrubSecrets(JSON.stringify(f.detail ?? {}))) as Prisma.InputJsonValue;
    const suggested = (f.suggestedActions ?? []).filter((a) => validateAction(a.type, a.params ?? {}).ok) as unknown as Prisma.InputJsonValue;
    const title = scrubSecrets(f.title).slice(0, 300);
    const ex = openByKey.get(key);
    if (ex) {
      await control.incident.update({ where: { id: ex.id }, data: { count: { increment: 1 }, lastSeenAt: new Date(), severity: f.severity, title, detail, suggestedActions: suggested, category: f.category || "security" } });
    } else {
      const created = await control.incident.create({ data: { key, source: "security", category: f.category || "security", severity: f.severity, title, detail, suggestedActions: suggested } });
      openByKey.set(key, created);
    }
  }
  for (const inc of open) {
    const st = statusByKey.get(inc.key) ?? "OK"; // endi qaytarilmayapti — tuzalgan deb hisoblanadi
    if (st === "CRIT") continue;
    const d = decideIncident(true, secOkStreak.get(inc.key) ?? 0, st === "UNKNOWN" ? "UNKNOWN" : "OK");
    secOkStreak.set(inc.key, d.okStreak);
    if (d.op === "resolve") await resolveIncident(inc.id, inc.title, !!inc.notifiedAt);
  }
  return `${valid.length} tekshiruv, ${problems.length} muammo${problems.length ? ` (eng og'iri ${top})` : ""}${unknown ? `, ${unknown} UNKNOWN` : ""}`;
}

async function aiAnalysis(trigger: "scheduled" | "manual", requestedById?: string): Promise<string> {
  const mod = await loadSecurity();
  if (!mod) throw new Error(`xavfsizlik moduli ${secState === "absent" ? "hali o'rnatilmagan" : "yuklanmadi"}`);
  if (trigger === "scheduled") {
    if (TEST) return "test rejimi — rejali AI tahlil o'tkazib yuborildi";
    const last = await control.securityReport.findFirst({ where: { trigger: "scheduled" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (last && Date.now() - last.createdAt.getTime() < AI_MS - 60_000) return "oxirgi rejali tahlil yaqinda bo'lgan — o'tkazildi";
  }
  const res = await withTimeout(mod.runAiAnalysis(trigger, requestedById), 10 * 60_000, "runAiAnalysis");
  const id = res && typeof res === "object" && "id" in res ? String((res as { id: unknown }).id) : null;
  return id ? `hisobot ${id}` : "tahlil tugadi";
}

/* ───────────────────────── Hodisalar va ServiceCheck ───────────────────────── */

const okStreak = new Map<string, number>();

type PrevCheck = { status: string; changedAt: Date } | undefined;

async function upsertOne(r: CheckResult, p: PrevCheck, now: Date) {
  const message = r.message ? scrubSecrets(r.message).slice(0, 500) : null;
  const data = (r.data ? JSON.parse(scrubSecrets(JSON.stringify(r.data))) : undefined) as Prisma.InputJsonValue | undefined;
  const row = {
    kind: r.kind, target: r.target, tenantId: r.tenantId ?? null, status: r.status, message,
    latencyMs: r.latencyMs ?? null, data, checkedAt: now, changedAt: p && p.status === r.status ? p.changedAt : now,
  };
  await control.serviceCheck.upsert({ where: { key: r.key }, create: { key: r.key, ...row }, update: row });
  return { message, data };
}

/** Faqat ServiceCheck (hodisasiz) — xavfsizlik topilmalari uchun. */
async function upsertChecks(results: CheckResult[]) {
  if (!results.length) return;
  const now = new Date();
  const prev = new Map((await control.serviceCheck.findMany({ where: { key: { in: results.map((r) => r.key) } }, select: { key: true, status: true, changedAt: true } })).map((p) => [p.key, p]));
  for (const r of results) await upsertOne(r, prev.get(r.key), now);
}

async function applyChecks(results: CheckResult[], source: "monitor"): Promise<void> {
  if (!results.length) return;
  const now = new Date();
  const keys = results.map((r) => r.key);
  const prev = new Map((await control.serviceCheck.findMany({ where: { key: { in: keys } }, select: { key: true, status: true, changedAt: true } })).map((p) => [p.key, p]));
  const openList = await control.incident.findMany({ where: { key: { in: keys }, source, status: { in: ["OPEN", "ACKED"] } }, orderBy: { firstSeenAt: "desc" } });
  const open = new Map<string, (typeof openList)[number]>();
  for (const i of openList) if (!open.has(i.key)) open.set(i.key, i);

  for (const r of results) {
    const { message, data } = await upsertOne(r, prev.get(r.key), now);

    const inc = open.get(r.key);
    const d = decideIncident(!!inc, okStreak.get(r.key) ?? 0, r.status);
    okStreak.set(r.key, d.okStreak);
    const sev = severityFor(r.status, r.incident?.critSeverity);
    const title = scrubSecrets(r.incident?.title ?? `${r.target}: ${message ?? r.status}`).slice(0, 300);
    const detail = { status: r.status, target: r.target, message, data: data ?? null } as Prisma.InputJsonValue;
    const suggested = (r.incident?.suggestedActions ?? []) as unknown as Prisma.InputJsonValue;
    if (d.op === "open" && sev) {
      await control.incident.create({ data: { key: r.key, source, category: r.incident?.category ?? r.kind, severity: sev, title, detail, suggestedActions: suggested, tenantId: r.tenantId ?? null } });
    } else if (d.op === "update" && inc && sev) {
      await control.incident.update({ where: { id: inc.id }, data: { count: { increment: 1 }, lastSeenAt: now, severity: sev, title, detail, suggestedActions: suggested } });
    } else if (d.op === "resolve" && inc) {
      await resolveIncident(inc.id, inc.title, !!inc.notifiedAt);
    }
  }
}

async function resolveIncident(id: string, title: string, wasNotified: boolean) {
  await control.incident.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  log(`hodisa yopildi: ${title}`);
  if (wasNotified) await telegram(`[TIKLANDI] ${title} (${HOST})`);
}

/* ───────────────────────── Telegram ───────────────────────── */

const sentAt: number[] = [];
const TG_MAX_PER_HOUR = 30;
let tgWarned = false;

async function telegram(text: string): Promise<boolean> {
  if (!TG_TOKEN || !TG_CHAT) {
    if (!tgWarned) { log(TEST ? "test rejimi — Telegram o'chiq" : "Telegram sozlanmagan (ALERT_TG_BOT_TOKEN/ALERT_TG_CHAT_ID) — ogohlantirishlar faqat jurnalda"); tgWarned = true; }
    log(`(ALERT) ${text}`);
    return false;
  }
  const now = Date.now();
  while (sentAt.length && now - sentAt[0] > 3600_000) sentAt.shift();
  if (sentAt.length >= TG_MAX_PER_HOUR) { warnLog(`Telegram chegarasi (${TG_MAX_PER_HOUR}/soat) — xabar keyinroq: ${text}`); return false; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ chat_id: TG_CHAT, text: scrubSecrets(text).slice(0, 3500), disable_web_page_preview: true }),
    });
    if (!r.ok) { warnLog(`Telegram javobi ${r.status}`); return false; }
    sentAt.push(now);
    return true;
  } catch (e) { warnLog(`Telegram xabari yuborilmadi: ${errMsg(e)}`); return false; }
}

/** Yangi HIGH/CRITICAL hodisalar (monitor: kamida 2 marta ko'rilgan — restart paytidagi bir martalik xato emas). */
async function notifyIncidents() {
  if (!TG_TOKEN || !TG_CHAT) return;
  const list = await control.incident.findMany({
    where: { status: "OPEN", notifiedAt: null, severity: { in: ["HIGH", "CRITICAL"] }, OR: [{ source: { not: "monitor" } }, { count: { gte: 2 } }] },
    orderBy: { firstSeenAt: "asc" }, take: 5,
  });
  for (const i of list) {
    const tag = i.severity === "CRITICAL" ? "[KRITIK]" : "[XATO]";
    if (await telegram(`${tag} ${i.title} (${HOST})\nPanel: Monitoring → Hodisalar`)) {
      await control.incident.update({ where: { id: i.id }, data: { notifiedAt: new Date() } });
    } else break;
  }
}

/* ───────────────────────── Sikllar ───────────────────────── */

type LoopStat = { lastStart?: string; lastMs?: number; lastError?: string | null; runs: number; errors: number; summary?: string };
const stats: Record<string, LoopStat> = {};
const recentErrors: { at: string; loop: string; error: string }[] = [];

class Loop {
  private current: Promise<string> | null = null;
  private timer: NodeJS.Timeout | null = null;
  constructor(readonly name: string, readonly every: number, private readonly body: () => Promise<string>, readonly timeoutMs: number) {
    stats[name] = { runs: 0, errors: 0 };
  }
  /** Hozir ishga tushirish (allaqachon ishlayotgan bo'lsa — o'sha natijani kutish). Hech qachon reject qilmaydi. */
  run(): Promise<string> {
    if (this.current) return this.current;
    const st = stats[this.name];
    const t0 = Date.now();
    st.lastStart = new Date(t0).toISOString();
    this.current = withTimeout(this.body(), this.timeoutMs, this.name)
      .then((summary) => { st.lastError = null; st.summary = summary; return summary; })
      .catch((e) => {
        const m = scrubSecrets(errMsg(e));
        st.errors++; st.lastError = m;
        recentErrors.push({ at: new Date().toISOString(), loop: this.name, error: m });
        if (recentErrors.length > 10) recentErrors.shift();
        warnLog(`${this.name}: ${m}`);
        return `xato: ${m}`;
      })
      .finally(() => { st.runs++; st.lastMs = Date.now() - t0; this.current = null; });
    return this.current;
  }
  start(delay = 0) {
    const tick = async () => { if (stopping) return; await this.run(); if (!stopping) this.timer = setTimeout(tick, this.every); };
    this.timer = setTimeout(tick, delay);
  }
  stop() { if (this.timer) clearTimeout(this.timer); }
  wait() { return this.current ?? Promise.resolve(""); }
}

/** Tekshiruvlar to'plami: har biri alohida, parallel; birining xatosi qolganlarini to'xtatmaydi. */
async function collect(jobs: Record<string, () => Promise<CheckResult[]>>, timeoutMs: number): Promise<{ results: CheckResult[]; failed: string[] }> {
  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(names.map((n) => withTimeout(jobs[n](), timeoutMs, n)));
  const results: CheckResult[] = [];
  const failed: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") results.push(...s.value);
    else { failed.push(`${names[i]}: ${errMsg(s.reason)}`); warnLog(`${names[i]}: ${errMsg(s.reason)}`); }
  });
  return { results, failed };
}

function summarize(results: CheckResult[], failed: string[]) {
  const c = { OK: 0, WARN: 0, CRIT: 0, UNKNOWN: 0 };
  for (const r of results) c[r.status]++;
  return `${results.length} tekshiruv: ${c.OK} OK, ${c.WARN} WARN, ${c.CRIT} CRIT, ${c.UNKNOWN} UNKNOWN${failed.length ? `; ${failed.length} ta qadam xato` : ""}`;
}

async function fastBody(): Promise<string> {
  const active = await activeTenants();
  const all = await tenants();
  const { results, failed } = await collect({
    host: hostSnapshot,
    units: () => unitChecks(active),
    http: () => httpChecks(active),
    postgres: () => postgresChecks(all),
  }, 12_000);
  await applyChecks(results, "monitor");
  await notifyIncidents();
  return summarize(results, failed);
}

async function slowBody(): Promise<string> {
  const active = await activeTenants();
  const domains = [...new Set([...active.map((t) => t.domain).filter((d): d is string => !!d), ...SSL_DOMAINS])];
  const { results, failed } = await collect({
    ssl: async () => (await Promise.allSettled(domains.map((d) => sslCheck(d)))).flatMap((s) => (s.status === "fulfilled" ? [s.value] : [])),
    backup: async () => [await backupCheck()],
    journal: () => journalChecks(active),
    reboot: async () => [await rebootCheck()],
  }, 30_000);
  await applyChecks(results, "monitor");
  let sec = "";
  try { sec = await securityScan(); } catch (e) { failed.push(`security: ${errMsg(e)}`); warnLog(`security: ${errMsg(e)}`); }
  await notifyIncidents();
  return `${summarize(results, failed)}; xavfsizlik: ${sec || "xato"}`;
}

async function retentionBody(): Promise<string> {
  const d7 = new Date(Date.now() - 7 * 864e5);
  const d90 = new Date(Date.now() - 90 * 864e5);
  const h1 = new Date(Date.now() - 3600_000);
  const [snap, inc, act] = await Promise.all([
    control.hostSnapshot.deleteMany({ where: { takenAt: { lt: d7 } } }),
    control.incident.deleteMany({ where: { status: "RESOLVED", resolvedAt: { lt: d90 } } }),
    control.agentAction.deleteMany({ where: { requestedAt: { lt: d90 }, status: { in: ["DONE", "FAILED", "REJECTED"] } } }),
  ]);
  // Endi tekshirilmaydigan kalitlar (o'chirilgan korxona, olib tashlangan domen): ServiceCheck o'chadi, ochiq hodisa yopiladi
  const stale = await control.serviceCheck.findMany({ where: { checkedAt: { lt: h1 } }, select: { key: true } });
  if (stale.length) {
    const keys = stale.map((s) => s.key);
    await control.incident.updateMany({ where: { key: { in: keys }, source: "monitor", status: { in: ["OPEN", "ACKED"] } }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    await control.serviceCheck.deleteMany({ where: { key: { in: keys } } });
  }
  return `o'chirildi: ${snap.count} surat, ${inc.count} hodisa, ${act.count} amal, ${stale.length} eskirgan tekshiruv`;
}

const fast = new Loop("fast", FAST_MS, fastBody, 40_000);
const slow = new Loop("slow", SLOW_MS, slowBody, 4 * 60_000);
const ai = new Loop("ai", AI_MS, () => aiAnalysis("scheduled"), 11 * 60_000);
const retention = new Loop("retention", RETENTION_MS, retentionBody, 5 * 60_000);

/* Baza statistikasi va nginx trafik (scripts/agent/dbtraffic.ts) — o'z sikllari, xavfsizlik skaneriga bog'liq emas */
async function dbtCtx(): Promise<DbtCtx> {
  const ecoPort = ECO_URL ? Number(/:(\d{2,5})\//.exec(ECO_URL)?.[1]) || null : null;
  return { control, tenants: await tenants(), appDir: APP_DIR, controlPort: CONTROL_PORT, ecoPort, linux: LINUX, log };
}
async function dbtBody(job: (c: DbtCtx) => Promise<CheckResult[]>, name: string, timeoutMs: number): Promise<string> {
  const { results, failed } = await collect({ [name]: async () => job(await dbtCtx()) }, timeoutMs);
  await applyChecks(results, "monitor");
  await notifyIncidents();
  return summarize(results, failed);
}
const dbStats = new Loop("dbstats", SLOW_MS, () => dbtBody(dbStatsChecks, "dbstats", 90_000), 2 * 60_000);
const traffic = new Loop("traffic", TRAFFIC_MS, () => dbtBody(trafficChecks, "traffic", 60_000), 90_000);

/* ───────────────────────── Heartbeat va qulf ───────────────────────── */

async function ensureLock(): Promise<boolean> {
  const [held] = await lockDb.$queryRaw<{ held: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
                   AND ((classid::bigint << 32) | objid::bigint) = ${LOCK_KEY}::bigint) AS held`;
  if (held?.held) return true;
  const [r] = await lockDb.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_KEY}::bigint) AS ok`;
  return !!r?.ok;
}

async function heartbeat() {
  if (!(await ensureLock())) {
    warnLog("boshqa insof-agent nusxasi qulfni oldi — bu nusxa to'xtaydi");
    void shutdown("qulf yo'qotildi", 1);
    return;
  }
  const version = releaseVersion() ?? "dev";
  const info = {
    pid: process.pid, platform: process.platform, linux: LINUX, systemd: systemdOk, testMode: TEST,
    security: secState, telegram: !!(TG_TOKEN && TG_CHAT), appDir: APP_DIR,
    loops: stats, errors: recentErrors, runningActions: [...runningActions.values()],
  } as Prisma.InputJsonValue;
  const now = new Date();
  await control.agentHeartbeat.upsert({
    where: { id: "main" },
    create: { id: "main", hostname: HOST, version, startedAt: STARTED_AT, lastSeenAt: now, info },
    update: { hostname: HOST, version, startedAt: STARTED_AT, lastSeenAt: now, info },
  });
  await applyChecks([{ key: checkKey.agent(), kind: "agent", target: "insof-agent", status: "OK", message: `${version}, pid ${process.pid}` }], "monitor");
}
const hb = new Loop("heartbeat", FAST_MS, async () => { await heartbeat(); return "ok"; }, 15_000);

/* ───────────────────────── Amallar (AgentAction) ───────────────────────── */

const runningActions = new Map<string, string>(); // id → type
const MAX_PARALLEL_ACTIONS = 3;
const PRIVILEGED: ActionType[] = ["RESTART_UNIT", "RELOAD_NGINX", "RUN_BACKUP", "RENEW_CERT", "BLOCK_IP", "UNBLOCK_IP"];

// RUNNING — ajratilgan jarayon (DEPLOY/ROLLBACK) boshlandi, yakunini devopsTick yozadi; limit — chiqish chegarasi (LOG_TAIL 64 KB)
type ActionOutcome = { status: "DONE" | "FAILED" | "REJECTED" | "RUNNING"; output: string; limit?: number };

function fmt(cmd: string[], r: RunResult): string {
  const head = `$ ${cmd.join(" ")}\n`;
  const tail = r.timedOut ? "\n(vaqt tugadi — to'xtatildi)" : r.missing ? "\n(buyruq topilmadi)" : `\n(chiqish kodi ${r.code ?? r.signal})`;
  return head + r.out.trim() + tail;
}

async function sudo(args: string[], timeoutMs: number): Promise<{ ok: boolean; text: string }> {
  const r = await run(BIN.sudo, ["-n", ...args], { timeoutMs });
  let text = fmt(["sudo", "-n", ...args], r);
  if (/a password is required|may not run sudo|not allowed to execute/i.test(r.out)) {
    text += "\nsudoers ruxsati yo'q — docs/deploy/sudoers-insof-agent ni o'rnating (visudo -c).";
  }
  return { ok: r.code === 0, text };
}

async function afterRestart(unit: string): Promise<string> {
  const lines: string[] = [];
  const slug = unit.startsWith("insof-erp@") ? unit.slice("insof-erp@".length) : null;
  const t = slug ? (await tenants()).find((x) => x.slug === slug) : null;
  const port = t ? t.port : unit === "insof-control" ? CONTROL_PORT : null;
  const url = port ? `http://127.0.0.1:${port}/api/health` : unit === "insof-eco" && ECO_URL ? ECO_URL : null;
  let ok = false;
  for (let i = 0; i < 20 && !stopping; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const info = (await showUnits([unit]).catch(() => null))?.[0];
    const h = url ? await httpCheck(url) : null;
    if (info?.activeState === "active" && (!h || h.status === 200)) {
      lines.push(`Keyin: ${info.activeState}/${info.subState}${h ? `, health 200 (${h.ms} ms)` : ""}`);
      ok = true; break;
    }
    if (i === 19) lines.push(`Keyin (60 s): ${info ? `${info.activeState}/${info.subState}` : "holat noma'lum"}${h ? `, health ${h.status ?? h.error}` : ""}`);
  }
  void fast.run(); // ServiceCheck darhol yangilansin
  return (ok ? "" : "⚠ ") + lines.join("\n");
}

async function fixSecretPerms(): Promise<string> {
  const files = [path.join(APP_DIR, "control.env"), path.join(APP_DIR, "build.env")];
  const tdir = path.join(APP_DIR, "tenants");
  try { for (const f of await readdir(tdir)) if (f.endsWith(".env")) files.push(path.join(tdir, f)); } catch { /* papka yo'q */ }
  const lines: string[] = [];
  let changed = 0, failed = 0;
  const fix = async (p: string, want: number) => {
    const rel = path.relative(APP_DIR, p) || p;
    let st;
    try { st = await stat(p); } catch { return; }
    const mode = st.mode & 0o777;
    if (mode === want) { lines.push(`${rel}: ${want.toString(8)} (to'g'ri)`); return; }
    try { await chmod(p, want); changed++; lines.push(`${rel}: ${mode.toString(8)} → ${want.toString(8)}`); }
    catch (e) { failed++; lines.push(`${rel}: ${mode.toString(8)} — o'zgartirib bo'lmadi (${(e as NodeJS.ErrnoException).code ?? errMsg(e)})`); }
  };
  for (const f of files) await fix(f, 0o600);
  await fix(tdir, 0o700);
  lines.unshift(`${changed} ta o'zgartirildi${failed ? `, ${failed} ta xato` : ""}`);
  if (failed) throw new Error(lines.join("\n"));
  return lines.join("\n");
}

async function execute(type: ActionType, params: ActionParams, requestedById: string | null): Promise<ActionOutcome> {
  if (TEST && PRIVILEGED.includes(type)) return { status: "FAILED", output: `[test-mode] ${type} test rejimida bajarilmaydi (sudo/tizim buyruqlari)` };
  if (isDbActionType(type)) {
    const r = await executeDbAction(type, { db: params.db!, pid: params.pid, table: params.table }, await dbtCtx());
    void dbStats.run(); // sahifa darhol yangilansin
    return r;
  }
  switch (type) {
    case "RESTART_UNIT": {
      const unit = params.unit!;
      const r = await sudo([BIN.systemctl, "restart", unit], 120_000);
      if (!r.ok) return { status: "FAILED", output: r.text };
      return { status: "DONE", output: `${r.text}\n${await afterRestart(unit)}` };
    }
    case "RELOAD_NGINX": {
      const t = await sudo([BIN.nginx, "-t"], 30_000);
      if (!t.ok) return { status: "FAILED", output: `${t.text}\nnginx sozlamasida xato — reload qilinmadi` };
      const r = await sudo([BIN.systemctl, "reload", "nginx"], 60_000);
      return { status: r.ok ? "DONE" : "FAILED", output: `${t.text}\n${r.text}` };
    }
    case "RUN_BACKUP": {
      const script = path.join(APP_DIR, "scripts", "server-backup.sh");
      if (!existsSync(script)) return { status: "FAILED", output: `${script} topilmadi` };
      const env = { ...CHILD_ENV, ...(process.env.BACKUP_ENV ? { BACKUP_ENV: process.env.BACKUP_ENV } : {}) };
      const r = await run(BIN.bash, [script], { timeoutMs: 3 * 3600_000, cwd: APP_DIR, env });
      void slow.run();
      return { status: r.code === 0 ? "DONE" : "FAILED", output: fmt(["bash", "scripts/server-backup.sh"], r) };
    }
    case "RENEW_CERT": {
      const c = await sudo([BIN.certbot, "renew", "--quiet"], 10 * 60_000);
      if (!c.ok) return { status: "FAILED", output: c.text };
      const t = await sudo([BIN.nginx, "-t"], 30_000);
      if (!t.ok) return { status: "FAILED", output: `${c.text}\n${t.text}` };
      const r = await sudo([BIN.systemctl, "reload", "nginx"], 60_000);
      void slow.run();
      return { status: r.ok ? "DONE" : "FAILED", output: [c.text, t.text, r.text].join("\n") };
    }
    case "FIX_SECRET_PERMS":
      return { status: "DONE", output: await fixSecretPerms() };
    case "BLOCK_IP": {
      const r = await sudo([BIN.ufw, "insert", "1", "deny", "from", params.ip!], 30_000);
      return { status: r.ok ? "DONE" : "FAILED", output: r.text };
    }
    case "UNBLOCK_IP": {
      const r = await sudo([BIN.ufw, "delete", "deny", "from", params.ip!], 30_000);
      return { status: r.ok ? "DONE" : "FAILED", output: r.text };
    }
    case "RUN_HEALTH_CHECK": {
      const [a, b, c, d] = await Promise.all([fast.run(), slow.run(), dbStats.run(), traffic.run()]);
      const failed = a.startsWith("xato") || b.startsWith("xato");
      return { status: failed ? "FAILED" : "DONE", output: `15 s tekshiruvlar: ${a}\n5 daq tekshiruvlar: ${b}\nPostgres statistikasi: ${c}\nNginx trafik: ${d}` };
    }
    case "RUN_SECURITY_SCAN": {
      const s = await withTimeout(securityScan(), 4 * 60_000, "security");
      return { status: secState === "loaded" ? "DONE" : "FAILED", output: `Xavfsizlik skaneri: ${s}` };
    }
    case "RUN_AI_ANALYSIS":
      return { status: "DONE", output: await aiAnalysis("manual", requestedById ?? undefined) };
    default:
      return { status: "REJECTED", output: `${type}: bajaruvchi yo'q` };
  }
}

async function processAction(a: { id: string; type: string; params: Prisma.JsonValue; requestedById: string | null }) {
  runningActions.set(a.id, a.type);
  let outcome: ActionOutcome;
  const v = validateAction(a.type, a.params);
  if (!v.ok) {
    outcome = { status: "REJECTED", output: v.reason };
  } else {
    log(`amal: ${v.type} ${JSON.stringify(v.params)} (${a.id})`);
    try { outcome = isDevopsAction(v.type) ? await devopsExecute(a.id, v.type, v.params) : await execute(v.type, v.params, a.requestedById); }
    catch (e) { outcome = { status: "FAILED", output: e instanceof Error ? e.message : String(e) }; }
  }
  try {
    if (outcome.status === "RUNNING") await control.agentAction.updateMany({ where: { id: a.id, status: "RUNNING" }, data: { output: trimOutput(outcome.output) } });
    else await control.agentAction.update({ where: { id: a.id }, data: { status: outcome.status, finishedAt: new Date(), output: trimOutput(outcome.output, outcome.limit) } });
  } catch (e) { warnLog(`amal natijasini yozib bo'lmadi (${a.id}): ${errMsg(e)}`); }
  log(`amal ${a.type} → ${outcome.status}`);
  runningActions.delete(a.id);
}

async function actionsBody(): Promise<string> {
  if (runningActions.size >= MAX_PARALLEL_ACTIONS) return "band";
  const pending = await control.agentAction.findMany({ where: { status: "PENDING" }, orderBy: { requestedAt: "asc" }, take: 10 });
  let started = 0;
  for (const a of pending) {
    if (stopping || runningActions.size >= MAX_PARALLEL_ACTIONS) break;
    // Bir turdagi amal bir vaqtda bittadan (ikki RUN_BACKUP yoki ikki restart parallel ketmasin)
    if ([...runningActions.values()].includes(a.type)) continue;
    // Atomar olish: boshqa jarayon (yoki takroriy so'rov) bir amalni ikki marta bajarmasin
    const claim = await control.agentAction.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date() } });
    if (claim.count !== 1) continue;
    started++;
    void processAction(a);
  }
  return `${started} ta boshlandi`;
}
const actions = new Loop("actions", ACTION_POLL_MS, actionsBody, 30_000);
/** DevOps: ishlayotgan deploy logi/yakuni, relizlar holati (scripts/agent/devops.ts). */
const devops = new Loop("devops", ACTION_POLL_MS, devopsTick, 120_000);

/* ───────────────────────── Ishga tushirish va to'xtatish ───────────────────────── */

let shuttingDown = false;
async function shutdown(reason: string, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true; stopping = true;
  log(`to'xtatilmoqda (${reason})`);
  for (const l of [fast, slow, ai, retention, hb, actions, devops, dbStats, traffic]) l.stop();
  for (const c of running) c.kill("SIGTERM");
  await Promise.race([
    Promise.allSettled([fast.wait(), slow.wait(), hb.wait(), actions.wait(), dbStats.wait(), traffic.wait()]),
    new Promise((r) => setTimeout(r, 10_000)),
  ]);
  try {
    if (runningActions.size) {
      await control.agentAction.updateMany({ where: { id: { in: [...runningActions.keys()] }, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date(), output: "agent to'xtatildi — amal yakunlanmadi" } });
    }
    await control.agentHeartbeat.update({ where: { id: "main" }, data: { lastSeenAt: new Date(), info: { stopped: true, reason, at: new Date().toISOString(), loops: stats } as Prisma.InputJsonValue } }).catch(() => {});
  } catch { /* baza yo'q bo'lsa ham chiqamiz */ }
  await Promise.allSettled([control?.$disconnect(), lockDb?.$disconnect(), closeDbClients()]);
  log("to'xtadi");
  process.exit(code);
}

async function main() {
  if (!process.env.CONTROL_DATABASE_URL?.trim()) {
    console.error(`[agent] CONTROL_DATABASE_URL yo'q (${ENV_FILE}) — CONTROL_ENV_FILE=/var/www/insof-erp/control.env bilan ishga tushiring`);
    process.exit(2);
  }
  const db = await import("@/lib/control/db");
  control = db.control as unknown as PrismaClient;
  releaseVersion = (await import("@/lib/control/release")).releaseVersion;
  const { PrismaClient: Client } = await import("@/generated/control");
  const lockUrl = new URL(process.env.CONTROL_DATABASE_URL);
  lockUrl.searchParams.set("connection_limit", "1");
  lockDb = new Client({ datasourceUrl: lockUrl.toString(), log: ["error"] });

  if (!(await ensureLock())) {
    console.error("[agent] boshqa insof-agent allaqachon ishlayapti (pg advisory lock band) — chiqildi");
    await Promise.allSettled([control.$disconnect(), lockDb.$disconnect()]);
    process.exit(3);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (e) => warnLog(`unhandledRejection: ${errMsg(e)}`));
  process.on("uncaughtException", (e) => warnLog(`uncaughtException: ${errMsg(e)}`));

  // Oldingi nusxa amal o'rtasida o'lgan bo'lsa — RUNNING qolib ketmasin
  // DEPLOY/ROLLBACK bundan mustasno: ular ajratilgan jarayonda davom etadi, natijani devopsTick yakunlaydi
  const stuck = await control.agentAction.updateMany({ where: { status: "RUNNING", type: { notIn: [...DETACHED_ACTIONS] } }, data: { status: "FAILED", finishedAt: new Date(), output: "agent qayta ishga tushdi — natija noma'lum" } });
  if (stuck.count) warnLog(`${stuck.count} ta yakunlanmagan amal FAILED deb belgilandi`);

  initDevops({
    control, appDir: APP_DIR, linux: LINUX, test: TEST, childEnv: CHILD_ENV, hasSystemd, releaseVersion: () => releaseVersion(), log, warn: warnLog,
    requestSelfRestart: (reason) => void shutdown(reason, 0),
  });
  log(`ishga tushdi: ${HOST}, versiya ${releaseVersion() ?? "dev"}, APP_DIR=${APP_DIR}, linux=${LINUX}, systemd=${await hasSystemd()}, test=${TEST}`);
  await heartbeat().catch((e) => warnLog(`heartbeat: ${errMsg(e)}`));
  hb.start(FAST_MS);
  fast.start(0);
  actions.start(500);
  devops.start(2_000);
  slow.start(5_000);
  retention.start(60_000);
  traffic.start(10_000);
  dbStats.start(20_000);
  ai.start(10 * 60_000); // ishga tushgandan 10 daqiqa keyin (oxirgi rejali hisobot 6 soatdan eski bo'lsa)
}

main().catch((e) => { console.error(`[agent] ishga tushmadi: ${scrubSecrets(errMsg(e))}`); process.exit(1); });

