/**
 * insof-agent: PostgreSQL statistikasi, nginx trafik tahlili va baza amallari (PG_CANCEL, PG_TERMINATE, VACUUM_ANALYZE).
 * scripts/insof-agent.ts chaqiradi; sof parserlar va shakllar — src/lib/control/dbtraffic/*.
 *
 * Baza: agent `insof` roli bilan (superuser EMAS) control baza ulanishi (CONTROL_DATABASE_URL) va korxona bazalari
 * (TENANT_DATABASE_URL shabloni yoki tenants/<slug>.env DATABASE_URL) orqali o'qiydi. sudo kerak emas.
 * Trafik: /var/log/nginx/access.log va error.log OXIRIDAN orqaga qarab bo'laklab o'qiladi (butun fayl xotiraga
 * yuklanmaydi), 60 daqiqadan eski qatorga yetganda to'xtaydi; rotatsiya bo'lgan bo'lsa `.1` fayl ham. deploy ∈ adm.
 */
import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient as ControlClient } from "@/generated/control";
import type { PrismaClient as RawClient } from "@/generated/prisma";
import { UNIT_RE } from "@/lib/control/monitor/contract";
import type { CheckResult, CheckStatusT, SuggestedAction, TenantRef } from "@/lib/control/monitor/types";
import { DBT_KEYS, DBT_THRESHOLDS, DOMAIN_RE, PG_DB_RE, TERMINATE_IDLE_SEC, type DbActionParams, type DbActionType } from "@/lib/control/dbtraffic/contract";
import { parseAccessLine, parseErrorLine, trafficStatus, upstreamStatus, TrafficAgg, type TrafficData } from "@/lib/control/dbtraffic/nginx";
import { maskSql } from "@/lib/control/dbtraffic/sql";
import { asDbStats, updateSizeHistory, type DbStatsData, type PgDbDetail, type PgDbInfo, type PgSession, type PgStatement, type PgTable, type StatementsState } from "@/lib/control/dbtraffic/types";
import { isTestDbUrl, isTestMode } from "@/lib/test-mode";
import { readEnvKeys } from "../env";

export type DbtCtx = {
  control: ControlClient;
  tenants: TenantRef[];
  appDir: string;
  controlPort: number;
  ecoPort: number | null;
  linux: boolean;
  log: (m: string) => void;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n").filter(Boolean).pop()?.slice(0, 300) ?? "xato";

function timeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => t && clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${label}: ${Math.round(ms / 1000)} s da tugamadi`)), ms); }),
  ]);
}

/* ───────────────────────── Baza ulanishlari ───────────────────────── */

let controlDbName: string | null = null;
async function controlDb(ctx: DbtCtx): Promise<string> {
  if (controlDbName) return controlDbName;
  const [r] = await ctx.control.$queryRaw<{ db: string }[]>`SELECT current_database()::text AS db`;
  return (controlDbName = r.db);
}

/** Baza manzili: control → CONTROL_DATABASE_URL; korxona → TENANT_DATABASE_URL shabloni, bo'lmasa tenants/<slug>.env. */
function dbUrl(name: string, ctx: DbtCtx): string {
  if (!PG_DB_RE.test(name)) throw new Error(`baza nomi noto'g'ri: ${name}`);
  let url: string | undefined;
  if (name === controlDbName) url = process.env.CONTROL_DATABASE_URL;
  else if (process.env.TENANT_DATABASE_URL?.includes("{db}")) url = process.env.TENANT_DATABASE_URL.replace("{db}", name);
  else {
    const t = ctx.tenants.find((x) => x.dbName === name);
    if (t && /^[a-z0-9-]{2,30}$/.test(t.slug)) url = readEnvKeys(path.join(ctx.appDir, "tenants", `${t.slug}.env`), ["DATABASE_URL"]).DATABASE_URL;
  }
  if (!url) throw new Error(`${name}: ulanish manzili yo'q (control.env da TENANT_DATABASE_URL="postgresql://insof:***@127.0.0.1:5432/{db}")`);
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`${name}: ulanish manzili noto'g'ri`); }
  if (decodeURIComponent(u.pathname.replace(/^\//, "")) !== name) throw new Error(`${name}: manzildagi baza nomi mos emas`);
  if (isTestMode() && !isTestDbUrl(url)) throw new Error(`[test-mode] ${name} lokal test bazasi emas`);
  return url;
}

function withParams(url: string, p: Record<string, string>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  return u.toString();
}

const clients = new Map<string, RawClient>();
async function newRawClient(url: string): Promise<RawClient> {
  const { PrismaClient } = await import("@/generated/prisma");
  return new PrismaClient({ datasourceUrl: url, log: [] });
}
/** Statistika uchun kichik (1 ulanishli) doimiy klient. */
async function statsClient(name: string, ctx: DbtCtx): Promise<RawClient | ControlClient> {
  if (name === (await controlDb(ctx))) return ctx.control;
  let c = clients.get(name);
  if (!c) {
    c = await newRawClient(withParams(dbUrl(name, ctx), { connection_limit: "1", pool_timeout: "10" }));
    clients.set(name, c);
  }
  return c;
}
export async function closeDbClients() {
  await Promise.allSettled([...clients.values()].map((c) => c.$disconnect()));
  clients.clear();
}

type Raw = Pick<RawClient, "$queryRaw" | "$queryRawUnsafe" | "$executeRawUnsafe">;
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : v == null ? 0 : Number(v) || 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v));
const isoOrNull = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);
const r1 = (v: number) => Math.round(v * 10) / 10;
const ratio = (hit: number, read: number) => (hit + read > 0 ? Math.round((hit / (hit + read)) * 10000) / 10000 : null);

