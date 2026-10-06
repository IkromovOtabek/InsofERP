/**
 * insof-agent: sof (side-effect'siz) parserlar, chegaralar va tekshiruvlar — scripts/qa/d-agent.mts shularni sinaydi.
 * Fayl/jarayon bilan ishlash scripts/insof-agent.ts da; bu yerda faqat matn → raqam → holat.
 */
import { IPV4_RE, UNIT_RE, isActionType, type ActionType } from "./contract";
import { validateDbAction } from "../dbtraffic/contract";
import type { CheckStatusT, FindingSeverity } from "./types";

/* ───────────────────────── /proc parserlari ───────────────────────── */

export type CpuTimes = { idle: number; total: number };

/** /proc/stat ning birinchi "cpu " qatori → idle (idle+iowait) va jami jiffies. */
export function parseProcStat(text: string): CpuTimes | null {
  const line = text.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  if (v.length < 4 || v.some((x) => !Number.isFinite(x))) return null;
  // user nice system idle iowait irq softirq steal guest guest_nice — guest'lar user ichida, qo'shilmaydi
  const total = v.slice(0, 8).reduce((a, b) => a + b, 0);
  const idle = v[3] + (v[4] ?? 0);
  return { idle, total };
}

/** Ikki /proc/stat namunasi orasidagi CPU bandligi (%), 0..100. Delta yo'q bo'lsa null. */
export function cpuPctFromDelta(prev: CpuTimes | null, cur: CpuTimes | null): number | null {
  if (!prev || !cur) return null;
  const dt = cur.total - prev.total;
  const di = cur.idle - prev.idle;
  if (dt <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((dt - di) / dt) * 1000) / 10));
}

export type MemInfo = { memTotal: number; memUsed: number; memAvailable: number; swapTotal: number; swapUsed: number };

/** /proc/meminfo (kB) → baytlar. Ishlatilgan = Total − Available (free(1) dagi "used" ga yaqin). */
export function parseMeminfo(text: string): MemInfo | null {
  const kv = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) kv.set(m[1], Number(m[2]) * 1024);
  }
  const total = kv.get("MemTotal");
  if (!total) return null;
  const avail = kv.get("MemAvailable") ?? (kv.get("MemFree") ?? 0) + (kv.get("Buffers") ?? 0) + (kv.get("Cached") ?? 0);
  const swapTotal = kv.get("SwapTotal") ?? 0;
  const swapFree = kv.get("SwapFree") ?? 0;
  return { memTotal: total, memAvailable: avail, memUsed: Math.max(0, total - avail), swapTotal, swapUsed: Math.max(0, swapTotal - swapFree) };
}

export type NetTotals = { rx: number; tx: number };

/** /proc/net/dev → barcha interfeyslar (lo dan tashqari) bo'yicha jami qabul/yuborilgan baytlar. */
export function parseNetDev(text: string): NetTotals | null {
  let rx = 0, tx = 0, seen = false;
  for (const line of text.split("\n")) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m || m[1] === "lo") continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    if (f.length < 9 || !Number.isFinite(f[0]) || !Number.isFinite(f[8])) continue;
    rx += f[0]; tx += f[8]; seen = true;
  }
  return seen ? { rx, tx } : null;
}

/** Ikki namuna orasidagi bayt/soniya. Hisoblagich qaytsa (qayta yuklash) — null. */
export function netBps(prev: NetTotals | null, cur: NetTotals | null, dtMs: number): { rx: number; tx: number } | null {
  if (!prev || !cur || dtMs <= 0) return null;
  const drx = cur.rx - prev.rx, dtx = cur.tx - prev.tx;
  if (drx < 0 || dtx < 0) return null;
  return { rx: Math.round((drx * 1000) / dtMs), tx: Math.round((dtx * 1000) / dtMs) };
}

export function parseLoadavg(text: string): [number, number, number] | null {
  const v = text.trim().split(/\s+/).slice(0, 3).map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? [v[0], v[1], v[2]] : null;
}

export function parseUptime(text: string): number | null {
  const v = Number(text.trim().split(/\s+/)[0]);
  return Number.isFinite(v) ? Math.floor(v) : null;
}

/** /proc/<pid>/status → nom va RSS (bayt). Yadro oqimlarida VmRSS yo'q → null. */
export function parseProcStatus(text: string): { name: string; rss: number } | null {
  const name = /^Name:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const rss = /^VmRSS:\s*(\d+)\s*kB/m.exec(text)?.[1];
  if (!name || !rss) return null;
  return { name, rss: Number(rss) * 1024 };
}

