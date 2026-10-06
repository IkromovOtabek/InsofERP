/**
 * `db:stats` ServiceCheck.data shakli (agent yozadi, /superadmin/baza o'qiydi). Sof turlar + xavfsiz o'quvchi.
 * `traffic:nginx` shakli — nginx.ts dagi TrafficData.
 */
import type { TrafficData } from "./nginx";

export type PgSession = {
  pid: number; db: string | null; user: string | null; app: string | null; client: string | null;
  state: string | null; waitType: string | null; wait: string | null;
  xactSec: number | null; querySec: number | null; stateSec: number | null;
  blockedBy: number[];
  /** literallari yashirilgan, qisqartirilgan matn */
  query: string;
  /** shu agent ulangan rol (insof) jarayoni — faqat shularni bekor qilish mumkin */
  mine: boolean;
  canCancel: boolean;
  canTerminate: boolean;
};

export type PgTable = {
  schema: string; name: string; totalBytes: number; heapBytes: number; estRows: number;
  live: number | null; dead: number | null; deadPct: number | null;
  lastAutovacuum: string | null; lastVacuum: string | null; lastAutoanalyze: string | null; lastAnalyze: string | null;
};

export type PgDbDetail = {
  ok: boolean; error?: string;
  tables: PgTable[]; deadTables: PgTable[];
  tableCount: number; live: number; dead: number; deadPct: number | null;
};

export type PgDbInfo = {
  name: string;
  /** korxona slug'i yoki "control" */
  owner: string | null;
  sizeBytes: number | null; growth1d: number | null; growth7d: number | null;
  conns: number; xactCommit: number; xactRollback: number; cacheHit: number | null;
  deadlocks: number; tempBytes: number;
  detail: PgDbDetail | null;
};

export type PgStatement = {
  db: string | null; calls: number; totalMs: number; meanMs: number; rows: number;
  hitPct: number | null; sharePct: number | null; query: string;
};

export type StatementsState = "ok" | "not_installed" | "not_loaded" | "error";

export type DbStatsData = {
  generatedAt: string;
  server: {
    version: string; role: string; superuser: boolean; readAllStats: boolean; signalBackend: boolean;
    maxConnections: number; startedAt: string | null; controlDb: string;
  };
  connections: { total: number; max: number; pct: number | null; byState: Record<string, number>; byDb: Record<string, number>; background: number };
  cacheHit: number | null;
  lockWaits: number;
  idleInXactLong: number;
  databases: PgDbInfo[];
  longXacts: PgSession[];
  longQueries: PgSession[];
  lockWaiters: PgSession[];
  statements: { state: StatementsState; error?: string; list: PgStatement[]; db: string };
  /** baza → [[YYYY-MM-DD, bayt], ...] (oxirgi 35 kun) — kunlik o'sish shundan */
  history: Record<string, [string, number][]>;
  problems: string[];
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** ServiceCheck.data → DbStatsData (agent eski/yangi versiyasi bo'lsa ham sahifa yiqilmasin). */
export function asDbStats(v: unknown): DbStatsData | null {
  if (!isObj(v) || typeof v.generatedAt !== "string" || !isObj(v.server) || !isObj(v.connections)) return null;
  const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const st = isObj(v.statements) ? v.statements : {};
  return {
    ...(v as unknown as DbStatsData),
    databases: arr<PgDbInfo>(v.databases),
    longXacts: arr<PgSession>(v.longXacts),
    longQueries: arr<PgSession>(v.longQueries),
    lockWaiters: arr<PgSession>(v.lockWaiters),
    statements: { state: (st.state as StatementsState) ?? "error", error: typeof st.error === "string" ? st.error : undefined, list: arr<PgStatement>(st.list), db: typeof st.db === "string" ? st.db : "" },
    history: isObj(v.history) ? (v.history as DbStatsData["history"]) : {},
    problems: arr<string>(v.problems),
  };
}

export function asTraffic(v: unknown): TrafficData | null {
  if (!isObj(v) || typeof v.generatedAt !== "string" || !isObj(v.w5) || !isObj(v.w60)) return null;
  const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  return {
    ...(v as unknown as TrafficData),
    perMinute: arr(v.perMinute), domains: arr(v.domains), topIps: arr(v.topIps), slowPaths: arr(v.slowPaths),
    limitZones: arr(v.limitZones), upstream: arr(v.upstream),
    format: isObj(v.format) ? (v.format as TrafficData["format"]) : { hasHost: false, hasRequestTime: false },
    source: isObj(v.source) ? (v.source as TrafficData["source"]) : { access: "", error: "", accessLines: 0, errorLines: 0, parsedOk: 0, parseFail: 0, truncated: false, problems: [] },
  };
}

/** Kunlik tarix: bugungi qiymatni yozadi, 35 kundan eskisini tashlaydi; 1 va 7 kunlik o'sishni qaytaradi. */
export function updateSizeHistory(prev: [string, number][] | undefined, today: string, size: number): { hist: [string, number][]; growth1d: number | null; growth7d: number | null } {
  const list = (Array.isArray(prev) ? prev : []).filter((e): e is [string, number] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number" && e[0] < today);
  // Kecha yozilgan oxirgi qiymat (kecha agent ishlamagan bo'lsa — o'sish noma'lum, noto'g'ri "1 kunlik" demaymiz)
  const before = list.find((e) => e[0] === shiftDay(today, -1)) ?? null;
  const d7 = shiftDay(today, -7);
  const older = [...list].reverse().find((e) => e[0] <= d7) ?? null;
  const hist = [...list, [today, size] as [string, number]].slice(-35);
  return { hist, growth1d: before ? size - before[1] : null, growth7d: older ? size - older[1] : null };
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return t.toISOString().slice(0, 10);
}
