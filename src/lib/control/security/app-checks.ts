/**
 * 8. Ilova xavfsizlik telemetriyasi — korxona bazalari (faqat O'QISH) va control baza.
 *
 * Login xatolari bazada saqlanmaydi: login-guard.ts hisobni xotirada yuritadi va faqat QULF qo'yilganda jurnalga
 * "[login-guard] qulf: l:<login>|ip:<ip>" yozadi. Shuning uchun qulflar `journalctl -u insof-erp@<slug>` (va panel uchun
 * `-u insof-control`) dan sanaladi; login nomlari topilmaga chiqmaydi — faqat son va IP.
 * Bazadan: AuditLog (entity "User") — yangi direktor/IT hisoblari, rol/ruxsat o'zgarishi, parol tiklash; control
 * ControlEvent — SSO va panelga kirish ish vaqtidan tashqari, yangi superadmin, superadmin paroli almashishi.
 */
import { control, tenantDb } from "../db";
import { run, shortErr } from "./exec";
import { blockable, offHours, parseLoginGuardLocks } from "./parsers";
import { blockIpAction, errMsg, finding, unknown, withTimeout } from "./util";
import type { Finding, SecurityCtx, Severity } from "./types";

const PRIV_ROLES = new Set(["DIRECTOR", "SUPERADMIN"]);

export type TenantAudit = {
  slug: string;
  newPrivUsers: number;
  roleToPriv: number;
  permChanges: number;
  passwordResets: number;
  itLogins: number;
  deactivations: number;
  loginLocks: number | null;
  ipLocks: string[];
  error?: string;
};

type AuditRow = { action: string; after: unknown; before: unknown; createdAt: Date };

export function summarizeAudit(slug: string, rows: AuditRow[], newPrivUsers: number): Omit<TenantAudit, "loginLocks" | "ipLocks"> {
  const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
  let roleToPriv = 0, permChanges = 0, passwordResets = 0, itLogins = 0, deactivations = 0;
  for (const r of rows) {
    const a = obj(r.after), b = obj(r.before);
    if (r.action === "UPDATE" && typeof a.role === "string" && PRIV_ROLES.has(a.role) && a.role !== b.role) roleToPriv++;
    if ("perms" in a) permChanges++;
    if (a.passwordReset) passwordResets++;
    if (a.itKirish) itLogins++;
    if (a.isActive === false && b.isActive === true) deactivations++;
  }
  return { slug, newPrivUsers, roleToPriv, permChanges, passwordResets, itLogins, deactivations };
}