/* ───────────────────────── Baza statistikasi (db:stats) ───────────────────────── */

type ActRow = {
  pid: number; db: string | null; usr: string | null; app: string | null; client: string | null; btype: string | null;
  state: string | null; wtype: string | null; wait: string | null; xact: number | null; qs: number | null; ss: number | null;
  blocked: number[] | null; query: string | null; mine: boolean;
};

function session(a: ActRow): PgSession {
  const idleTx = !!a.state?.startsWith("idle in transaction");
  return {
    pid: a.pid, db: a.db, user: a.usr, app: a.app ? a.app.slice(0, 60) : null, client: a.client,
    state: a.state, waitType: a.wtype, wait: a.wait,
    xactSec: a.xact != null ? Math.round(a.xact) : null, querySec: a.qs != null ? Math.round(a.qs) : null, stateSec: a.ss != null ? Math.round(a.ss) : null,
    blockedBy: Array.isArray(a.blocked) ? a.blocked.map(Number).slice(0, 10) : [],
    query: maskSql(a.query, 300), mine: !!a.mine,
    canCancel: !!a.mine && a.state === "active" && a.btype === "client backend",
    canTerminate: !!a.mine && idleTx && (a.ss ?? 0) > TERMINATE_IDLE_SEC && a.btype === "client backend",
  };
}

async function dbDetail(c: Raw): Promise<PgDbDetail> {
  const tableRow = (t: Record<string, unknown>): PgTable => {
    const live = numOrNull(t.live), dead = numOrNull(t.dead);
    return {
      schema: String(t.schema), name: String(t.name), totalBytes: num(t.total), heapBytes: num(t.heap), estRows: Math.round(num(t.est ?? t.live)),
      live, dead, deadPct: live != null && dead != null && live + dead > 0 ? r1((dead / (live + dead)) * 100) : null,
      lastAutovacuum: isoOrNull(t.last_autovacuum), lastVacuum: isoOrNull(t.last_vacuum),
      lastAutoanalyze: isoOrNull(t.last_autoanalyze), lastAnalyze: isoOrNull(t.last_analyze),
    };
  };
  const [tables, dead, [sum]] = await Promise.all([
    c.$queryRaw<Record<string, unknown>[]>`
      SELECT n.nspname::text AS schema, c.relname::text AS name, pg_total_relation_size(c.oid)::float8 AS total,
             pg_relation_size(c.oid)::float8 AS heap, GREATEST(c.reltuples, 0)::float8 AS est,
             s.n_live_tup::float8 AS live, s.n_dead_tup::float8 AS dead,
             s.last_autovacuum, s.last_vacuum, s.last_autoanalyze, s.last_analyze
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE c.relkind IN ('r', 'm', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
       ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10`,
    c.$queryRaw<Record<string, unknown>[]>`
      SELECT schemaname::text AS schema, relname::text AS name, pg_total_relation_size(relid)::float8 AS total,
             pg_relation_size(relid)::float8 AS heap, n_live_tup::float8 AS live, n_dead_tup::float8 AS dead,
             last_autovacuum, last_vacuum, last_autoanalyze, last_analyze
        FROM pg_stat_user_tables WHERE n_dead_tup >= 1000
       ORDER BY n_dead_tup::float8 / (n_live_tup + n_dead_tup + 1) DESC, n_dead_tup DESC LIMIT 5`,
    c.$queryRaw<{ live: number; dead: number; n: number }[]>`
      SELECT COALESCE(sum(n_live_tup), 0)::float8 AS live, COALESCE(sum(n_dead_tup), 0)::float8 AS dead, count(*)::int AS n FROM pg_stat_user_tables`,
  ]);
  const live = num(sum?.live), deadN = num(sum?.dead);
  return {
    ok: true, tables: tables.map(tableRow), deadTables: dead.map(tableRow), tableCount: num(sum?.n),
    live, dead: deadN, deadPct: live + deadN > 0 ? r1((deadN / (live + deadN)) * 100) : null,
  };
}

