/**
 * CyberSecurity agent — insof-agent (scripts/insof-agent.ts) chaqiradigan kirish nuqtasi.
 *
 *   runSecurityChecks(ctx) → Finding[]   — barcha tekshiruvlar, har biri alohida (try/catch + timeout); hech qachon tashlamaydi
 *   runAiAnalysis(trigger, requestedById?) → { id } | null — Claude tahlili → SecurityReport (+ "ai" hodisalar)
 *
 * Nima tekshiriladi va serverdagi talablar: docs/server-xavfsizlik.md → "CyberSecurity agent".
 */
import { checkControlActivity, checkTenantTelemetry } from "./app-checks";
import {
  checkApt, checkFirewall, checkHeaders, checkNginx, checkNpmAudit, checkPorts, checkSecrets, checkSsh, checkSshd,
} from "./host-checks";
import { externalAllowed } from "../../test-mode";
import { errMsg, finding, withTimeout } from "./util";
import type { Finding, SecurityCtx } from "./types";

export type { Finding, SecurityCtx } from "./types";
export { runAiAnalysis } from "./ai";

type Check = { name: string; category: Finding["category"]; timeoutMs: number; run: (ctx: SecurityCtx) => Promise<Finding[]> };

export const CHECKS: Check[] = [
  { name: "ssh", category: "security", timeoutMs: 45_000, run: checkSsh },
  { name: "sshd-config", category: "config", timeoutMs: 10_000, run: () => checkSshd() },
  { name: "firewall", category: "config", timeoutMs: 20_000, run: () => checkFirewall() },
  { name: "open-ports", category: "security", timeoutMs: 10_000, run: () => checkPorts() },
  { name: "secrets", category: "config", timeoutMs: 10_000, run: (ctx) => checkSecrets(ctx) },
  { name: "http-headers", category: "security", timeoutMs: 20_000, run: (ctx) => checkHeaders(ctx, fetch, (u) => externalAllowed(u)) },
  { name: "nginx", category: "security", timeoutMs: 15_000, run: () => checkNginx() },
  { name: "app-tenants", category: "security", timeoutMs: 45_000, run: checkTenantTelemetry },
  { name: "control-activity", category: "security", timeoutMs: 25_000, run: checkControlActivity },
  { name: "os-updates", category: "update", timeoutMs: 75_000, run: checkApt },
  { name: "npm-audit", category: "update", timeoutMs: 150_000, run: checkNpmAudit },
];

export async function runSecurityChecks(ctx: SecurityCtx): Promise<Finding[]> {
  const started = Date.now();
  const results = await Promise.all(CHECKS.map(async (c) => {
    const t0 = Date.now();
    try {
      const fs = await withTimeout(c.run(ctx), c.timeoutMs, c.name);
      return fs;
    } catch (e) {
      const msg = errMsg(e, 200);
      ctx.log(`[security] ${c.name} yiqildi: ${msg}`);
      return [finding(c.name, c.category, "INFO", `${c.name}: tekshirib bo'lmadi`, { status: "UNKNOWN", reason: msg })];
    } finally {
      const ms = Date.now() - t0;
      if (ms > 10_000) ctx.log(`[security] ${c.name}: ${ms} ms`);
    }
  }));
  const all = results.flat();
  const bad = all.filter((f) => f.severity !== "INFO").length;
  ctx.log(`[security] ${all.length} topilma (${bad} ta muammo) — ${Date.now() - started} ms`);
  return all;
}