export function evaluateTenantTelemetry(list: TenantAudit[]): Finding[] {
  if (!list.length) return [finding("app-tenants", "security", "INFO", "Ilova telemetriyasi: faol korxona yo'q", { tenants: 0 })];
  const ok = list.filter((t) => !t.error);
  const errs = list.filter((t) => t.error).map((t) => ({ slug: t.slug, error: t.error }));
  if (!ok.length) return [unknown("app-tenants", "security", "Ilova telemetriyasi", "korxona bazalariga ulanib bo'lmadi", { errors: errs })];

  const out: Finding[] = [];
  // a) Huquqlar: yangi direktor/IT hisobi, rol ko'tarilishi — MEDIUM; ruxsat/parol o'zgarishlari ko'p — LOW
  const priv = ok.filter((t) => t.newPrivUsers || t.roleToPriv);
  const bulk = ok.filter((t) => t.permChanges >= 10 || t.passwordResets >= 5 || t.deactivations >= 10);
  const privDetail = { window: "24h", tenants: ok.map(({ slug, newPrivUsers, roleToPriv, permChanges, passwordResets, itLogins, deactivations }) => ({ slug, newPrivUsers, roleToPriv, permChanges, passwordResets, itLogins, deactivations })), errors: errs };
  if (priv.length) {
    out.push(finding("app-privileges", "security", "MEDIUM",
      `Yangi direktor/IT huquqli hisob (24 soat): ${priv.map((t) => `${t.slug} (${t.newPrivUsers + t.roleToPriv})`).join(", ")} — direktor bilan tasdiqlang`, privDetail));
  } else if (bulk.length) {
    out.push(finding("app-privileges", "security", "LOW",
      `Ko'p huquq/parol o'zgarishi (24 soat): ${bulk.map((t) => t.slug).join(", ")}`, privDetail));
  } else {
    out.push(finding("app-privileges", "security", "INFO", "Huquqlar: 24 soatda yangi direktor/IT hisobi yo'q", privDetail));
  }

  // b) Login qulflari (jurnaldan)
  const known = ok.filter((t) => t.loginLocks != null);
  const locks = known.reduce((s, t) => s + (t.loginLocks ?? 0), 0);
  const ipLocks = [...new Set(known.flatMap((t) => t.ipLocks))];
  const lockDetail = { window: "24h", tenants: known.map((t) => ({ slug: t.slug, loginLocks: t.loginLocks, ipLocks: t.ipLocks.length })), ipLocks: ipLocks.slice(0, 20), source: "journalctl [login-guard]" };
  if (!known.length) out.push(unknown("app-logins", "security", "Login qulflari", "xizmat jurnallari o'qilmadi (journalctl yo'q yoki systemd-journal guruhi yo'q)"));
  else if (ipLocks.length || locks >= 3) {
    const sev: Severity = ipLocks.length >= 3 || locks >= 10 ? "MEDIUM" : "LOW";
    out.push(finding("app-logins", "security", sev,
      `ERP login: 24 soatda ${locks} ta hisob qulflandi${ipLocks.length ? `, ${ipLocks.length} ta IP bloklandi (parol terish hujumi)` : ""}`,
      lockDetail, ipLocks.filter(blockable).slice(0, 3).map((ip) => blockIpAction(ip, "ERP login'da ko'p xato"))));
  } else {
    out.push(finding("app-logins", "security", "INFO", `ERP login: 24 soatda ${locks} ta qulf`, lockDetail));
  }
  return out;
}

async function unitLocks(unit: string): Promise<{ loginLocks: number; ipLocks: string[] } | null> {
  const r = await run("journalctl", ["-u", unit, "--since=-24h", "-o", "cat", "--no-pager", "-q", "--grep=login-guard"], { timeoutMs: 15_000, maxBuffer: 16 * 1024 * 1024 });
  if (r.ok || (r.code === 1 && !r.stderr.trim())) return parseLoginGuardLocks(r.stdout);
  return null;
}

export async function checkTenantTelemetry(ctx: SecurityCtx): Promise<Finding[]> {
  const since = new Date(ctx.now.getTime() - 24 * 3600_000);
  const tenants = ctx.tenants.filter((t) => t.status === "ACTIVE");
  const list = await Promise.all(tenants.map(async (t): Promise<TenantAudit> => {
    const locks = await unitLocks(`insof-erp@${t.slug}`).catch(() => null);
    try {
      const db = tenantDb(t.dbName);
      const [rows, newPriv] = await withTimeout(Promise.all([
        db.auditLog.findMany({ where: { entity: "User", createdAt: { gte: since } }, select: { action: true, after: true, before: true, createdAt: true }, take: 2000, orderBy: { createdAt: "desc" } }),
        db.user.count({ where: { createdAt: { gte: since }, role: { in: ["DIRECTOR", "SUPERADMIN"] },
          // SSO o'zi ochadigan IT hisobi (it.<login>, SUPERADMIN) — kutilgan; u control jurnalida (SSO) ko'rinadi
          NOT: { login: { startsWith: "it." }, role: "SUPERADMIN" } } }),
      ]), 15_000, `${t.slug} bazasi`);
      return { ...summarizeAudit(t.slug, rows, newPriv), loginLocks: locks?.loginLocks ?? null, ipLocks: locks?.ipLocks ?? [] };
    } catch (e) {
      ctx.log(`[security] ${t.slug} telemetriya: ${errMsg(e, 160)}`);
      return { slug: t.slug, newPrivUsers: 0, roleToPriv: 0, permChanges: 0, passwordResets: 0, itLogins: 0, deactivations: 0, loginLocks: null, ipLocks: [], error: errMsg(e, 120) };
    }
  }));
  return evaluateTenantTelemetry(list);
}