function statementsErr(e: unknown): { state: StatementsState; error: string } {
  const m = errMsg(e);
  if (/shared_preload_libraries/i.test(m)) return { state: "not_loaded", error: "pg_stat_statements shared_preload_libraries da yuklanmagan" };
  if (/42P01|does not exist/i.test(m)) return { state: "not_installed", error: "kengaytma o'rnatilmagan (CREATE EXTENSION pg_stat_statements)" };
  return { state: "error", error: m };
}

async function topStatements(c: Raw): Promise<PgStatement[]> {
  const rows = await c.$queryRaw<Record<string, unknown>[]>`
    SELECT d.datname::text AS db, s.calls::float8 AS calls, s.total_exec_time::float8 AS total, s.mean_exec_time::float8 AS mean,
           s.rows::float8 AS rows, s.shared_blks_hit::float8 AS hit, s.shared_blks_read::float8 AS read, left(s.query, 2000) AS query,
           (SELECT sum(total_exec_time) FROM pg_stat_statements)::float8 AS grand
      FROM pg_stat_statements s LEFT JOIN pg_database d ON d.oid = s.dbid
     ORDER BY s.total_exec_time DESC LIMIT 10`;
  return rows.map((r) => {
    const hit = num(r.hit), read = num(r.read), grand = num(r.grand);
    const h = ratio(hit, read);
    return {
      db: (r.db as string | null) ?? null, calls: num(r.calls), totalMs: Math.round(num(r.total)), meanMs: r1(num(r.mean)), rows: num(r.rows),
      hitPct: h != null ? r1(h * 100) : null, sharePct: grand > 0 ? r1((num(r.total) / grand) * 100) : null,
      query: maskSql(r.query as string | null, 400),
    };
  });
}

