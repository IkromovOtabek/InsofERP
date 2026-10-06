/**
 * Monitoring paneli — server ham, brauzer ham ishlatadigan turlar va sof yordamchilar.
 * Bu yerda Prisma yoki Node moduli YO'Q: klient komponentlar ham import qiladi.
 * Ma'lumot manbai — snapshot.ts (server) va /superadmin/api/stream (SSE).
 */
import { UNIT_RE, type ActionType } from "./contract";
import { INFRA_ACTION_LABEL, infraConfirmPhrase } from "../infra/contract";

export type CheckStatusT = "OK" | "WARN" | "CRIT" | "UNKNOWN";
export type SeverityT = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IncidentStatusT = "OPEN" | "ACKED" | "RESOLVED";
export type ActionStatusT = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "REJECTED";

export type SuggestedAction = { type: string; params?: Record<string, unknown>; label?: string };

export type HostView = {
  hostname: string; takenAt: string; cpuPct: number; load: [number, number, number];
  memTotal: number; memUsed: number; swapTotal: number; swapUsed: number;
  diskTotal: number; diskUsed: number; uptimeSec: number; netRx: number | null; netTx: number | null;
  cpus: number | null;
};
export type SeriesView = { t: number[]; cpu: number[]; mem: number[]; load: number[]; disk: number[]; rx: number[]; tx: number[] };
export type CheckView = {
  key: string; kind: string; target: string; tenantId: string | null; status: CheckStatusT;
  message: string | null; latencyMs: number | null; data: unknown; checkedAt: string; changedAt: string;
};
export type IncidentView = {
  id: string; key: string; source: string; category: string; severity: SeverityT; status: IncidentStatusT;
  title: string; tenantId: string | null; count: number; firstSeenAt: string; lastSeenAt: string;
  suggestedActions: SuggestedAction[];
};
export type ActionView = {
  id: string; type: string; params: Record<string, unknown>; status: ActionStatusT; requestedBy: string | null;
  requestedAt: string; startedAt: string | null; finishedAt: string | null; output: string | null; incidentId: string | null;
};
export type AgentView = { hostname: string; version: string; startedAt: string; lastSeenAt: string; stale: boolean; info: unknown };
export type ReportHeader = { id: string; createdAt: string; grade: string; summary: string; trigger: string; model: string; itemCount: number };
export type TenantView = { id: string; slug: string; name: string; status: string; lastError: string | null; lastSeenAt: string | null; version: string | null };

export type MonitorSnapshot = {
  host: HostView | null;
  series: SeriesView;
  checks: CheckView[];
  incidents: IncidentView[];
  counts: { open: number; acked: number; critical: number; high: number };
  actions: ActionView[];
  agent: AgentView | null;
  report: ReportHeader | null;
  tenants: TenantView[];
};

/* ───────── Yorliqlar va ranglar (Badge ranglari) ───────── */

type Color = "slate" | "blue" | "amber" | "red" | "green" | "violet";

export const CHECK_STATUS: Record<CheckStatusT, { label: string; color: Color }> = {
  OK: { label: "Ishlayapti", color: "green" },
  WARN: { label: "Ogohlantirish", color: "amber" },
  CRIT: { label: "Nosoz", color: "red" },
  UNKNOWN: { label: "Noma'lum", color: "slate" },
};
export const SEVERITY: Record<SeverityT, { label: string; color: Color; rank: number }> = {
  CRITICAL: { label: "Kritik", color: "red", rank: 4 },
  HIGH: { label: "Yuqori", color: "red", rank: 3 },
  MEDIUM: { label: "O'rta", color: "amber", rank: 2 },
  LOW: { label: "Past", color: "blue", rank: 1 },
  INFO: { label: "Ma'lumot", color: "slate", rank: 0 },
};
export const INCIDENT_STATUS: Record<IncidentStatusT, { label: string; color: Color }> = {
  OPEN: { label: "Ochiq", color: "red" },
  ACKED: { label: "Ko'rildi", color: "amber" },
  RESOLVED: { label: "Yopilgan", color: "green" },
};
export const ACTION_STATUS: Record<ActionStatusT, { label: string; color: Color }> = {
  PENDING: { label: "Navbatda", color: "blue" },
  RUNNING: { label: "Bajarilmoqda", color: "violet" },
  DONE: { label: "Bajarildi", color: "green" },
  FAILED: { label: "Xato", color: "red" },
  REJECTED: { label: "Rad etildi", color: "slate" },
};
export const ACTION_LABEL: Record<ActionType, string> = {
  RESTART_UNIT: "Xizmatni qayta ishga tushirish",
  RELOAD_NGINX: "Nginx reload",
  RUN_BACKUP: "Zaxira olish",
  RENEW_CERT: "SSL yangilash",
  FIX_SECRET_PERMS: "Maxfiy fayllar huquqini tuzatish (600)",
  BLOCK_IP: "IP bloklash",
  UNBLOCK_IP: "IP blokdan chiqarish",
  RUN_HEALTH_CHECK: "Hozir tekshirish",
  RUN_SECURITY_SCAN: "Xavfsizlik skaneri",
  RUN_AI_ANALYSIS: "AI xavfsizlik tahlili",
  ...INFRA_ACTION_LABEL,
};
export const SOURCE_LABEL: Record<string, string> = { monitor: "Monitoring", security: "Xavfsizlik skaneri", ai: "AI tahlil" };
export const CATEGORY_LABEL: Record<string, string> = {
  availability: "Ishlash", performance: "Unumdorlik", security: "Xavfsizlik", backup: "Zaxira",
  certificate: "Sertifikat", config: "Sozlama", update: "Yangilanish",
};

