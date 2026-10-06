/**
 * insof-agent: infratuzilma moduli — zaxira nusxalar inventari, server tizimi holati va infra amallari.
 * scripts/insof-agent.ts uni `createInfra(deps)` bilan ulaydi: sekin siklda `collect()` (ServiceCheck: backup:inventory,
 * host:system), amallar navbatida `execute()` (RUN_RESTORE_TEST, REBOOT, REBOOT_CANCEL, CLEAN_RELEASES, JOURNAL_VACUUM, TENANT_UP).
 *
 * Qoidalar (docs/deploy/PLATFORMA.md → «Infratuzilma»): buyruqlar shell'siz, to'liq yo'l, `sudo -n` faqat sudoers'dagi aniq
 * shakl bilan; root bilan ishlaydigan skript faqat root egaligidagi /usr/local/sbin/insof-tenant-up (repo'dan EMAS).
 * Og'ir o'lchovlar (du, apt, rclone) keshlanadi — har 5 daqiqada emas, 30–60 daqiqada bir marta.
 */
import { existsSync } from "node:fs";
import { appendFile, open, readdir, readFile, realpath, rm, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@/generated/control";
import { BACKUP_DIR_RE, scrubSecrets } from "@/lib/control/monitor/parse";
import type { CheckResult, CheckStatusT } from "@/lib/control/monitor/types";
import {
  INFRA_PRIVILEGED, JOURNAL_KEEP, REBOOT_AT_RE, domainAllowed, domainPolicyFromEnv, infraKey, isInfraActionType, rebootWhen,
  type BackupCopy, type BackupInventory, type DirUsage, type InfraActionType, type ReleaseInfo, type RemoteInfo, type RunLog, type SystemInfo,
} from "@/lib/control/infra/contract";
import {
  BACKUP_FAIL_RE, BACKUP_OK_RE, RELEASE_NAME_RE, RESTORE_FAIL_RE, RESTORE_OK_RE, forecastDisk, lastRun, parseAutoUpgrades, parseDu,
  parseJournalDiskUsage, parseOsRelease, parseRcloneAbout, parseRcloneLsf, parseShutdownScheduled, parseTenantUpResult, pendingKernel,
  releasesToClean, stampToIso,
} from "@/lib/control/infra/parse";
import { parseAptUpgradable } from "@/lib/control/security/parsers";
import { run as execRun } from "@/lib/control/security/exec";
import { cached } from "@/lib/control/security/util";
import { readEnvKeys } from "../env";
import { deployBusy } from "./devops";

export { INFRA_PRIVILEGED, isInfraActionType };

type RunResult = { code: number | null; signal: string | null; out: string; timedOut: boolean; missing: boolean };

export type InfraDeps = {
  control: PrismaClient;
  run: (file: string, args: string[], opt: { timeoutMs: number; cwd?: string; env?: Record<string, string> }) => Promise<RunResult>;
  sudo: (args: string[], timeoutMs: number) => Promise<{ ok: boolean; text: string }>;
  fmt: (cmd: string[], r: RunResult) => string;
  telegram: (text: string) => Promise<boolean>;
  log: (msg: string) => void;
  linux: boolean;
  test: boolean;
  hasSystemd: () => Promise<boolean>;
  appDir: string;
  backupDir: string;
  backupEnv: string;
  backupLog: string;
  restoreLog: string;
  childEnv: Record<string, string>;
  host: string;
  bin: { systemctl: string; journalctl: string; bash: string };
  /** Hozir bajarilayotgan amal turlari */
  runningTypes: () => string[];
  /** Amaldan keyin: korxonalar keshi / tekshiruvlarni yangilash */
  afterChange: (what: "tenants" | "checks") => void;
  /** Server qancha vaqtdan beri ishlayapti, soniya (standart os.uptime; sinovda almashtiriladi) */
  uptimeSec?: () => number;
};

/** REBOOT cheklovlari: server yangi yuklangan bo'lsa yoki yaqinda qayta yuklash rejalashtirilgan bo'lsa — rad. */
export const REBOOT_MIN_UPTIME_SEC = 30 * 60;
export const REBOOT_COOLDOWN_MS = 3600_000;

type Outcome = { status: "DONE" | "FAILED" | "REJECTED"; output: string };

const BIN_SHUTDOWN = "/usr/sbin/shutdown";
const BIN_DU = "/usr/bin/du";
/** Root egaligidagi nusxa (scripts/tenant-up.sh dan `install -o root -m 755`) — repo'dagi fayl sudo bilan chaqirilmaydi. */
export const TENANT_UP_BIN = "/usr/local/sbin/insof-tenant-up";
const RCLONE_BINS = ["/usr/bin/rclone", "/usr/local/bin/rclone", "/opt/homebrew/bin/rclone"];
const REMOTE_TTL = 30 * 60_000;
const DU_TTL = 30 * 60_000;
const short = (name: string) => (name.length > 16 ? name.slice(0, 12) : name);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);
const toIso = (local: string | null) => {
  if (!local) return null;
  const t = new Date(local).getTime(); // server mahalliy vaqti (Asia/Tashkent) → UTC ISO
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

async function readText(file: string): Promise<string | null> {
  try { return await readFile(file, "utf8"); } catch { return null; }
}

/** Faylning oxirgi `bytes` bayti (katta loglar to'liq o'qilmaydi). */
async function tail(file: string, bytes = 64 * 1024): Promise<string | null> {
  try {
    const fh = await open(file, "r");
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, bytes);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const s = buf.toString("utf8");
      return len < size ? s.slice(s.indexOf("\n") + 1) : s;
    } finally { await fh.close(); }
  } catch { return null; }
}

