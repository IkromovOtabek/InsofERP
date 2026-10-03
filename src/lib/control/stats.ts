import { statfs } from "node:fs/promises";
import os from "node:os";
import { control, tenantDb } from "./db";
import { releaseVersion } from "./release";
import type { Tenant } from "@/generated/control";

/**
 * Korxona statistikasi — IT kuzatuvi uchun. Korxona bazasidan to'g'ridan-to'g'ri (faqat o'qish, sanoq va
 * yig'indilar — mijoz/zayavka tafsilotlari panelga olinmaydi), jarayon va ECO esa HTTP orqali tekshiriladi.
 */
export type TenantStats = {
  at: string;
  web: { up: boolean; ms: number | null; error?: string };
  eco: { configured: boolean; up: boolean | null; ms: number | null };
  db: { ok: boolean; sizeMb: number | null; error?: string };
  suspended: boolean;
  users: { active: number; total: number; byRole: Record<string, number>; active24h: number; mobileDevices: number; ecoLinked: number };
  employees: number;
  customers: number;
  orders: { today: number; month: number; draft: number; blocked: number; revenueMonth: number };
  payments: { month: number };
  trips: { today: number; onRoad: number };
  usage: { ai30d: number; sms30d: number; notifications30d: number; audit24h: number };
  lastActivityAt: string | null;
};

async function ping(url: string, timeoutMs = 4000): Promise<{ up: boolean; ms: number | null; error?: string }> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual", cache: "no-store" });
    // /login 200, kirgan bo'lsa 307 — ikkalasi ham "jarayon tirik"
    return { up: r.status < 500, ms: Date.now() - t0, error: r.status >= 500 ? `HTTP ${r.status}` : undefined };
  } catch (e) {
    return { up: false, ms: null, error: (e as Error).name === "TimeoutError" ? "javob yo'q (4s)" : (e as Error).message };
  }
}

const n = (v: unknown) => Number(v ?? 0);

