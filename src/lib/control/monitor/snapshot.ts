import { createHash } from "node:crypto";
import { control } from "../db";
import { AGENT_STALE_MS } from "./contract";
import { HEAVY_CHECK_KEYS } from "../dbtraffic/contract";
import { asSuggested, dataField, type ActionView, type MonitorSnapshot, type SeriesView } from "./shared";

/**
 * Monitoring paneli uchun ixcham surat — insof-agent yozgan jadvallardan faqat O'QIYDI.
 * SSE oqimi (/superadmin/api/stream) va sahifalarning birinchi chizilishi shu bitta funksiyadan foydalanadi.
 *
 * Bir nechta oyna/admin bir vaqtda ulansa bazaga har biri alohida bormasin: natija ~2.5 s keshlanadi va
 * bir vaqtdagi so'rovlar bitta va'dani (promise) bo'lishadi.
 */
const SERIES_POINTS = 60;
const TTL_MS = 2500;

const n = (v: bigint | number | null | undefined) => (v == null ? null : Number(v));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const r1 = (v: number) => Math.round(v * 10) / 10;

async function build(): Promise<MonitorSnapshot> {
  const now = Date.now();
  const [latest, heartbeat, checks, incidents, grouped, actions, report, tenants] = await Promise.all([
    control.hostSnapshot.findFirst({ orderBy: { takenAt: "desc" } }),
    control.agentHeartbeat.findUnique({ where: { id: "main" } }),
    control.serviceCheck.findMany({ orderBy: [{ kind: "asc" }, { target: "asc" }] }),
    control.incident.findMany({
      where: { status: { in: ["OPEN", "ACKED"] } },
      orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
      take: 50,
      select: { id: true, key: true, source: true, category: true, severity: true, status: true, title: true, tenantId: true, count: true, firstSeenAt: true, lastSeenAt: true, suggestedActions: true },
    }),
    control.incident.groupBy({ by: ["status", "severity"], where: { status: { in: ["OPEN", "ACKED"] } }, _count: { _all: true } }),
    control.agentAction.findMany({ orderBy: { requestedAt: "desc" }, take: 20 }),
    control.securityReport.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, grade: true, summary: true, trigger: true, model: true, items: true } }),
    control.tenant.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], select: { id: true, slug: true, name: true, status: true, lastError: true, lastSeenAt: true, lastStats: true } }),
  ]);

  const series: SeriesView = { t: [], cpu: [], mem: [], load: [], disk: [], rx: [], tx: [] };
  if (latest) {
    const pts = await control.hostSnapshot.findMany({
      where: { hostname: latest.hostname }, orderBy: { takenAt: "desc" }, take: SERIES_POINTS,
      select: { takenAt: true, cpuPct: true, load1: true, memTotal: true, memUsed: true, diskTotal: true, diskUsed: true, netRxBps: true, netTxBps: true },
    });
    for (const p of pts.reverse()) {
      series.t.push(p.takenAt.getTime());
      series.cpu.push(r1(p.cpuPct));
      series.mem.push(p.memTotal > 0n ? r1((Number(p.memUsed) / Number(p.memTotal)) * 100) : 0);
      series.load.push(Math.round(p.load1 * 100) / 100);
      series.disk.push(p.diskTotal > 0n ? r1((Number(p.diskUsed) / Number(p.diskTotal)) * 100) : 0);
      series.rx.push(Number(p.netRxBps ?? 0));
      series.tx.push(Number(p.netTxBps ?? 0));
    }
  }

  const adminIds = [...new Set(actions.map((a) => a.requestedById).filter((x): x is string => !!x))];
  const admins = adminIds.length ? await control.superAdmin.findMany({ where: { id: { in: adminIds } }, select: { id: true, fullName: true } }) : [];
  const adminName = new Map(admins.map((a) => [a.id, a.fullName]));

  const counts = { open: 0, acked: 0, critical: 0, high: 0 };
  for (const g of grouped) {
    const c = g._count._all;
    if (g.status === "OPEN") counts.open += c; else counts.acked += c;
    if (g.severity === "CRITICAL") counts.critical += c;
    if (g.severity === "HIGH") counts.high += c;
  }

  const httpCheck = new Map(checks.filter((c) => c.key.startsWith("http:tenant:")).map((c) => [c.key.slice("http:tenant:".length), c]));
  const extra = (latest?.extra ?? {}) as Record<string, unknown>;

  return {
    host: latest ? {
      hostname: latest.hostname, takenAt: latest.takenAt.toISOString(), cpuPct: r1(latest.cpuPct),
      load: [latest.load1, latest.load5, latest.load15],
      memTotal: Number(latest.memTotal), memUsed: Number(latest.memUsed), swapTotal: Number(latest.swapTotal), swapUsed: Number(latest.swapUsed),
      diskTotal: Number(latest.diskTotal), diskUsed: Number(latest.diskUsed), uptimeSec: latest.uptimeSec,
      netRx: n(latest.netRxBps), netTx: n(latest.netTxBps),
      cpus: typeof extra.cpus === "number" ? extra.cpus : null,
    } : null,
    series,
    checks: checks.map((c) => ({
      key: c.key, kind: c.kind, target: c.target, tenantId: c.tenantId, status: c.status, message: c.message,
      // Baza/trafik statistikasining katta data'si oqimga qo'shilmaydi — /superadmin/baza va /trafik o'zi o'qiydi
      latencyMs: c.latencyMs, data: HEAVY_CHECK_KEYS.includes(c.key) ? null : c.data ?? null, checkedAt: c.checkedAt.toISOString(), changedAt: c.changedAt.toISOString(),
    })),
    incidents: incidents.map((i) => ({
      id: i.id, key: i.key, source: i.source, category: i.category, severity: i.severity, status: i.status, title: i.title,
      tenantId: i.tenantId, count: i.count, firstSeenAt: i.firstSeenAt.toISOString(), lastSeenAt: i.lastSeenAt.toISOString(),
      suggestedActions: asSuggested(i.suggestedActions),
    })),
    counts,
    actions: actions.map((a) => toActionView(a, adminName)),
    agent: heartbeat ? {
      hostname: heartbeat.hostname, version: heartbeat.version, startedAt: heartbeat.startedAt.toISOString(),
      lastSeenAt: heartbeat.lastSeenAt.toISOString(), stale: now - heartbeat.lastSeenAt.getTime() > AGENT_STALE_MS, info: heartbeat.info ?? null,
    } : null,
    report: report ? {
      id: report.id, createdAt: report.createdAt.toISOString(), grade: report.grade, summary: report.summary, trigger: report.trigger,
      model: report.model, itemCount: Array.isArray(report.items) ? report.items.length : 0,
    } : null,
    tenants: tenants.map((t) => {
      const h = httpCheck.get(t.slug);
      const v = dataField(h?.data, "version") ?? dataField(h?.data, "commit") ?? dataField(t.lastStats, "version");
      return { id: t.id, slug: t.slug, name: t.name, status: t.status, lastError: t.lastError, lastSeenAt: iso(t.lastSeenAt), version: typeof v === "string" ? v : null };
    }),
  };
}