/* ───────────────────── Control panel: superadminlar ───────────────────── */

export type ControlEventRow = { action: string; createdAt: Date; ip: string | null; tenantSlug?: string | null };

export function evaluateControlActivity(events: ControlEventRow[], panelLocks: { loginLocks: number; ipLocks: string[] } | null): Finding[] {
  const out: Finding[] = [];
  const off = events.filter((e) => (e.action === "SSO" || e.action === "ADMIN_LOGIN") && offHours(e.createdAt));
  const adminChanges = events.filter((e) => e.action === "ADMIN_CREATE" || e.action === "ADMIN_PASSWORD" || e.action === "ADMIN_TOGGLE" || e.action === "ADMIN_ECO_LINK" || e.action === "ADMIN_ECO_UNLINK");
  const detail = {
    window: "24h",
    logins: events.filter((e) => e.action === "ADMIN_LOGIN").length,
    sso: events.filter((e) => e.action === "SSO").length,
    offHours: off.slice(0, 10).map((e) => ({ action: e.action, at: e.createdAt.toISOString(), ip: e.ip, tenant: e.tenantSlug ?? null })),
    adminChanges: adminChanges.map((e) => ({ action: e.action, at: e.createdAt.toISOString(), ip: e.ip })),
    panelLoginLocks: panelLocks?.loginLocks ?? null,
    panelIpLocks: panelLocks?.ipLocks ?? null,
  };
  let sev: Severity = "INFO";
  const parts: string[] = [];
  if (adminChanges.length) { sev = "MEDIUM"; parts.push(`superadmin hisoblari o'zgardi (${adminChanges.length})`); }
  if (panelLocks && (panelLocks.loginLocks || panelLocks.ipLocks.length)) {
    sev = "MEDIUM";
    parts.push(`panel login'ida qulf: ${panelLocks.loginLocks} hisob, ${panelLocks.ipLocks.length} IP`);
  }
  if (off.length) { if (sev === "INFO") sev = off.length >= 3 ? "MEDIUM" : "LOW"; parts.push(`ish vaqtidan tashqari ${off.length} ta kirish/SSO (08:00–20:00 dan tashqari)`); }
  const actions = (panelLocks?.ipLocks ?? []).filter(blockable).slice(0, 3).map((ip) => blockIpAction(ip, "IT panel login'ida ko'p xato"));
  out.push(sev === "INFO"
    ? finding("control-activity", "security", "INFO", `IT panel: 24 soatda ${detail.logins} kirish, ${detail.sso} SSO — g'ayrioddiy narsa yo'q`, detail)
    : finding("control-activity", "security", sev, `IT panel: ${parts.join("; ")}`, detail, actions));
  return out;
}

export async function checkControlActivity(ctx: SecurityCtx): Promise<Finding[]> {
  const since = new Date(ctx.now.getTime() - 24 * 3600_000);
  let events: ControlEventRow[];
  try {
    const rows = await withTimeout(control.controlEvent.findMany({
      where: { createdAt: { gte: since }, action: { in: ["SSO", "ADMIN_LOGIN", "ADMIN_CREATE", "ADMIN_PASSWORD", "ADMIN_TOGGLE", "ADMIN_ECO_LINK", "ADMIN_ECO_UNLINK"] } },
      select: { action: true, createdAt: true, ip: true, tenant: { select: { slug: true } } },
      orderBy: { createdAt: "desc" }, take: 1000,
    }), 15_000, "control baza");
    events = rows.map((r) => ({ action: r.action, createdAt: r.createdAt, ip: r.ip, tenantSlug: r.tenant?.slug ?? null }));
  } catch (e) {
    return [unknown("control-activity", "security", "IT panel faolligi", `control bazasi: ${errMsg(e, 120)}`)];
  }
  const locks = await unitLocks("insof-control").catch(() => null);
  if (!locks) {
    const r = await run("journalctl", ["--version"], { timeoutMs: 3000 });
    if (r.missing) ctx.log("[security] journalctl yo'q — panel login qulflari sanalmadi");
    else if (!r.ok) ctx.log(`[security] journalctl: ${shortErr(r)}`);
  }
  return evaluateControlActivity(events, locks);
}
