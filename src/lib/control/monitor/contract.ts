/**
 * insof-agent ↔ IT panel shartnomasi: tekshiruv kalitlari va oq ro'yxatdagi amallar.
 * Panel faqat shu turdagi AgentAction qo'yadi; agent boshqasini REJECTED qiladi.
 */
export const ACTION_TYPES = [
  "RESTART_UNIT",        // { unit: "insof-erp@<slug>" | "insof-control" | "insof-eco" }
  "RELOAD_NGINX",        // {}
  "RUN_BACKUP",          // {}
  "RENEW_CERT",          // {}
  "FIX_SECRET_PERMS",    // {} — tenants/*.env, control.env, build.env → chmod 600
  "BLOCK_IP",            // { ip }
  "UNBLOCK_IP",          // { ip }
  "RUN_HEALTH_CHECK",    // {}
  "RUN_SECURITY_SCAN",   // {}
  "RUN_AI_ANALYSIS",     // {}
  // DevOps (src/lib/control/devops/contract.ts, scripts/agent/devops.ts)
  "DEPLOY",              // { ref?: "main" | <hex sha> } — ajratilgan jarayon, keyingi agent nusxasi yakunlaydi
  "ROLLBACK",            // {}
  "LOG_TAIL",            // { source, lines, filter?, priority? }
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const UNIT_RE = /^(insof-erp@[a-z0-9-]{2,30}|insof-control|insof-eco)$/;
export const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isActionType(t: string): t is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(t);
}

/** ServiceCheck.key yasash — panel va agent bir xil kalit ishlatsin. */
export const checkKey = {
  unit: (unit: string) => `unit:${unit}`,
  tenantHttp: (slug: string) => `http:tenant:${slug}`,
  tenantDb: (slug: string) => `db:tenant:${slug}`,
  eco: () => "http:eco",
  postgres: () => "db:postgres",
  nginx: () => "unit:nginx",
  ssl: (domain: string) => `ssl:${domain}`,
  backup: () => "backup:latest",
  disk: () => "host:disk",
  memory: () => "host:memory",
  cpu: () => "host:cpu",
  security: (name: string) => `security:${name}`,
  agent: () => "agent:heartbeat",
};

/** Agent heartbeat shundan eski bo'lsa panel "Agent javob bermayapti" deydi. */
export const AGENT_STALE_MS = 60_000;
