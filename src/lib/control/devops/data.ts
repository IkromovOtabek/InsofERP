import { control } from "../db";
import { AGENT_STALE_MS, checkKey } from "../monitor/contract";
import { dataField, type ActionView, type CheckStatusT } from "../monitor/shared";
import { toActionView } from "../monitor/snapshot";
import { DETACHED_ACTIONS, RELEASE_CHECK_KEY, sameSha, type ReleaseInfo } from "./contract";

/**
 * «Relizlar» sahifasi ma'lumoti — faqat control bazadan O'QIYDI (panel serverga/GitHub'ga bormaydi):
 * ServiceCheck release:info (agent git fetch bilan yozadi), har korxona/panel /api/health versiyasi, DEPLOY/ROLLBACK tarixi.
 */
export type ServiceVersion = { key: string; name: string; slug: string | null; version: string | null; status: CheckStatusT | null; match: boolean | null; checkedAt: string | null };
export type ReleasesView = {
  info: ReleaseInfo | null;
  infoAt: string | null;
  infoMessage: string | null;
  services: ServiceVersion[];
  history: ActionView[];
  active: ActionView | null;
  agentOk: boolean;
};

export async function adminNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const rows = await control.superAdmin.findMany({ where: { id: { in: uniq } }, select: { id: true, fullName: true } });
  return new Map(rows.map((a) => [a.id, a.fullName]));
}

export async function loadDeployActions(take = 15): Promise<{ history: ActionView[]; active: ActionView | null }> {
  const rows = await control.agentAction.findMany({ where: { type: { in: [...DETACHED_ACTIONS] } }, orderBy: { requestedAt: "desc" }, take });
  const names = await adminNames(rows.map((r) => r.requestedById));
  const history = rows.map((r) => toActionView(r, names));
  return { history, active: history.find((a) => a.status === "PENDING" || a.status === "RUNNING") ?? null };
}

export async function loadReleasesView(): Promise<ReleasesView> {
  const tenants = await control.tenant.findMany({ where: { status: "ACTIVE" }, select: { slug: true, name: true }, orderBy: { port: "asc" } });
  const keys = [RELEASE_CHECK_KEY, "http:control", ...tenants.map((t) => checkKey.tenantHttp(t.slug))];
  const [checks, deploys, hb] = await Promise.all([
    control.serviceCheck.findMany({ where: { key: { in: keys } } }),
    loadDeployActions(),
    control.agentHeartbeat.findUnique({ where: { id: "main" }, select: { lastSeenAt: true } }),
  ]);
  const byKey = new Map(checks.map((c) => [c.key, c]));
  const rel = byKey.get(RELEASE_CHECK_KEY);
  const info = rel?.data && typeof rel.data === "object" && !Array.isArray(rel.data) ? (rel.data as unknown as ReleaseInfo) : null;
  const current = info?.current ?? info?.releaseFile ?? null;

  const svc = (key: string, name: string, slug: string | null): ServiceVersion => {
    const c = byKey.get(key);
    const v = dataField(c?.data, "version");
    const version = typeof v === "string" ? v : null;
    return {
      key, name, slug, version, status: (c?.status as CheckStatusT | undefined) ?? null,
      match: version && current ? sameSha(version, current) : null, checkedAt: c?.checkedAt.toISOString() ?? null,
    };
  };
  return {
    info,
    infoAt: rel?.checkedAt.toISOString() ?? null,
    infoMessage: rel?.message ?? null,
    services: [svc("http:control", "IT panel (insof-control)", null), ...tenants.map((t) => svc(checkKey.tenantHttp(t.slug), t.name, t.slug))],
    history: deploys.history,
    active: deploys.active,
    agentOk: !!hb && Date.now() - hb.lastSeenAt.getTime() < AGENT_STALE_MS,
  };
}