type ActionRow = { id: string; type: string; params: unknown; status: ActionView["status"]; requestedById: string | null; requestedAt: Date; startedAt: Date | null; finishedAt: Date | null; output: string | null; incidentId: string | null };

export function toActionView(a: ActionRow, adminName: Map<string, string>): ActionView {
  return {
    id: a.id, type: a.type, params: a.params && typeof a.params === "object" && !Array.isArray(a.params) ? (a.params as Record<string, unknown>) : {},
    status: a.status, requestedBy: a.requestedById ? adminName.get(a.requestedById) ?? "o'chirilgan admin" : null,
    requestedAt: a.requestedAt.toISOString(), startedAt: iso(a.startedAt), finishedAt: iso(a.finishedAt), output: a.output, incidentId: a.incidentId,
  };
}

const g = globalThis as unknown as { monitorSnap?: { at: number; p: Promise<MonitorSnapshot> } };

export function loadMonitorSnapshot(): Promise<MonitorSnapshot> {
  const c = g.monitorSnap;
  if (c && Date.now() - c.at < TTL_MS) return c.p;
  const p = build();
  g.monitorSnap = { at: Date.now(), p };
  // Xato keshda qolmasin — keyingi so'rov qayta urinadi
  p.catch(() => { if (g.monitorSnap?.p === p) g.monitorSnap = undefined; });
  return p;
}

/** Amal qo'yilgach / hodisa yopilgach keshni tashlash — oqim keyingi aylanishda yangisini yuboradi. */
export function invalidateMonitorSnapshot() {
  g.monitorSnap = undefined;
}

export const snapshotHash = (json: string) => createHash("sha1").update(json).digest("base64url");