export async function dbStatsChecks(ctx: DbtCtx): Promise<CheckResult[]> {
  const t0 = Date.now();
  const c = ctx.control;
  const ctl = await controlDb(ctx);
  const [info] = await c.$queryRaw<{ role: string; max: number; version: string; started: Date | null; super: boolean; readall: boolean; signal: boolean }[]>`
    SELECT current_user::text AS role, current_setting('max_connections')::int AS max, current_setting('server_version')::text AS version,
           pg_postmaster_start_time() AS started,
           COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS super,
           pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER') AS readall,
           pg_has_role(current_user, 'pg_signal_backend', 'MEMBER') AS signal`;
  const [dbs, acts, prev] = await Promise.all([
    c.$queryRaw<Record<string, unknown>[]>`
      SELECT d.datname::text AS name,
             CASE WHEN has_database_privilege(d.datname, 'CONNECT') THEN pg_database_size(d.datname)::float8 END AS size,
             COALESCE(s.numbackends, 0)::int AS conns, COALESCE(s.xact_commit, 0)::float8 AS xc, COALESCE(s.xact_rollback, 0)::float8 AS xr,
             COALESCE(s.blks_hit, 0)::float8 AS hit, COALESCE(s.blks_read, 0)::float8 AS rd,
             COALESCE(s.deadlocks, 0)::float8 AS dl, COALESCE(s.temp_bytes, 0)::float8 AS tb
        FROM pg_database d LEFT JOIN pg_stat_database s ON s.datid = d.oid
       WHERE NOT d.datistemplate AND d.datallowconn ORDER BY d.datname`,
    c.$queryRaw<ActRow[]>`
      SELECT pid, datname::text AS db, usename::text AS usr, application_name::text AS app, client_addr::text AS client,
             backend_type::text AS btype, state::text AS state, wait_event_type::text AS wtype, wait_event::text AS wait,
             EXTRACT(EPOCH FROM now() - xact_start)::float8 AS xact, EXTRACT(EPOCH FROM now() - query_start)::float8 AS qs,
             EXTRACT(EPOCH FROM now() - state_change)::float8 AS ss,
             CASE WHEN wait_event_type = 'Lock' THEN pg_blocking_pids(pid) ELSE '{}'::int[] END AS blocked,
             left(query, 2000) AS query, COALESCE(usename = current_user, false) AS mine
        FROM pg_stat_activity WHERE pid <> pg_backend_pid()`,
    c.serviceCheck.findUnique({ where: { key: DBT_KEYS.dbStats }, select: { data: true } }),
  ]);
  const prevData = asDbStats(prev?.data);
  const problems: string[] = [];

  // Ulanishlar
  const clientsRows = acts.filter((a) => a.btype === "client backend");
  const byState: Record<string, number> = {};
  const byDb: Record<string, number> = {};
  for (const a of clientsRows) {
    const s = a.state ?? "(ko'rinmaydi)";
    byState[s] = (byState[s] ?? 0) + 1;
    if (a.db) byDb[a.db] = (byDb[a.db] ?? 0) + 1;
  }
  const total = acts.length + 1; // + shu so'rov
  const T = DBT_THRESHOLDS;
  const longXacts = clientsRows.filter((a) => (a.xact ?? 0) > T.longXactSec).sort((a, b) => (b.xact ?? 0) - (a.xact ?? 0)).slice(0, 20).map(session);
  const longQueries = clientsRows.filter((a) => a.state === "active" && (a.qs ?? 0) > T.longQuerySec).sort((a, b) => (b.qs ?? 0) - (a.qs ?? 0)).slice(0, 20).map(session);
  const lockWaiters = acts.filter((a) => a.wtype === "Lock").sort((a, b) => (b.qs ?? 0) - (a.qs ?? 0)).slice(0, 20).map(session);
  const idleLong = clientsRows.filter((a) => a.state?.startsWith("idle in transaction") && (a.ss ?? 0) > T.idleInXactWarnSec);
  if (idleLong.length) problems.push(`${idleLong.length} ta ulanish 10+ daqiqa «idle in transaction» (qulf ushlab turibdi, autovacuum'ga to'sqinlik)`);
  const lockLong = lockWaiters.filter((s) => (s.querySec ?? 0) > T.lockWaitWarnSec);
  if (lockLong.length) problems.push(`${lockLong.length} ta so'rov 1+ daqiqa qulf kutmoqda`);

  // Bazalar
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, server TZ
  const history: DbStatsData["history"] = {};
  const owners = new Map<string, string>([[ctl, "control"], ...ctx.tenants.map((t) => [t.dbName, t.slug] as [string, string])]);
  let hitAll = 0, readAll = 0;
  const databases: PgDbInfo[] = [];
  for (const d of dbs) {
    const name = String(d.name);
    const size = numOrNull(d.size);
    let growth1d: number | null = null, growth7d: number | null = null;
    if (size != null) {
      const h = updateSizeHistory(prevData?.history[name], today, size);
      history[name] = h.hist; growth1d = h.growth1d; growth7d = h.growth7d;
    }
    const hit = num(d.hit), rd = num(d.rd);
    hitAll += hit; readAll += rd;
    const cacheHit = ratio(hit, rd);
    if (cacheHit != null && hit + rd >= T.cacheHitMinBlocks && cacheHit < T.cacheHitWarn) problems.push(`${name}: cache hit ${r1(cacheHit * 100)}% (< ${T.cacheHitWarn * 100}%) — shared_buffers kam yoki ko'p ketma-ket o'qish`);
    databases.push({
      name, owner: owners.get(name) ?? null, sizeBytes: size, growth1d, growth7d, conns: num(d.conns), xactCommit: num(d.xc), xactRollback: num(d.xr),
      cacheHit, deadlocks: num(d.dl), tempBytes: num(d.tb), detail: null,
    });
  }

  // Har ma'lum baza (control + korxonalar) ichidagi jadvallar
  const known = databases.filter((d) => d.owner && d.sizeBytes != null).slice(0, 40);
  await Promise.all(known.map(async (d) => {
    try {
      const cl = await statsClient(d.name, ctx);
      d.detail = await timeout(dbDetail(cl), 20_000, d.name);
      for (const t of [...d.detail.tables, ...d.detail.deadTables]) {
        if ((t.dead ?? 0) >= T.deadTupMin && (t.deadPct ?? 0) >= T.deadRatioWarn * 100) {
          const msg = `${d.name}.${t.name}: o'lik qatorlar ${t.deadPct}% (${t.dead}) — autovacuum ulgurmayapti`;
          if (!problems.includes(msg)) problems.push(msg);
        }
      }
    } catch (e) {
      d.detail = { ok: false, error: errMsg(e), tables: [], deadTables: [], tableCount: 0, live: 0, dead: 0, deadPct: null };
    }
  }));

  // pg_stat_statements: avval control bazada, bo'lmasa korxona bazalarida (kengaytma qaysi bazada yaratilgan bo'lsa)
  let statements: DbStatsData["statements"] = { state: "not_installed", list: [], db: ctl };
  for (const d of [ctl, ...known.map((k) => k.name).filter((n) => n !== ctl)]) {
    try {
      const cl = await statsClient(d, ctx);
      statements = { state: "ok", list: await timeout(topStatements(cl), 15_000, "pg_stat_statements"), db: d };
      break;
    } catch (e) {
      const er = statementsErr(e);
      if (er.state !== "not_installed" || d === ctl) statements = { ...er, list: [], db: d };
      if (er.state !== "not_installed") break; // yuklanmagan/xato — boshqa bazada ham shunday
    }
  }

  const cacheHit = ratio(hitAll, readAll);
  const data: DbStatsData = {
    generatedAt: new Date().toISOString(),
    server: { version: info.version, role: info.role, superuser: !!info.super, readAllStats: !!info.readall, signalBackend: !!info.signal, maxConnections: info.max, startedAt: isoOrNull(info.started), controlDb: ctl },
    connections: { total, max: info.max, pct: info.max > 0 ? r1((total / info.max) * 100) : null, byState, byDb, background: acts.length - clientsRows.length },
    cacheHit, lockWaits: lockWaiters.length, idleInXactLong: idleLong.length,
    databases, longXacts, longQueries, lockWaiters, statements, history, problems,
  };
  const status: CheckStatusT = problems.length ? "WARN" : "OK";
  return [{
    key: DBT_KEYS.dbStats, kind: "db", target: "PostgreSQL statistikasi", status, latencyMs: Date.now() - t0,
    message: `${databases.length} baza, ulanishlar ${total}/${info.max}, cache hit ${cacheHit != null ? r1(cacheHit * 100) + "%" : "—"}, uzoq tranzaksiya ${longXacts.length}, qulf kutish ${lockWaiters.length}${problems.length ? ` — ${problems[0]}` : ""}`,
    data: data as unknown as Record<string, unknown>,
    incident: { category: "performance", title: `Postgres: ${problems[0] ?? "muammo"}`.slice(0, 300) },
  }];
}