/** RSS bo'yicha eng katta N jarayon. */
export function topByRss<T extends { rss: number }>(list: T[], n = 5): T[] {
  return [...list].sort((a, b) => b.rss - a.rss).slice(0, n);
}

/* ───────────────────────── systemd / journald ───────────────────────── */

export type UnitInfo = {
  id: string;
  loadState: string;
  activeState: string;
  subState: string;
  nRestarts: number | null;
  memoryCurrent: number | null;
  activeEnterTimestamp: string | null;
};

/**
 * `systemctl show -p Id,LoadState,... unitA unitB` chiqishi: har unit bloki bo'sh qator bilan ajratilgan.
 * MemoryCurrent "[not set]" yoki 2^64-1 bo'lishi mumkin → null.
 */
export function parseSystemctlShow(text: string): UnitInfo[] {
  const out: UnitInfo[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const kv = new Map<string, string>();
    for (const line of block.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
    const id = kv.get("Id");
    if (!id) continue;
    const num = (k: string) => {
      const raw = kv.get(k);
      if (!raw || !/^\d+$/.test(raw)) return null;
      const n = Number(raw);
      return n >= 2 ** 63 ? null : n; // UINT64_MAX — "cheklanmagan/ma'lum emas"
    };
    out.push({
      id,
      loadState: kv.get("LoadState") ?? "",
      activeState: kv.get("ActiveState") ?? "",
      subState: kv.get("SubState") ?? "",
      nRestarts: num("NRestarts"),
      memoryCurrent: num("MemoryCurrent"),
      activeEnterTimestamp: kv.get("ActiveEnterTimestamp") || null,
    });
  }
  return out;
}

/** journalctl -o cat chiqishidagi bo'sh bo'lmagan qatorlar soni ("-- No entries --" hisoblanmaydi). */
export function countJournalLines(text: string): number {
  return text.split("\n").filter((l) => l.trim() && !/^-- (No entries|Logs begin|Journal begins)/.test(l)).length;
}

/* ───────────────────────── Chegaralar → holat ───────────────────────── */

export const THRESHOLDS = {
  diskPct: { warn: 80, crit: 90 },
  memPct: { warn: 85, crit: 95 },
  loadPerCore: { warn: 1.5, crit: 3 },
  cpuPct: { warn: 85, crit: 95, samples: 3 },
  pgConnPct: { warn: 80, crit: 95 },
  pgQuerySec: { warn: 300, crit: 1800 },
  sslDays: { warn: 21, crit: 7 },
  backupHours: { warn: 25, crit: 26 },
  journalErrors: { warn: 10, crit: 50 },
  httpSlowMs: 2000,
  restartWindowMs: 10 * 60_000,
} as const;

/** value ≥ crit → CRIT, ≥ warn → WARN (> emas: 90% disk allaqachon kritik). */
export function levelAbove(value: number | null | undefined, t: { warn: number; crit: number }): CheckStatusT {
  if (value == null || !Number.isFinite(value)) return "UNKNOWN";
  if (value >= t.crit) return "CRIT";
  if (value >= t.warn) return "WARN";
  return "OK";
}

/** value ≤ crit → CRIT (masalan SSL qolgan kunlar). */
export function levelBelow(value: number | null | undefined, t: { warn: number; crit: number }): CheckStatusT {
  if (value == null || !Number.isFinite(value)) return "UNKNOWN";
  if (value < t.crit) return "CRIT";
  if (value < t.warn) return "WARN";
  return "OK";
}

export function diskStatus(usedPct: number | null) { return levelAbove(usedPct, THRESHOLDS.diskPct); }
export function memStatus(usedPct: number | null) { return levelAbove(usedPct, THRESHOLDS.memPct); }
export function loadStatus(load1: number | null, cores: number) {
  return levelAbove(load1 == null || cores <= 0 ? null : load1 / cores, THRESHOLDS.loadPerCore);
}

/** CPU: oxirgi `samples` ta namunaning HAMMASI chegaradan oshsa (bir martalik sakrash — ogohlantirish emas). */
export function cpuSustainedStatus(history: number[]): CheckStatusT {
  const n = THRESHOLDS.cpuPct.samples;
  if (history.length < n) return history.length ? "OK" : "UNKNOWN";
  const last = history.slice(-n);
  const min = Math.min(...last);
  return levelAbove(min, THRESHOLDS.cpuPct);
}

/** Bir nechta holatdan eng og'iri (UNKNOWN faqat boshqa hech narsa bo'lmasa). */
export function worst(...s: CheckStatusT[]): CheckStatusT {
  const rank: Record<CheckStatusT, number> = { UNKNOWN: 0, OK: 1, WARN: 2, CRIT: 3 };
  return s.reduce<CheckStatusT>((a, b) => (rank[b] > rank[a] ? b : a), "UNKNOWN");
}

/**
 * systemd unit holati: active → OK, activating/reloading/deactivating → WARN, failed/inactive → CRIT.
 * Restart soni oxirgi oynada oshgan bo'lsa (jarayon yiqilib qayta turgan) — kamida WARN.
 */
export function unitStatus(u: Pick<UnitInfo, "loadState" | "activeState">, restartsIncreased: boolean): CheckStatusT {
  if (u.loadState === "not-found") return "UNKNOWN";
  let s: CheckStatusT;
  if (u.activeState === "active") s = "OK";
  else if (["activating", "reloading", "deactivating"].includes(u.activeState)) s = "WARN";
  else s = "CRIT";
  return restartsIncreased ? worst(s, "WARN") : s;
}

/** Holat → Incident og'irligi. WARN — MEDIUM, CRIT — tekshiruv belgilagan (standart HIGH). */
export function severityFor(status: CheckStatusT, critSeverity: FindingSeverity = "HIGH"): FindingSeverity | null {
  if (status === "WARN") return "MEDIUM";
  if (status === "CRIT") return critSeverity;
  return null;
}

/** Topilma og'irligi → ServiceCheck holati. */
export function statusForSeverity(s: FindingSeverity): CheckStatusT {
  if (s === "CRITICAL" || s === "HIGH") return "CRIT";
  if (s === "MEDIUM") return "WARN";
  return "OK";
}

/**
 * Xavfsizlik topilmasi → ServiceCheck holati. Modul kelishuvi: `detail.status` "OK" | "WARN" | "UNKNOWN"
 * (UNKNOWN — vosita yo'q/huquq yetmadi, sababi detail.reason). INFO — OK; LOW/MEDIUM — WARN; HIGH/CRITICAL — CRIT.
 */
export function findingCheckStatus(f: { severity: FindingSeverity; detail?: Record<string, unknown> }): CheckStatusT {
  const ds = f.detail?.status;
  if (ds === "UNKNOWN") return "UNKNOWN";
  if (ds === "OK" || f.severity === "INFO") return "OK";
  if (f.severity === "LOW" || f.severity === "MEDIUM") return "WARN";
  return "CRIT";
}

/** Hodisa ochadimi: LOW va undan yuqori, detail.status OK/UNKNOWN bo'lmasa. */
export function findingIsProblem(f: { severity: FindingSeverity; detail?: Record<string, unknown> }): boolean {
  const s = findingCheckStatus(f);
  return s === "WARN" || s === "CRIT";
}

const SEV_RANK: Record<FindingSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export const sevRank = (s: FindingSeverity) => SEV_RANK[s] ?? 0;

/* ───────────────────────── Hodisa hayot sikli ───────────────────────── */

/** Necha ketma-ket OK dan keyin hodisa avtomatik yopiladi. */
export const RESOLVE_AFTER_OK = 2;

export type IncidentDecision = { op: "open" | "update" | "resolve" | "none"; okStreak: number };

/**
 * Bitta tekshiruv natijasi bo'yicha qaror:
 *   WARN/CRIT  → ochiq hodisa bo'lmasa "open", bo'lsa "update" (count++, lastSeenAt); OK seriyasi 0 ga.
 *   OK         → ochiq hodisa bo'lsa seriya +1; RESOLVE_AFTER_OK ga yetsa "resolve".
 *   UNKNOWN    → hech narsa (tekshirib bo'lmadi — tuzaldi ham, buzildi ham deb bo'lmaydi).
 */
export function decideIncident(hasOpen: boolean, okStreak: number, status: CheckStatusT): IncidentDecision {
  if (status === "WARN" || status === "CRIT") return { op: hasOpen ? "update" : "open", okStreak: 0 };
  if (status === "OK") {
    if (!hasOpen) return { op: "none", okStreak: 0 };
    const next = okStreak + 1;
    return next >= RESOLVE_AFTER_OK ? { op: "resolve", okStreak: 0 } : { op: "none", okStreak: next };
  }
  return { op: "none", okStreak };
}

/* ───────────────────────── Amallar: tekshiruv va tozalash ───────────────────────── */

export type ActionParams = { unit?: string; ip?: string; db?: string; pid?: string; table?: string };
export type ValidAction =
  | { ok: true; type: ActionType; params: ActionParams }
  | { ok: false; reason: string };

/** Hech qachon bloklanmaydigan manzillar: loopback, 0.0.0.0/8, broadcast (o'zimizni qulflamaslik). */
function forbiddenIp(ip: string): boolean {
  return /^(127|0)\./.test(ip) || ip === "255.255.255.255";
}

/**
 * Panel qo'ygan amalni oq ro'yxat bo'yicha tekshirish. Faqat ma'lum parametrlar olinadi (qolganlari e'tiborsiz),
 * qiymatlar qat'iy regex bilan — buyruq qatoriga hech qachon tekshirilmagan matn tushmaydi.
 */
export function validateAction(type: string, params: unknown): ValidAction {
  if (!isActionType(type)) return { ok: false, reason: `Noma'lum amal turi: ${String(type).slice(0, 40)}` };
  const p = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  const dbv = validateDbAction(type, p);
  if (dbv) return dbv;
  if (type === "RESTART_UNIT") {
    const unit = p.unit;
    if (typeof unit !== "string" || !UNIT_RE.test(unit)) return { ok: false, reason: "unit noto'g'ri (faqat insof-erp@<slug>, insof-control, insof-eco)" };
    return { ok: true, type, params: { unit } };
  }
  if (type === "BLOCK_IP" || type === "UNBLOCK_IP") {
    const ip = p.ip;
    if (typeof ip !== "string" || !IPV4_RE.test(ip)) return { ok: false, reason: "ip noto'g'ri (faqat IPv4)" };
    if (type === "BLOCK_IP" && forbiddenIp(ip)) return { ok: false, reason: `${ip} ni bloklash taqiqlangan (loopback/maxsus manzil)` };
    return { ok: true, type, params: { ip } };
  }
  return { ok: true, type, params: {} };
}

/** Sirga o'xshagan hamma narsani yashiradi: URL ichidagi parol, bot tokenlari, KEY=qiymat, Bearer, uzun kalitlar. */
export function scrubSecrets(text: string): string {
  return text
    // postgresql://user:parol@host → postgresql://user:***@host
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s@/]+@/gi, "$1:***@")
    // Telegram bot tokeni (123456789:AA...)
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "***")
    // Authorization: Bearer xxx
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 ***")
    // SECRET=..., API_KEY: ..., password=... (env, query string, JSON)
    .replace(/\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PASS|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|SSO_KEY)[A-Za-z0-9_]*)(["']?\s*[=:]\s*["']?)[^\s"'&,;]+/gi, "$1$2***")
    // Anthropic/OpenAI uslubidagi kalitlar
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-***")
    // 40+ belgili base64/hex bo'laklari (kalitlar, imzolar)
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "***");
}

