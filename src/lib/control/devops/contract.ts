/**
 * DevOps (relizlar va loglar) — panel ↔ insof-agent shartnomasi. Sof modul: Prisma/Node yo'q, klient ham import qiladi.
 *
 * Amallar (AgentAction.type):
 *   DEPLOY   { ref?: "main" | <7–40 hex sha> }  — scripts/deploy.sh (DEPLOY_REF), agent jarayonidan AJRATILGAN holda
 *   ROLLBACK {}                                — ROLLBACK=1 scripts/deploy.sh (oldingi reliz)
 *   LOG_TAIL { source, lines, filter?, priority? } — oq ro'yxatdagi manbaning oxirgi qatorlari (≤ 500, ≤ 64 KB, sirlarsiz)
 */

export const DEVOPS_ACTIONS = ["DEPLOY", "ROLLBACK", "LOG_TAIL"] as const;
export type DevopsAction = (typeof DEVOPS_ACTIONS)[number];
export const isDevopsAction = (t: string): t is DevopsAction => (DEVOPS_ACTIONS as readonly string[]).includes(t);
/** Agent qayta ishga tushganda ham RUNNING holatida qoladigan (ajratilgan jarayon) amallar. */
export const DETACHED_ACTIONS = ["DEPLOY", "ROLLBACK"] as const;

/** DEPLOY ref: faqat "main" yoki 7–40 belgili hex sha (teg/branch nomi YO'Q — buyruq qatoriga erkin matn tushmaydi). */
export const DEPLOY_REF_RE = /^(main|[0-9a-f]{7,40})$/;

/** ServiceCheck kaliti: relizlar holati (agent `git fetch` bilan yozadi). */
export const RELEASE_CHECK_KEY = "release:info";

/** Deploy logidagi chegara qatorlari (agent o'rami yozadi; keyingi agent nusxasi natijani shundan biladi). */
export const DEPLOY_MARK = { begin: "@@INSOF_DEPLOY_BEGIN", end: "@@INSOF_DEPLOY_END" } as const;

/* ───────── Loglar ───────── */

export const LOG_MAX_LINES = 500;
export const LOG_MAX_BYTES = 64 * 1024;
export const LOG_FILTER_MAX = 100;

/** Fayl manbalari: kalit → (standart) yo'l. Yo'l agentda aniqlanadi (deploy log — AGENT_DEPLOY_LOG). */
export const LOG_FILES = {
  "nginx-error": { label: "nginx error.log", path: "/var/log/nginx/error.log" },
  "nginx-access": { label: "nginx access.log", path: "/var/log/nginx/access.log" },
  backup: { label: "insof-backup.log (zaxira)", path: "/var/log/insof-backup.log" },
  "restore-test": { label: "insof-restore-test.log (tiklash sinovi)", path: "/var/log/insof-restore-test.log" },
  deploy: { label: "insof-deploy.log (deploy)", path: "/var/log/insof-deploy.log" },
} as const;
export type LogFileKey = keyof typeof LOG_FILES;

/** journald unitlari: insof-erp@<slug>, insof-control, insof-eco, insof-agent, nginx. */
export const LOG_UNIT_RE = /^(insof-erp@[a-z0-9-]{2,30}|insof-control|insof-eco|insof-agent|nginx)$/;
export const isLogFile = (s: string): s is LogFileKey => Object.prototype.hasOwnProperty.call(LOG_FILES, s);
export const isLogSource = (s: string) => LOG_UNIT_RE.test(s) || isLogFile(s);

/** journalctl -p qiymatlari (shu daraja va undan og'irlari). */
export const LOG_PRIORITIES = {
  err: "Xatolar (err va og'irroq)",
  warning: "Ogohlantirish va xatolar",
  notice: "Notice va yuqori",
  info: "Info va yuqori",
  debug: "Hammasi (debug)",
} as const;
export type LogPriority = keyof typeof LOG_PRIORITIES;
export const isLogPriority = (s: string): s is LogPriority => Object.prototype.hasOwnProperty.call(LOG_PRIORITIES, s);

export type DevopsParams = { ref?: string; source?: string; lines?: number; filter?: string; priority?: string };
export type DevopsValid = { ok: true; params: DevopsParams } | { ok: false; reason: string };

/** Filtr: oddiy matn (regex emas), boshqaruv belgilarisiz, ≤ 100 belgi. */
export function cleanFilter(v: unknown): string | null {
  if (v == null || v === "") return "";
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length > LOG_FILTER_MAX || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/** Panel ham, agent ham ishlatadi: faqat ma'lum parametrlar, qat'iy tekshiruv (qolganlari tashlanadi). */
export function validateDevops(type: DevopsAction, p: Record<string, unknown>): DevopsValid {
  if (type === "ROLLBACK") return { ok: true, params: {} };
  if (type === "DEPLOY") {
    const ref = p.ref == null || p.ref === "" ? "main" : p.ref;
    if (typeof ref !== "string" || !DEPLOY_REF_RE.test(ref)) return { ok: false, reason: "ref noto'g'ri (faqat \"main\" yoki 7–40 belgili hex sha)" };
    return { ok: true, params: { ref } };
  }
  // LOG_TAIL
  const source = p.source;
  if (typeof source !== "string" || !isLogSource(source)) return { ok: false, reason: "log manbai oq ro'yxatda emas" };
  const n = typeof p.lines === "number" ? p.lines : typeof p.lines === "string" && /^\d{1,4}$/.test(p.lines) ? Number(p.lines) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > LOG_MAX_LINES) return { ok: false, reason: `qatorlar soni 1–${LOG_MAX_LINES}` };
  const filter = cleanFilter(p.filter);
  if (filter === null) return { ok: false, reason: `filtr noto'g'ri (oddiy matn, ≤ ${LOG_FILTER_MAX} belgi)` };
  const priority = p.priority == null || p.priority === "" ? "" : p.priority;
  if (typeof priority !== "string" || (priority && !isLogPriority(priority))) return { ok: false, reason: "daraja noto'g'ri" };
  return { ok: true, params: { source, lines: n, ...(filter ? { filter } : {}), ...(priority ? { priority } : {}) } };
}

/* ───────── Relizlar holati (ServiceCheck release:info → data) ───────── */

export type ReleaseCommit = { sha: string; author: string; date: string; subject: string };
export type ReleaseDir = { sha: string; mtime: string; built: boolean; current: boolean; subject: string | null };
export type ReleaseInfo = {
  current: string | null;          // current → releases/<sha> (to'liq sha)
  releaseFile: string | null;      // current/RELEASE ichidagi qiymat
  releases: ReleaseDir[];          // eng yangisi birinchi
  originMain: string | null;       // origin/main sha (git fetch dan keyin)
  ahead: number | null;            // current..origin/main commitlar soni
  commits: ReleaseCommit[];        // ≤ 50, eng yangisi birinchi
  fetchedAt: string | null;
  fetchError: string | null;
  deployLog: string;               // agent yozayotgan log yo'li
  mode: "systemd-run" | "detached" | null; // oxirgi deploy qanday ishga tushirilgan
};

/** Panelda versiya taqqoslash: /api/health qisqa sha (12) beradi. */
export function sameSha(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const n = Math.min(a.length, b.length, 40);
  return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}