/* ───────────────────────── Trafik (nginx loglari) ───────────────────────── */

// Funksiya: modul control.env yuklanishidan oldin import qilinadi
const accessLog = () => process.env.AGENT_NGINX_ACCESS_LOG || "/var/log/nginx/access.log";
const errorLog = () => process.env.AGENT_NGINX_ERROR_LOG || "/var/log/nginx/error.log";
const MAX_READ_BYTES = 512 * 1024 * 1024;
const CHUNK = 256 * 1024;

/**
 * Faylni oxiridan boshiga qarab qatorma-qator o'qiydi (har safar CHUNK bayt). `onLine` false qaytarsa to'xtaydi.
 * Qaytadi: "stopped" (callback to'xtatdi), "start" (fayl boshiga yetdi), "limit" (bayt chegarasi).
 */
export async function readLinesBackward(file: string, onLine: (line: string) => boolean, budget: { bytes: number }): Promise<"stopped" | "start" | "limit"> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    let pos = size;
    let tail: Buffer = Buffer.alloc(0);
    while (pos > 0) {
      if (budget.bytes <= 0) return "limit";
      const len = Math.min(CHUNK, pos);
      pos -= len;
      budget.bytes -= len;
      const b = Buffer.alloc(len);
      await fh.read(b, 0, len, pos);
      const buf = tail.length ? Buffer.concat([b, tail]) : b;
      let end = buf.length;
      while (end > 0) {
        const i = buf.lastIndexOf(10, end - 1);
        if (i < 0) break;
        if (end - i > 1) {
          const line = buf.toString("utf8", i + 1, end);
          if (!onLine(line)) return "stopped";
        }
        end = i;
      }
      // Qolgan bo'lak (qator boshi oldingi chunk'da) — juda uzun qator xotirani to'ldirmasin
      tail = end > 65_536 ? Buffer.alloc(0) : Buffer.from(buf.subarray(0, end));
    }
    if (tail.length && !onLine(tail.toString("utf8"))) return "stopped";
    return "start";
  } finally {
    await fh.close();
  }
}

type FileRead = { lines: number; problem: string | null; truncated: boolean };