export const OUTPUT_LIMIT = 8 * 1024;

/** Chiqishning oxirgi `limit` baytini qoldiradi (UTF-8 bo'yicha), sirlarni tozalab. */
export function trimOutput(text: string, limit = OUTPUT_LIMIT): string {
  const clean = scrubSecrets(text.replace(/\r/g, "")).trim();
  const buf = Buffer.from(clean, "utf8");
  if (buf.length <= limit) return clean;
  // Ko'p baytli belgini yarmidan kesmaslik uchun boshidagi davom baytlarini tashlaymiz
  let start = buf.length - limit;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return "…(boshi qisqartirildi)\n" + buf.subarray(start).toString("utf8");
}

/* ───────────────────────── Turli ───────────────────────── */

/** Zaxira papkasi nomi: server-backup.sh STAMP = YYYY-MM-DD_HHMM[-n] (.partial emas). */
export const BACKUP_DIR_RE = /^20\d{2}-\d{2}-\d{2}_\d{4}(-\d+)?$/;

/** Eng yangi zaxira papkasi (nom bo'yicha — sana-vaqt leksikografik tartiblanadi). */
export function latestBackupDir(names: string[]): string | null {
  const list = names.filter((n) => BACKUP_DIR_RE.test(n)).sort();
  return list.length ? list[list.length - 1] : null;
}

/** Qayta ishga tushish soni oshdimi (oldingi qiymat ma'lum bo'lsa). */
export function restartsIncreased(prev: number | null | undefined, cur: number | null): boolean {
  return prev != null && cur != null && cur > prev;
}