/**
 * Log/tashqi matnlar: sirlar yashiriladi va JSON'da qochiriladigan belgilar (" \ boshqaruv belgilari) almashtiriladi —
 * agentning upsertOne'i sirlarni JSON matni ustida qayta tozalaydi; qochirilgan qo'shtirnoq (\") yonida bu JSON'ni buzishi mumkin edi.
 */
export function cleanText(s: string): string {
  return scrubSecrets(s).replace(/[\u0000-\u001f\u007f\\"]/g, (ch) => (ch === '"' ? "'" : ch === "\\" ? "/" : " "));
}
export function sanitizeDeep(v: unknown): unknown {
  if (typeof v === "string") return cleanText(v);
  if (Array.isArray(v)) return v.map(sanitizeDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitizeDeep(x)]));
  return v;
}

function normRun(r: RunLog): RunLog {
  return { ...r, at: toIso(r.at) };
}

export function createInfra(d: InfraDeps) {
  /* ───────────── Zaxira inventari ───────────── */

  const backupCfg = () => readEnvKeys(d.backupEnv, ["OFFSITE", "OFFSITE_DIR", "RCLONE_REMOTE", "RCLONE_CONFIG", "KEEP_DAYS"]);

  async function listCopies(): Promise<{ copies: BackupCopy[]; partial: { name: string; mtimeMs: number }[] } | null> {
    let names: string[];
    try { names = await readdir(d.backupDir); } catch { return null; }
    const dirs = names.filter((n) => BACKUP_DIR_RE.test(n)).sort().reverse().slice(0, 60);
    const copies = await Promise.all(dirs.map(async (name): Promise<BackupCopy> => {
      const dir = path.join(d.backupDir, name);
      const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const files: { name: string; bytes: number }[] = [];
      for (const e of ents) {
        if (!e.isFile()) continue;
        const st = await stat(path.join(dir, e.name)).catch(() => null);
        if (st) files.push({ name: e.name, bytes: st.size });
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      return {
        name, at: toIso(stampToIso(name)), bytes: files.reduce((s, f) => s + f.bytes, 0),
        files: files.slice(0, 40), sha256sums: files.some((f) => f.name === "SHA256SUMS"), remote: null,
      };
    }));
    const partial = await Promise.all(names.filter((n) => n.endsWith(".partial")).map(async (name) => ({ name, mtimeMs: (await stat(path.join(d.backupDir, name)).catch(() => null))?.mtimeMs ?? 0 })));
    return { copies, partial };
  }

  let remoteCache: { at: number; key: string; value: RemoteInfo } | null = null;

  async function remoteInfo(cfg: Record<string, string>): Promise<RemoteInfo> {
    const kind = (cfg.OFFSITE || "none").trim();
    const base: RemoteInfo = { kind, target: null, ok: null, error: null, checkedAt: null, copies: [], latest: null, quota: null };
    if (kind === "none") return { ...base, ok: false, error: "OFFSITE=none — nusxa faqat shu serverda (disk yonsa ikkalasi ketadi)" };
    if (kind === "restic") return { ...base, target: "restic", error: "restic ombori panelda tekshirilmaydi (restic snapshots — qo'lda)" };
    if (kind === "local") {
      const dir = cfg.OFFSITE_DIR ?? "";
      if (!dir.startsWith("/")) return { ...base, ok: false, error: "OFFSITE_DIR berilmagan" };
      try {
        const copies = (await readdir(dir)).filter((n) => BACKUP_DIR_RE.test(n)).sort();
        return { ...base, target: dir, ok: true, checkedAt: new Date().toISOString(), copies: copies.slice(-60), latest: copies.at(-1) ?? null };
      } catch (e) { return { ...base, target: dir, ok: false, checkedAt: new Date().toISOString(), error: `${dir}: ${errMsg(e)}` }; }
    }
    if (kind !== "rclone") return { ...base, ok: false, error: `OFFSITE noma'lum: ${kind}` };

    const remote = (cfg.RCLONE_REMOTE ?? "").trim();
    // Masofa nomi argv'ga tushadi: "-" bilan boshlanmasin (opsiya sifatida o'qilmasin), bo'sh joysiz
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*:\S*$/.test(remote)) return { ...base, ok: false, error: "RCLONE_REMOTE berilmagan yoki noto'g'ri (backup.env)" };
    const key = `${remote}|${cfg.RCLONE_CONFIG ?? ""}`;
    if (remoteCache && remoteCache.key === key && Date.now() - remoteCache.at < REMOTE_TTL) return remoteCache.value;
    if (d.test) return { ...base, target: remote, error: "test rejimi — masofa tekshirilmaydi" };
    const bin = RCLONE_BINS.find((p) => existsSync(p));
    if (!bin) return { ...base, target: remote, ok: false, error: "rclone o'rnatilmagan (sudo apt install rclone)" };
    const env = { ...d.childEnv, ...(cfg.RCLONE_CONFIG?.startsWith("/") ? { RCLONE_CONFIG: cfg.RCLONE_CONFIG } : {}) };
    const now = new Date().toISOString();
    const ls = await d.run(bin, ["lsf", "--dirs-only", "--max-depth", "1", "--", remote], { timeoutMs: 90_000, env });
    let value: RemoteInfo;
    if (ls.code !== 0) {
      const line = ls.out.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !/^NOTICE/.test(l)).at(-1) ?? "";
      value = { ...base, target: remote, ok: false, checkedAt: now, error: ls.timedOut ? "rclone lsf: vaqt tugadi (90 s)" : `rclone lsf xato: ${line.slice(0, 200) || `kod ${ls.code}`}` };
    } else {
      const copies = parseRcloneLsf(ls.out);
      const ab = await d.run(bin, ["about", "--json", "--", remote.replace(/:.*$/, ":")], { timeoutMs: 60_000, env });
      value = { ...base, target: remote, ok: true, checkedAt: now, copies: copies.slice(-60), latest: copies.at(-1) ?? null, quota: ab.code === 0 ? parseRcloneAbout(ab.out) : null };
    }
    remoteCache = { at: Date.now(), key, value };
    return value;
  }

  async function backupInventory(): Promise<CheckResult> {
    const base = { key: infraKey.backup(), kind: "backup", target: "Zaxira inventari" };
    const cfg = backupCfg();
    const keepDays = Math.max(1, Math.min(365, Number(cfg.KEEP_DAYS) || 14));
    const listed = await listCopies();
    const [bl, rl] = await Promise.all([tail(d.backupLog), tail(d.restoreLog)]);
    const lastBackup = normRun(lastRun(bl ?? "", BACKUP_OK_RE, BACKUP_FAIL_RE));
    const lastRestoreTest = normRun(lastRun(rl ?? "", RESTORE_OK_RE, RESTORE_FAIL_RE));
    const remote = await remoteInfo(cfg).catch((e): RemoteInfo => ({ kind: cfg.OFFSITE || "none", target: null, ok: false, error: errMsg(e), checkedAt: new Date().toISOString(), copies: [], latest: null, quota: null }));

    if (!listed) {
      const inv: BackupInventory = { dir: d.backupDir, copies: [], partial: [], lastBackup, lastRestoreTest, remote, disk: null, problems: [`${d.backupDir} yo'q yoki o'qib bo'lmaydi`] };
      return { ...base, status: d.linux ? "WARN" : "UNKNOWN", message: inv.problems[0], data: inv as unknown as Record<string, unknown>, incident: { category: "backup", title: "Zaxira papkasi o'qilmadi" } };
    }
    const remoteSet = new Set(remote.copies);
    const copies = listed.copies.map((c) => ({ ...c, remote: remote.ok ? remoteSet.has(c.name) : null }));

    let disk: BackupInventory["disk"] = null;
    try {
      const s = await statfs(d.backupDir);
      const total = s.blocks * s.bsize, used = (s.blocks - s.bfree) * s.bsize, avail = s.bavail * s.bsize;
      const since = new Date(Date.now() - 7 * 864e5);
      const [first, last] = await Promise.all([
        d.control.hostSnapshot.findFirst({ where: { takenAt: { gte: since } }, orderBy: { takenAt: "asc" }, select: { takenAt: true, diskUsed: true } }),
        d.control.hostSnapshot.findFirst({ orderBy: { takenAt: "desc" }, select: { takenAt: true, diskUsed: true } }),
      ]);
      const history = [first, last].filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ at: x.takenAt.getTime(), used: Number(x.diskUsed) }));
      disk = forecastDisk({ mount: d.backupDir, total, used, avail, copies, keepDays, history });
    } catch { /* statfs yo'q */ }

    const problems: string[] = [];
    let status: CheckStatusT = "OK";
    const warn = (m: string) => { problems.push(m); if (status === "OK") status = "WARN"; };
    if (lastBackup.status === "FAILED") warn(`oxirgi zaxira XATO bilan tugagan (${lastBackup.summary ?? ""})`);
    if (lastRestoreTest.status === "FAILED") warn("oxirgi tiklash sinovi muvaffaqiyatsiz");
    else if (lastRestoreTest.status === "UNKNOWN" && !rl) warn("tiklash sinovi logi yo'q — sinov hali o'tkazilmagan");
    else if (lastRestoreTest.at && Date.now() - new Date(lastRestoreTest.at).getTime() > 8 * 864e5) warn("tiklash sinovi 8 kundan beri o'tkazilmagan");
    if (remote.ok === false) warn(`masofadagi nusxa: ${remote.error}`);
    const latest = copies[0];
    if (remote.ok && latest && !latest.remote && latest.at && Date.now() - new Date(latest.at).getTime() > 3 * 3600_000) warn(`oxirgi nusxa (${latest.name}) masofada yo'q`);
    if (latest && !latest.sha256sums) warn(`${latest.name}: SHA256SUMS yo'q`);
    const stale = listed.partial.filter((p) => Date.now() - p.mtimeMs > 6 * 3600_000);
    if (stale.length) warn(`tugallanmagan nusxa: ${stale.map((p) => p.name).join(", ")}`);
    if (disk?.daysToFull != null && disk.daysToFull < 14) {
      warn(`disk ~${disk.daysToFull} kunda to'ladi`);
      if (disk.daysToFull < 3) status = "CRIT";
    }
    if (!copies.length) warn("hali birorta nusxa yo'q");

    const inv: BackupInventory = { dir: d.backupDir, copies, partial: listed.partial.map((p) => p.name), lastBackup, lastRestoreTest, remote, disk, problems };
    return {
      ...base, status,
      message: `${copies.length} ta mahalliy nusxa${remote.ok ? `, masofada ${remote.copies.length}` : ""}${problems.length ? ` — ${problems.join("; ")}` : ""}`,
      data: inv as unknown as Record<string, unknown>,
      incident: {
        category: "backup", title: `Zaxira: ${problems[0] ?? "muammo"}`, critSeverity: "HIGH",
        suggestedActions: lastRestoreTest.status !== "OK" ? [{ type: "RUN_RESTORE_TEST", label: "Tiklash sinovini o'tkazish" }] : [{ type: "RUN_BACKUP", label: "Hozir zaxira nusxa olish" }],
      },
    };
  }

  /* ───────────── Server tizimi ───────────── */

  let duCache: { at: number; value: Map<string, number> } | null = null;

  async function duSizes(paths: string[]): Promise<Map<string, number>> {
    if (duCache && Date.now() - duCache.at < DU_TTL) return duCache.value;
    const exist = paths.filter((p) => existsSync(p));
    if (!exist.length) return new Map();
    const du = existsSync(BIN_DU) ? BIN_DU : "du";
    // Linux: bayt (-b); macOS (lokal sinov): KB (-k)
    const r = await d.run(du, [d.linux ? "-sb" : "-sk", "--", ...exist], { timeoutMs: 120_000 });
    const raw = parseDu(r.out);
    const value = d.linux ? raw : new Map([...raw].map(([k, v]) => [k, v * 1024]));
    duCache = { at: Date.now(), value };
    return value;
  }

  async function releasesList(): Promise<{ list: { name: string; mtimeMs: number }[]; current: string | null; dir: string }> {
    const dir = path.join(d.appDir, "releases");
    let current: string | null = null;
    try {
      const cur = await realpath(path.join(d.appDir, "current"));
      if (path.dirname(cur) === (await realpath(dir))) current = path.basename(cur);
    } catch { /* current yo'q */ }
    const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const list: { name: string; mtimeMs: number }[] = [];
    for (const e of ents) {
      if (!e.isDirectory() || e.isSymbolicLink() || !RELEASE_NAME_RE.test(e.name)) continue;
      const st = await stat(path.join(dir, e.name)).catch(() => null);
      if (st) list.push({ name: e.name, mtimeMs: st.mtimeMs });
    }
    return { list: list.sort((a, b) => b.mtimeMs - a.mtimeMs), current, dir };
  }

  async function journalUsage(): Promise<number | null> {
    if (!existsSync(d.bin.journalctl)) return null;
    const r = await d.run(d.bin.journalctl, ["--disk-usage"], { timeoutMs: 20_000 });
    return parseJournalDiskUsage(r.out);
  }

  async function systemInfo(): Promise<CheckResult> {
    const base = { key: infraKey.system(), kind: "host", target: "Server tizimi" };
    const problems: string[] = [];
    const kernel = os.release();
    const [osRel, bootFiles, rebootPkgsT, sched] = await Promise.all([
      readText("/etc/os-release"), readdir("/boot").catch(() => [] as string[]), readText("/var/run/reboot-required.pkgs"), readText("/run/systemd/shutdown/scheduled"),
    ]);
    const rebootRequired = existsSync("/var/run/reboot-required");
    const uptimeSec = Math.floor(os.uptime());

    let updates: SystemInfo["updates"] = null;
    let aptListsAt: string | null = null;
    let unattended: SystemInfo["unattended"] = null;
    if (d.linux && existsSync("/usr/bin/apt")) {
      try {
        // Kalit va qiymat shakli xavfsizlik moduli (host-checks.ts → checkApt) bilan bir xil — kesh umumiy
        const res = await cached("apt-upgradable", 3600_000, Date.now(), async () => {
          const r = await execRun("apt", ["list", "--upgradable"], { timeoutMs: 60_000 });
          if (!r.ok && !r.stdout) throw new Error(r.missing ? "apt yo'q" : (r.stderr || `kod ${r.code}`).slice(0, 200));
          return r.stdout;
        });
        const a = parseAptUpgradable(res.value);
        updates = { total: a.total, security: a.security, securityPkgs: a.securityPkgs, checkedAt: new Date(res.cachedAt).toISOString(), error: null };
      } catch (e) {
        updates = { total: 0, security: 0, securityPkgs: [], checkedAt: null, error: errMsg(e) };
      }
      const stamp = await stat("/var/lib/apt/periodic/update-success-stamp").catch(() => stat("/var/cache/apt/pkgcache.bin").catch(() => null));
      aptListsAt = stamp ? stamp.mtime.toISOString() : null;

      const installed = existsSync("/usr/bin/unattended-upgrade");
      let enabled: boolean | null = null, active: string | null = null;
      if (await d.hasSystemd()) {
        const [en, ac] = await Promise.all([
          d.run(d.bin.systemctl, ["is-enabled", "unattended-upgrades"], { timeoutMs: 10_000 }),
          d.run(d.bin.systemctl, ["is-active", "unattended-upgrades"], { timeoutMs: 10_000 }),
        ]);
        enabled = en.out.trim() === "enabled";
        active = ac.out.trim().split("\n")[0] || null;
      }
      const periodic = parseAutoUpgrades((await readText("/etc/apt/apt.conf.d/20auto-upgrades")) ?? "");
      const uuLog = "/var/log/unattended-upgrades/unattended-upgrades.log";
      const uuStat = await stat(uuLog).catch(() => null);
      const uuTail = await tail(uuLog, 4096);
      unattended = {
        installed, enabled, active, periodic,
        lastRun: uuStat ? uuStat.mtime.toISOString() : null,
        lastLine: uuTail ? (uuTail.trim().split("\n").at(-1) ?? "").slice(0, 300) : null,
      };
      if (!installed) problems.push("unattended-upgrades o'rnatilmagan — xavfsizlik yangilanishlari avtomatik qo'yilmaydi");
      else if (periodic === false || enabled === false) problems.push("avtomatik xavfsizlik yangilanishlari o'chiq (unattended-upgrades)");
    }

    const { list: rel, current } = await releasesList();
    const backups = d.backupDir;
    const uploadsRoot = "/var/lib/insof";
    const legacyUploads = path.join(d.appDir, "uploads");
    const relPaths = rel.map((r) => path.join(d.appDir, "releases", r.name));
    const sizes = await duSizes([path.join(d.appDir, "releases"), ...relPaths, backups, uploadsRoot, legacyUploads, "/var/log"]).catch(() => new Map<string, number>());
    const journalBytes = await journalUsage().catch(() => null);
    const dirs: DirUsage[] = [
      { label: "Relizlar (releases/)", path: path.join(d.appDir, "releases"), bytes: sizes.get(path.join(d.appDir, "releases")) ?? null, note: `${rel.length} ta` },
      { label: "Zaxira nusxalar", path: backups, bytes: sizes.get(backups) ?? null },
      { label: "systemd jurnali", path: "/var/log/journal", bytes: journalBytes },
      { label: "Korxona fayllari (uploads)", path: uploadsRoot, bytes: sizes.get(uploadsRoot) ?? null },
      { label: "Eski uploads (insof)", path: legacyUploads, bytes: sizes.get(legacyUploads) ?? null },
      { label: "Loglar (/var/log)", path: "/var/log", bytes: sizes.get("/var/log") ?? null, note: "jurnal ham ichida" },
    ].filter((x) => x.bytes != null || x.path === "/var/log/journal");
    // Reliz nomi — to'liq git sha (40 belgi); scrubSecrets uzun hex'ni "***" qiladi, shuning uchun qisqa ko'rinish
    const releases: ReleaseInfo[] = rel.map((r) => ({ name: short(r.name), mtime: new Date(r.mtimeMs).toISOString(), current: r.name === current, bytes: sizes.get(path.join(d.appDir, "releases", r.name)) ?? null }));

    const info: SystemInfo = {
      os: osRel ? parseOsRelease(osRel) : `${os.type()} ${os.release()}`,
      kernel, pendingKernel: pendingKernel(bootFiles, kernel),
      rebootRequired, rebootPkgs: (rebootPkgsT ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 40),
      scheduledShutdown: sched ? parseShutdownScheduled(sched) : null,
      uptimeSec, bootedAt: new Date(Date.now() - uptimeSec * 1000).toISOString(),
      updates, aptListsAt, unattended, dirs, releases, journalBytes, problems,
    };
    const status: CheckStatusT = !d.linux ? "UNKNOWN" : problems.length ? "WARN" : "OK";
    const parts = [info.os, `yadro ${kernel}`];
    if (info.pendingKernel) parts.push(`kutilayotgan ${info.pendingKernel}`);
    if (updates) parts.push(`${updates.total} yangilanish (${updates.security} xavfsizlik)`);
    if (info.scheduledShutdown) parts.push(`qayta yuklash rejalashtirilgan: ${info.scheduledShutdown.at}`);
    return {
      ...base, status, message: `${parts.filter(Boolean).join(", ")}${problems.length ? ` — ${problems.join("; ")}` : ""}`,
      data: info as unknown as Record<string, unknown>,
      incident: { category: "update", title: problems[0] ?? "Server tizimi" },
    };
  }

  async function collect(): Promise<CheckResult[]> {
    const settled = await Promise.allSettled([backupInventory(), systemInfo()]);
    return settled.flatMap<CheckResult>((s, i) => s.status === "fulfilled" ? [{ ...s.value, message: s.value.message && cleanText(s.value.message), data: sanitizeDeep(s.value.data) as Record<string, unknown> }]
      : [{ key: i === 0 ? infraKey.backup() : infraKey.system(), kind: i === 0 ? "backup" : "host", target: i === 0 ? "Zaxira inventari" : "Server tizimi", status: "UNKNOWN" as const, message: `yig'ishda xato: ${errMsg(s.reason)}` }]);
  }

  /* ───────────── Amallar ───────────── */

  async function adminName(id: string | null): Promise<string> {
    if (!id) return "agent";
    const a = await d.control.superAdmin.findUnique({ where: { id }, select: { fullName: true, login: true } }).catch(() => null);
    return a ? `${a.fullName} (${a.login})` : "admin";
  }

  /**
   * Panel orqali ishga tushirilgan skript chiqishi cron logiga ham qo'shiladi — sahifa «oxirgi natija» ni logdan o'qiydi.
   * Qaytaradi: "" yoki ogohlantirish qatori.
   */
  async function appendRunLog(which: "backup" | "restore", started: Date, out: string): Promise<string> {
    const file = which === "backup" ? d.backupLog : d.restoreLog;
    try {
      await appendFile(file, `[${started.toISOString()}] --- panel (insof-agent) orqali ishga tushirildi ---\n${out.trim()}\n`);
      return "";
    } catch (e) { return `\n⚠ ${file} ga yozib bo'lmadi: ${errMsg(e)}`; }
  }

  async function restoreTest(): Promise<Outcome> {
    const script = path.join(d.appDir, "scripts", "restore-test.sh");
    if (!existsSync(script)) return { status: "FAILED", output: `${script} topilmadi` };
    const env = { ...d.childEnv, ...(process.env.BACKUP_ENV ? { BACKUP_ENV: process.env.BACKUP_ENV } : {}) };
    const started = new Date();
    const r = await d.run(d.bin.bash, [script], { timeoutMs: 2 * 3600_000, cwd: d.appDir, env });
    // Panel «oxirgi natija» ni logdan o'qiydi — qo'lda ishga tushirilgani ham cron logiga yoziladi
    const note = await appendRunLog("restore", started, r.out);
    d.afterChange("checks");
    return { status: r.code === 0 ? "DONE" : "FAILED", output: d.fmt(["bash", "scripts/restore-test.sh"], r) + note };
  }

  /** Qayta yuklash sikli (xato sozlama, ketma-ket so'rovlar) bo'lmasin: uptime ≥ 30 daq va oxirgi DONE REBOOT ≥ 1 soat. */
  async function rebootCooldown(): Promise<string | null> {
    const up = Math.floor((d.uptimeSec ?? os.uptime)());
    if (up < REBOOT_MIN_UPTIME_SEC) {
      return `Server ${Math.floor(up / 60)} daqiqa oldin yuklangan — qayta yuklash faqat ${REBOOT_MIN_UPTIME_SEC / 60} daqiqadan keyin mumkin (qayta yuklash sikli himoyasi).`;
    }
    const since = new Date(Date.now() - REBOOT_COOLDOWN_MS);
    const last = await d.control.agentAction.findFirst({ where: { type: "REBOOT", status: "DONE", finishedAt: { gte: since } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
    if (!last?.finishedAt) return null;
    // Keyin bekor qilingan bo'lsa (REBOOT_CANCEL DONE) — qayta rejalashtirish mumkin
    const cancelled = await d.control.agentAction.findFirst({ where: { type: "REBOOT_CANCEL", status: "DONE", finishedAt: { gt: last.finishedAt } }, select: { id: true } });
    if (cancelled) return null;
    const mins = Math.max(1, Math.ceil((last.finishedAt.getTime() + REBOOT_COOLDOWN_MS - Date.now()) / 60_000));
    return `Oxirgi qayta yuklash ${last.finishedAt.toISOString()} da so'ralgan — 1 soat ichida takrorlanmaydi (${mins} daqiqadan keyin; vaqtni o'zgartirish uchun avval «Qayta yuklashni bekor qilish»).`;
  }

  async function reboot(at: string, requestedById: string | null): Promise<Outcome> {
    if (!REBOOT_AT_RE.test(at)) return { status: "REJECTED", output: "at noto'g'ri" };
    const cool = await rebootCooldown();
    if (cool) return { status: "REJECTED", output: cool };
    const busy = d.runningTypes().filter((t) => ["RUN_BACKUP", "RUN_RESTORE_TEST", "TENANT_UP", "CLEAN_RELEASES"].includes(t));
    if (busy.length) return { status: "FAILED", output: `Hozir bajarilmoqda: ${busy.join(", ")} — tugashini kuting, keyin qayta so'rang.` };
    // DEPLOY/ROLLBACK ajratilgan jarayonda — runningTypes da ko'rinmaydi; holat fayli/flock bo'yicha tekshiriladi
    const dep = await deployBusy(d.appDir);
    if (dep) return { status: "FAILED", output: `Deploy ketmoqda: ${dep} — tugashini kuting, keyin qayta so'rang.` };
    const fresh = (await readdir(d.backupDir).catch(() => [] as string[])).filter((n) => n.endsWith(".partial"));
    for (const n of fresh) {
      const st = await stat(path.join(d.backupDir, n)).catch(() => null);
      if (st && Date.now() - st.mtimeMs < 3 * 3600_000) return { status: "FAILED", output: `Zaxira nusxa olinmoqda (${n}) — tugagach qayta yuklang.` };
    }
    const when = rebootWhen(at);
    const who = await adminName(requestedById);
    // "now" → +1 daqiqa: natija bazaga yoziladi, Telegram xabari ketadi va bekor qilish imkoni qoladi
    const args = [BIN_SHUTDOWN, "-r", at === "now" ? "+1" : at];
    await d.telegram(`[REBOOT] ${d.host}: server ${when.label} qayta yuklanadi (so'radi: ${who}). Barcha korxonalar 1–3 daqiqa ishlamaydi. Bekor qilish: IT panel → Tizim.`);
    const r = await d.sudo(args, 30_000);
    if (!r.ok) {
      await d.telegram(`[REBOOT] ${d.host}: qayta yuklash rejalashtirilmadi — buyruq xato (panel → Amallar).`);
      return { status: "FAILED", output: r.text };
    }
    const sched = await readText("/run/systemd/shutdown/scheduled");
    const s = sched ? parseShutdownScheduled(sched) : null;
    d.afterChange("checks");
    return { status: "DONE", output: `${r.text}\nRejalashtirildi: ${when.label}${s ? ` (systemd: ${s.mode} ${s.at})` : ""}. Bekor qilish — «Qayta yuklashni bekor qilish».` };
  }

  async function rebootCancel(requestedById: string | null): Promise<Outcome> {
    const r = await d.sudo([BIN_SHUTDOWN, "-c"], 30_000);
    if (r.ok) await d.telegram(`[REBOOT] ${d.host}: rejalashtirilgan qayta yuklash bekor qilindi (${await adminName(requestedById)}).`);
    d.afterChange("checks");
    return { status: r.ok ? "DONE" : "FAILED", output: r.text };
  }

  async function cleanReleases(): Promise<Outcome> {
    const { list, current, dir } = await releasesList();
    if (!current) return { status: "FAILED", output: `${path.join(d.appDir, "current")} → releases/<reliz> aniqlanmadi — xavfsizlik uchun hech narsa o'chirilmadi.` };
    const dep = await deployBusy(d.appDir);
    if (dep) return { status: "FAILED", output: `Deploy ketmoqda: ${dep} — tugagach qayta urinib ko'ring (hech narsa o'chirilmadi).` };
    const all = (await readdir(dir).catch(() => [] as string[]));
    const tmpFresh = [];
    for (const n of all.filter((x) => x.endsWith(".tmp"))) {
      const st = await stat(path.join(dir, n)).catch(() => null);
      if (st && Date.now() - st.mtimeMs < 2 * 3600_000) tmpFresh.push(n);
    }
    if (tmpFresh.length) return { status: "FAILED", output: `Deploy ketayotganga o'xshaydi (${tmpFresh.join(", ")}) — tugagach qayta urinib ko'ring.` };
    const tmpOld: { name: string; mtimeMs: number }[] = [];
    for (const n of all.filter((x) => x.endsWith(".tmp") && RELEASE_NAME_RE.test(x))) {
      const st = await stat(path.join(dir, n)).catch(() => null);
      if (st?.isDirectory()) tmpOld.push({ name: n, mtimeMs: st.mtimeMs });
    }
    const del = releasesToClean([...list, ...tmpOld], current, Date.now());
    const lines = [`current → ${short(current)}`, `saqlanadi: ${list.filter((r) => !del.includes(r.name)).map((r) => short(r.name)).join(", ") || "—"}`];
    if (!del.length) return { status: "DONE", output: `${lines.join("\n")}\nO'chiriladigan reliz yo'q.` };
    duCache = null;
    const sizes = await duSizes(del.map((n) => path.join(dir, n))).catch(() => new Map<string, number>());
    duCache = null;
    let freed = 0, failed = 0;
    for (const n of del) {
      if (n === current || !RELEASE_NAME_RE.test(n)) continue; // ikkinchi qatlam
      const p = path.join(dir, n);
      try {
        const st = await stat(p);
        if (!st.isDirectory()) continue;
        await rm(p, { recursive: true, force: true });
        freed += sizes.get(p) ?? 0;
        lines.push(`o'chirildi: ${short(n)}${sizes.has(p) ? ` (${Math.round((sizes.get(p) ?? 0) / 1048576)} MB)` : ""}`);
      } catch (e) { failed++; lines.push(`✗ ${short(n)}: ${errMsg(e)}`); }
    }
    lines.push(`Bo'shadi: ~${Math.round(freed / 1048576)} MB`);
    d.afterChange("checks");
    return { status: failed ? "FAILED" : "DONE", output: lines.join("\n") };
  }

  async function journalVacuum(): Promise<Outcome> {
    const before = await journalUsage().catch(() => null);
    const r = await d.sudo([d.bin.journalctl, `--vacuum-time=${JOURNAL_KEEP}`], 180_000);
    const after = await journalUsage().catch(() => null);
    const mb = (b: number | null) => (b == null ? "?" : `${Math.round(b / 1048576)} MB`);
    duCache = null;
    d.afterChange("checks");
    return { status: r.ok ? "DONE" : "FAILED", output: `${r.text}\nJurnal: ${mb(before)} → ${mb(after)}` };
  }

  async function tenantUp(slug: string, domain: string | undefined): Promise<Outcome> {
    // Agent bazadan qayta tekshiradi: korxona bor, holati mos, domen aynan korxona yozuvidagi va siyosatga mos
    const t = await d.control.tenant.findUnique({ where: { slug }, select: { id: true, status: true, domain: true } });
    if (!t) return { status: "REJECTED", output: `korxona ${slug} control bazada yo'q` };
    if (t.status !== "PROVISIONING" && t.status !== "ACTIVE") return { status: "REJECTED", output: `korxona holati ${t.status} — faqat PROVISIONING yoki ACTIVE` };
    if ((domain ?? null) !== (t.domain ?? null)) return { status: "REJECTED", output: `domen korxona yozuvidagi (${t.domain ?? "yo'q"}) bilan mos emas` };
    if (domain) {
      const pol = domainPolicyFromEnv();
      if (!domainAllowed(domain, pol.base, pol.list)) return { status: "REJECTED", output: `domen ${domain} ruxsat etilmagan (TENANT_BASE_DOMAIN / TENANT_DOMAINS)` };
    }
    if (!existsSync(TENANT_UP_BIN)) {
      return { status: "FAILED", output: `${TENANT_UP_BIN} o'rnatilmagan — PLATFORMA.md → «Infratuzilma» (sudo install -o root -g root -m 755 scripts/tenant-up.sh ${TENANT_UP_BIN})` };
    }
    const r = await d.sudo([TENANT_UP_BIN, slug, ...(domain ? [domain] : [])], 15 * 60_000);
    const res = parseTenantUpResult(r.text);
    const summary = res ? `Natija: systemd=${res.systemd ?? "?"}, health=${res.health ?? "?"}, nginx=${res.nginx ?? "?"}, certbot=${res.certbot ?? "?"}` : "Natija qatori (RESULT) yo'q — chiqishga qarang";
    if (r.ok && res?.health === "200" && t.status === "PROVISIONING") {
      // stats.ts qoidasi bilan bir xil: jarayon javob berdi (health 200 — baza ham ulangan) → Faol
      await d.control.tenant.update({ where: { id: t.id }, data: { status: "ACTIVE", lastSeenAt: new Date(), lastError: null } }).catch(() => {});
    }
    d.afterChange("tenants");
    return { status: r.ok ? "DONE" : "FAILED", output: `${summary}\n${r.text}` };
  }

  async function execute(type: InfraActionType, params: Record<string, string>, requestedById: string | null): Promise<Outcome> {
    switch (type) {
      case "RUN_RESTORE_TEST": return restoreTest();
      case "REBOOT": return reboot(params.at ?? "now", requestedById);
      case "REBOOT_CANCEL": return rebootCancel(requestedById);
      case "CLEAN_RELEASES": return cleanReleases();
      case "JOURNAL_VACUUM": return journalVacuum();
      case "TENANT_UP": return tenantUp(params.slug, params.domain || undefined);
    }
  }

  return {
    collect, execute, appendRunLog,
    /** RUN_BACKUP dan keyin masofa ro'yxati qayta o'qilsin */
    invalidate() { remoteCache = null; duCache = null; },
    _test: { backupInventory, systemInfo, releasesList },
  };
}