/** Asosiy fayl + rotatsiya qilingan `.1` (agar oyna boshiga yetmagan bo'lsak). */
async function readWindow(file: string, onLine: (l: string) => boolean, budget: { bytes: number }): Promise<FileRead> {
  let lines = 0;
  const counting = (l: string) => { lines++; return onLine(l); };
  for (const f of [file, `${file}.1`]) {
    let res: Awaited<ReturnType<typeof readLinesBackward>>;
    try { res = await readLinesBackward(f, counting, budget); }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (f !== file && code === "ENOENT") break;
      const problem = code === "EACCES"
        ? `${f}: o'qishga ruxsat yo'q — deploy foydalanuvchisi adm guruhida emas (sudo usermod -aG adm deploy && sudo systemctl restart insof-agent)`
        : code === "ENOENT" ? `${f} topilmadi` : `${f}: ${errMsg(e)}`;
      return { lines, problem, truncated: false };
    }
    if (res === "stopped") break;
    if (res === "limit") return { lines, problem: null, truncated: true };
  }
  return { lines, problem: null, truncated: false };
}

function restartFor(addr: string, ctx: DbtCtx): SuggestedAction | null {
  const m = /^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{2,5})$/.exec(addr);
  if (!m) return null;
  const port = Number(m[1]);
  const t = ctx.tenants.find((x) => x.port === port);
  const unit = t ? `insof-erp@${t.slug}` : port === ctx.controlPort ? "insof-control" : port === ctx.ecoPort ? "insof-eco" : null;
  return unit && UNIT_RE.test(unit) ? { type: "RESTART_UNIT", params: { unit }, label: `${unit} ni qayta ishga tushirish` } : null;
}

export async function trafficChecks(ctx: DbtCtx): Promise<CheckResult[]> {
  const t0 = Date.now();
  const ACCESS_LOG = accessLog(), ERROR_LOG = errorLog();
  const base = { key: DBT_KEYS.traffic, kind: "traffic", target: "Nginx trafik" };
  const exists = await stat(ACCESS_LOG).then(() => true, (e: NodeJS.ErrnoException) => e.code !== "ENOENT");
  if (!exists && !ctx.linux) return [{ ...base, status: "UNKNOWN", message: `${ACCESS_LOG} yo'q (lokal muhit) — tekshirilmadi` }];

  const agg = new TrafficAgg(Date.now());
  const stopBefore = agg.since60 - 120_000; // log qatorlari biroz tartibsiz bo'lishi mumkin — 2 daq zaxira
  const budget = { bytes: MAX_READ_BYTES };
  const acc = await readWindow(ACCESS_LOG, (line) => {
    const r = parseAccessLine(line);
    if (!r) { agg.parseFail++; return true; }
    agg.parsedOk++;
    if (!agg.access(r) && r.t < stopBefore) return false;
    return true;
  }, budget);
  const err = await readWindow(ERROR_LOG, (line) => {
    const r = parseErrorLine(line);
    if (!r) return true; // ko'p qatorli xabarlar davomi
    if (!agg.error(r) && r.t < stopBefore) return false;
    return true;
  }, { bytes: 128 * 1024 * 1024 });

  const problems = [acc.problem, err.problem].filter((x): x is string => !!x);
  const data: TrafficData = agg.result({ access: ACCESS_LOG, error: ERROR_LOG, accessLines: acc.lines, errorLines: err.lines, truncated: acc.truncated || err.truncated, problems });
  if (!data.format.hasRequestTime && data.w60.total > 0) problems.push("access.log formatida $request_time yo'q — eng sekin yo'llar hisoblanmaydi (PLATFORMA.md → Baza va trafik)");
  if (!data.format.hasHost && data.w60.total > 0) problems.push("access.log formatida $host yo'q — domen bo'yicha ajratib bo'lmaydi (PLATFORMA.md → Baza va trafik)");

  const out: CheckResult[] = [];
  const st = acc.problem ? "UNKNOWN" : trafficStatus(data);
  const w = data.w5;
  out.push({
    ...base, status: st, latencyMs: Date.now() - t0,
    message: acc.problem ?? `${w.perMin} so'rov/daq (5 daq), 4xx ${w.pct4xx ?? 0}%, 5xx ${w.pct5xx ?? 0}%, 429: ${w.s429}; 60 daq: ${data.w60.total} so'rov`,
    data: data as unknown as Record<string, unknown>,
    incident: { category: "availability", title: `Nginx: 5xx ulushi ${w.pct5xx ?? 0}% (oxirgi 5 daq, ${w.total} so'rov)`, critSeverity: "HIGH" },
  });

  // Upstream xatolari domen bo'yicha (error.log): 60 daqiqada xato bo'lgan domenlar — holat 5 daqiqalik songa qarab
  for (const u of data.upstream.slice(0, 20)) {
    const key = DOMAIN_RE.test(u.domain) ? DBT_KEYS.upstream(u.domain) : DBT_KEYS.upstream("unknown");
    const addr = u.upstreams[0]?.addr ?? null;
    const status = upstreamStatus(u);
    const refused = u.refused5 > 0;
    const action = addr ? restartFor(addr, ctx) : null;
    out.push({
      key, kind: "traffic", target: `${u.domain}${addr ? ` → ${addr}` : ""} (upstream)`, status,
      message: `5 daq: ${u.n5} xato${refused ? ` (${u.refused5} ta «Connection refused»)` : ""}, 60 daq: ${u.n60}; oxirgisi: ${u.head}`,
      data: { domain: u.domain, n5: u.n5, n60: u.n60, refused5: u.refused5, subs: u.subs, upstreams: u.upstreams, last: u.last },
      incident: {
        category: "availability", critSeverity: "HIGH",
        title: refused && addr ? `${u.domain}: ${addr} ishlamayapti (Connection refused, ${u.n5} ta / 5 daq)` : `${u.domain}: upstream xatolari ${u.n5} ta / 5 daq${addr ? ` (${addr})` : ""}`,
        suggestedActions: action ? [action] : [],
      },
    });
  }
  return out;
}