export const actionLabel = (t: string) => (ACTION_LABEL as Record<string, string>)[t] ?? t;

/**
 * Xavfli amallar — modal oynada qiymatni qo'lda yozib tasdiqlash shart (server ham tekshiradi).
 * Qaytadi: yozilishi kerak bo'lgan matn yoki null (oddiy tasdiq yetarli).
 */
export function confirmPhrase(type: string, params: Record<string, unknown>): string | null {
  const infra = infraConfirmPhrase(type, params);
  if (infra !== undefined) return infra;
  if (type === "BLOCK_IP") return typeof params.ip === "string" ? params.ip : "";
  if (type === "RENEW_CERT") return "SSL";
  if (type === "RESTART_UNIT" && typeof params.unit === "string" && params.unit.startsWith("insof-erp@")) return params.unit.slice("insof-erp@".length);
  return null;
}

/** Xizmat kartasida "Qayta ishga tushirish" tugmasi faqat oq ro'yxatdagi unit uchun. */
export function restartableUnit(checkKeyStr: string): string | null {
  if (!checkKeyStr.startsWith("unit:")) return null;
  const u = checkKeyStr.slice(5);
  return UNIT_RE.test(u) ? u : null;
}

/* ───────── Formatlash ───────── */

export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
export const bps = (n: number | null | undefined) => (n == null ? "—" : `${bytes(n)}/s`);

export function duration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} kun ${h} soat`;
  if (h > 0) return `${h} soat ${m} daq`;
  if (m > 0) return `${m} daq`;
  return `${Math.round(sec)} s`;
}
export function msBetween(a: string | null, b: string | null): string {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms < 1000 ? `${ms} ms` : duration(ms / 1000);
}
export function since(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  return s < 45 ? "hozirgina" : `${duration(s)} oldin`;
}
export function dt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** SSL tekshiruvidan qolgan kunlar (agent data'sida daysLeft yoki expiresAt/notAfter). */
export function sslDaysLeft(c: CheckView, now = Date.now()): number | null {
  const d = obj(c.data);
  const days = num(d.daysLeft);
  if (days != null) return Math.floor(days);
  const exp = d.expiresAt ?? d.notAfter ?? d.validTo;
  if (typeof exp === "string" && !Number.isNaN(Date.parse(exp))) return Math.floor((Date.parse(exp) - now) / 86_400_000);
  return null;
}
/** Oxirgi zaxira yoshi (soat). */
export function backupAgeHours(c: CheckView, now = Date.now()): number | null {
  const d = obj(c.data);
  const h = num(d.ageHours);
  if (h != null) return h;
  const at = d.lastAt ?? d.at ?? d.finishedAt ?? d.mtime;
  if (typeof at === "string" && !Number.isNaN(Date.parse(at))) return (now - Date.parse(at)) / 3_600_000;
  return null;
}
export const dataField = (v: unknown, k: string): unknown => obj(v)[k];

/** Umumiy holat: agent yo'q → UNKNOWN; agent jim, CRIT tekshiruv yoki kritik hodisa → CRIT; WARN/HIGH → WARN. */
export function overall(s: MonitorSnapshot | null): CheckStatusT {
  if (!s || !s.agent) return "UNKNOWN";
  if (s.agent.stale || s.counts.critical > 0 || s.checks.some((c) => c.status === "CRIT")) return "CRIT";
  if (s.counts.high > 0 || s.checks.some((c) => c.status === "WARN")) return "WARN";
  return "OK";
}

export const tenantCheckKeys = (slug: string) => ({ web: `http:tenant:${slug}`, db: `db:tenant:${slug}`, unit: `unit:insof-erp@${slug}` });

/** Tavsiya etilgan amallarni xavfsiz ko'rinishga keltirish (Json → massiv). */
export function asSuggested(v: unknown): SuggestedAction[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const o = obj(x);
    return typeof o.type === "string" ? [{ type: o.type, params: obj(o.params), label: typeof o.label === "string" ? o.label : undefined }] : [];
  });
}