async function dbStats(dbName: string) {
  const db = tenantDb(dbName);
  const now = new Date();
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const month0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const d30 = new Date(now.getTime() - 30 * 864e5);
  const h24 = new Date(now.getTime() - 864e5);
  const notIt = { role: { not: "SUPERADMIN" as const } };

  const [
    size, settings, usersActive, usersTotal, byRole, active24h, devices, ecoLinked, employees, customers,
    ordersToday, ordersMonth, draft, blocked, revenue, paymentsMonth, tripsToday, onRoad,
    ai30d, sms30d, notif30d, audit24h, lastAudit,
  ] = await Promise.all([
    db.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
    db.companySettings.findUnique({ where: { id: "main" }, select: { suspendedAt: true } }),
    db.user.count({ where: { isActive: true, ...notIt } }),
    db.user.count({ where: notIt }),
    db.user.groupBy({ by: ["role"], where: { isActive: true, ...notIt }, _count: { _all: true } }),
    // IT (SSO) kirishlari korxona faolligiga qo'shilmaydi
    db.auditLog.findMany({ where: { createdAt: { gte: h24 }, user: notIt }, distinct: ["userId"], select: { userId: true } }),
    db.mobileDevice.count(),
    db.user.count({ where: { ecoUserId: { not: null } } }),
    db.employee.count({ where: { isActive: true } }),
    db.customer.count({ where: { isActive: true, isInternal: false } }),
    db.order.count({ where: { createdAt: { gte: day0 } } }),
    db.order.count({ where: { createdAt: { gte: month0 } } }),
    db.order.count({ where: { status: "DRAFT" } }),
    db.order.count({ where: { status: "BLOCKED" } }),
    db.$queryRaw<{ sum: unknown }[]>`
      SELECT COALESCE(SUM(oi."qtyM3" * oi."price"), 0) AS sum
      FROM "OrderItem" oi JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."kind" = 'SALE' AND o."status" <> 'CANCELLED' AND o."createdAt" >= ${month0}`,
    db.payment.aggregate({ where: { date: { gte: month0 } }, _sum: { amount: true } }),
    db.trip.count({ where: { createdAt: { gte: day0 } } }),
    db.trip.count({ where: { status: "ON_ROAD" } }),
    db.aiMessage.count({ where: { createdAt: { gte: d30 } } }),
    db.smsLog.count({ where: { createdAt: { gte: d30 } } }),
    db.notification.count({ where: { createdAt: { gte: d30 } } }),
    db.auditLog.count({ where: { createdAt: { gte: h24 }, user: notIt } }),
    db.auditLog.findFirst({ where: { user: notIt }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  return {
    db: { ok: true, sizeMb: Math.round((Number(size[0]?.size ?? 0) / 1048576) * 10) / 10 },
    suspended: !!settings?.suspendedAt,
    users: {
      active: usersActive, total: usersTotal,
      byRole: Object.fromEntries(byRole.map((r) => [r.role, r._count._all])),
      active24h: active24h.length, mobileDevices: devices, ecoLinked,
    },
    employees, customers,
    orders: { today: ordersToday, month: ordersMonth, draft, blocked, revenueMonth: Math.round(n(revenue[0]?.sum)) },
    payments: { month: Math.round(n(paymentsMonth._sum.amount)) },
    trips: { today: tripsToday, onRoad },
    usage: { ai30d, sms30d, notifications30d: notif30d, audit24h },
    lastActivityAt: lastAudit?.createdAt.toISOString() ?? null,
  };
}

const EMPTY = {
  db: { ok: false, sizeMb: null },
  suspended: false,
  users: { active: 0, total: 0, byRole: {}, active24h: 0, mobileDevices: 0, ecoLinked: 0 },
  employees: 0, customers: 0,
  orders: { today: 0, month: 0, draft: 0, blocked: 0, revenueMonth: 0 },
  payments: { month: 0 },
  trips: { today: 0, onRoad: 0 },
  usage: { ai30d: 0, sms30d: 0, notifications30d: 0, audit24h: 0 },
  lastActivityAt: null,
};

/** Bitta korxona: hamma tekshiruv parallel; natija control bazada saqlanadi (oxirgi holat + kunlik surat). */
export async function collectStats(t: Tenant): Promise<TenantStats> {
  const [web, eco, data] = await Promise.all([
    ping(`${t.internalUrl}/login`),
    t.ecoApiUrl ? ping(`${t.ecoApiUrl.replace(/\/+$/, "")}/v1/health`) : Promise.resolve(null),
    dbStats(t.dbName).catch((e: Error) => ({ ...EMPTY, db: { ok: false, sizeMb: null, error: e.message.split("\n").slice(-1)[0].slice(0, 200) } })),
  ]);
  const stats: TenantStats = {
    at: new Date().toISOString(),
    web,
    eco: { configured: !!t.ecoApiUrl, up: eco ? eco.up : null, ms: eco?.ms ?? null },
    ...data,
  };
  const error = [!web.up && `Veb: ${web.error ?? "ishlamayapti"}`, !stats.db.ok && `Baza: ${stats.db.error}`, eco && !eco.up && `ECO: ${eco.error ?? "javob yo'q"}`].filter(Boolean).join(" · ") || null;
  // Jarayon birinchi marta javob berdi — yaratilgan korxona endi faol
  const status = t.status === "PROVISIONING" && web.up && stats.db.ok ? "ACTIVE" : t.status;
  const day = new Date(); day.setHours(0, 0, 0, 0);
  await control.$transaction([
    control.tenant.update({
      where: { id: t.id },
      data: { lastStats: JSON.parse(JSON.stringify(stats)), lastError: error, status, ...(web.up ? { lastSeenAt: new Date() } : {}) },
    }),
    control.tenantStat.upsert({
      where: { tenantId_day: { tenantId: t.id, day } },
      update: { stats: JSON.parse(JSON.stringify(stats)), takenAt: new Date() },
      create: { tenantId: t.id, day, stats: JSON.parse(JSON.stringify(stats)) },
    }),
  ]);
  return stats;
}

export async function collectAll(): Promise<Map<string, TenantStats>> {
  const tenants = await control.tenant.findMany({ where: { status: { not: "ARCHIVED" } } });
  const out = new Map<string, TenantStats>();
  await Promise.all(tenants.map(async (t) => { out.set(t.id, await collectStats(t)); }));
  return out;
}

/** Panel jarayoni turgan server: xotira, disk, yuklama — butun platforma uchun umumiy ko'rsatkich. */
export async function serverStats() {
  let disk: { freeGb: number; totalGb: number } | null = null;
  // Ma'lumot papkasi hali yaratilmagan bo'lsa — ildiz disk
  for (const dir of [process.env.TENANT_DATA_ROOT, "/"].filter(Boolean) as string[]) {
    try {
      const s = await statfs(dir);
      disk = { freeGb: Math.round((s.bavail * s.bsize) / 1e9), totalGb: Math.round((s.blocks * s.bsize) / 1e9) };
      break;
    } catch { /* keyingisi */ }
  }
  return {
    host: os.hostname(),
    uptimeH: Math.round(os.uptime() / 3600),
    load: os.loadavg().map((x) => Math.round(x * 100) / 100),
    cpus: os.cpus().length,
    memFreeGb: Math.round((os.freemem() / 1e9) * 10) / 10,
    memTotalGb: Math.round((os.totalmem() / 1e9) * 10) / 10,
    disk,
    node: process.version,
    commit: releaseVersion()?.slice(0, 7) ?? null,
  };
}