/* ───────────────────────── Amallar ───────────────────────── */

export type DbActionOutcome = { status: "DONE" | "FAILED" | "REJECTED"; output: string };

async function knownDbs(ctx: DbtCtx): Promise<Set<string>> {
  return new Set([await controlDb(ctx), ...ctx.tenants.map((t) => t.dbName)]);
}

type ProcRow = { pid: number; usr: string | null; state: string | null; btype: string | null; mine: boolean; qs: number | null; ss: number | null; query: string | null };

async function proc(c: ControlClient, pid: number, db: string): Promise<ProcRow | null> {
  const rows = await c.$queryRaw<ProcRow[]>`
    SELECT pid, usename::text AS usr, state::text AS state, backend_type::text AS btype, COALESCE(usename = current_user, false) AS mine,
           EXTRACT(EPOCH FROM now() - query_start)::float8 AS qs, EXTRACT(EPOCH FROM now() - state_change)::float8 AS ss, left(query, 2000) AS query
      FROM pg_stat_activity WHERE pid = ${pid}::int AND datname = ${db} AND pid <> pg_backend_pid()`;
  return rows[0] ?? null;
}
const describe = (p: ProcRow) => `pid ${p.pid}, rol ${p.usr ?? "?"}, holat ${p.state ?? "?"}, so'rov ${Math.round(p.qs ?? 0)} s, holatda ${Math.round(p.ss ?? 0)} s\nSo'rov: ${maskSql(p.query, 300)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function executeDbAction(type: DbActionType, params: DbActionParams, ctx: DbtCtx): Promise<DbActionOutcome> {
  const db = params.db;
  if (!(await knownDbs(ctx)).has(db)) return { status: "REJECTED", output: `${db} — control yoki korxona bazasi emas (faqat ro'yxatdagi bazalar)` };
  const c = ctx.control;

  if (type === "PG_CANCEL" || type === "PG_TERMINATE") {
    const pid = Number(params.pid);
    const p = await proc(c, pid, db);
    if (!p) return { status: "FAILED", output: `${db} bazasida pid ${pid} topilmadi — so'rov allaqachon tugagan bo'lishi mumkin` };
    if (!p.mine) return { status: "REJECTED", output: `${describe(p)}\nBu jarayon boshqa rolniki (${p.usr ?? "ko'rinmaydi"}). Agent «${(await c.$queryRaw<{ r: string }[]>`SELECT current_user::text AS r`)[0].r}» roli bilan ulanadi va superuser emas — faqat o'z rolining jarayonlarini to'xtata oladi.` };
    if (p.btype !== "client backend") return { status: "REJECTED", output: `${describe(p)}\nBu mijoz ulanishi emas (${p.btype}) — tegilmaydi` };
    if (type === "PG_CANCEL") {
      if (p.state !== "active") return { status: "FAILED", output: `${describe(p)}\nFaol so'rov yo'q (holat: ${p.state}) — bekor qiladigan narsa yo'q` };
      const r = await c.$queryRaw<{ ok: boolean }[]>`
        SELECT pg_cancel_backend(pid) AS ok FROM pg_stat_activity
         WHERE pid = ${pid}::int AND datname = ${db} AND usename = current_user AND state = 'active'
           AND backend_type = 'client backend' AND pid <> pg_backend_pid()`;
      if (!r.length) return { status: "FAILED", output: `${describe(p)}\nHolat o'zgardi (so'rov tugadi) — bekor qilinmadi` };
      if (!r[0].ok) return { status: "FAILED", output: `${describe(p)}\npg_cancel_backend false qaytardi` };
      await sleep(1500);
      const after = await proc(c, pid, db);
      return { status: "DONE", output: `${describe(p)}\npg_cancel_backend(${pid}) → true\nKeyin: ${after ? `holat ${after.state}` : "ulanish yopilgan"}` };
    }
    // PG_TERMINATE: faqat uzoq "idle in transaction"
    if (!p.state?.startsWith("idle in transaction") || (p.ss ?? 0) <= TERMINATE_IDLE_SEC) {
      return { status: "REJECTED", output: `${describe(p)}\nUzish faqat ${TERMINATE_IDLE_SEC / 60} daqiqadan ortiq «idle in transaction» turgan ulanishga ruxsat etilgan. Faol so'rovni «bekor qilish» (PG_CANCEL) bilan to'xtating.` };
    }
    const r = await c.$queryRaw<{ ok: boolean }[]>`
      SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
       WHERE pid = ${pid}::int AND datname = ${db} AND usename = current_user AND backend_type = 'client backend'
         AND state IN ('idle in transaction', 'idle in transaction (aborted)')
         AND state_change < now() - ${TERMINATE_IDLE_SEC}::int * interval '1 second' AND pid <> pg_backend_pid()`;
    if (!r.length) return { status: "FAILED", output: `${describe(p)}\nHolat o'zgardi — uzilmadi` };
    await sleep(1000);
    const after = await proc(c, pid, db);
    return { status: r[0].ok ? "DONE" : "FAILED", output: `${describe(p)}\npg_terminate_backend(${pid}) → ${r[0].ok}\nKeyin: ${after ? `hali bor (${after.state})` : "ulanish yopildi, tranzaksiya bekor qilindi"}` };
  }

  // VACUUM_ANALYZE — alohida (vaqtinchalik) ulanish: statistika klientining yagona ulanishini band qilmasin
  const cl = await newRawClient(withParams(dbUrl(db, ctx), { connection_limit: "1", pool_timeout: "30" }));
  try {
    const t0 = Date.now();
    const lines: string[] = [];
    if (params.table) {
      const found = await cl.$queryRaw<{ qname: string; own: boolean; dbown: boolean }[]>`
        SELECT format('%I.%I', n.nspname, c.relname) AS qname, pg_has_role(c.relowner, 'USAGE') AS own,
               (SELECT pg_has_role(datdba, 'USAGE') FROM pg_database WHERE datname = current_database()) AS dbown
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = ${params.table} AND c.relkind IN ('r', 'm', 'p')`;
      const f = found[0];
      if (!f) return { status: "FAILED", output: `${db}: public.${params.table} jadvali topilmadi` };
      if (!/^(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)\.(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)$/.test(f.qname)) return { status: "REJECTED", output: `kutilmagan identifikator: ${f.qname}` };
      if (!f.own && !f.dbown) return { status: "FAILED", output: `${f.qname}: jadval egasi bu rol emas — VACUUM faqat egasi (yoki superuser) uchun` };
      const stat0 = await tableDead(cl, params.table);
      await timeout(cl.$executeRawUnsafe(`VACUUM (ANALYZE) ${f.qname}`), 15 * 60_000, "VACUUM");
      await sleep(1000);
      const stat1 = await tableDead(cl, params.table);
      lines.push(`VACUUM (ANALYZE) ${f.qname} — ${db}`, `O'lik qatorlar: ${stat0 ?? "?"} → ${stat1 ?? "?"}`);
    } else {
      const [s0] = await cl.$queryRaw<{ dead: number }[]>`SELECT COALESCE(sum(n_dead_tup), 0)::float8 AS dead FROM pg_stat_user_tables`;
      await timeout(cl.$executeRawUnsafe("VACUUM (ANALYZE)"), 60 * 60_000, "VACUUM");
      await sleep(1000);
      const [s1] = await cl.$queryRaw<{ dead: number }[]>`SELECT COALESCE(sum(n_dead_tup), 0)::float8 AS dead FROM pg_stat_user_tables`;
      lines.push(`VACUUM (ANALYZE) — butun ${db} bazasi (egasi bo'lmagan jadvallar o'tkazib yuboriladi)`, `O'lik qatorlar jami: ${num(s0?.dead)} → ${num(s1?.dead)}`);
    }
    lines.push(`Davomiyligi: ${Math.round((Date.now() - t0) / 100) / 10} s`);
    return { status: "DONE", output: lines.join("\n") };
  } finally {
    await cl.$disconnect().catch(() => {});
  }
}

async function tableDead(c: Raw, table: string): Promise<number | null> {
  const r = await c.$queryRaw<{ dead: number }[]>`SELECT n_dead_tup::float8 AS dead FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname = ${table}`;
  return r[0] ? num(r[0].dead) : null;
}
