"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/control/auth";
import { control } from "@/lib/control/db";
import { logEvent } from "@/lib/control/events";
import { IPV4_RE, UNIT_RE, isActionType, type ActionType } from "@/lib/control/monitor/contract";
import { actionLabel, confirmPhrase, needsReauth } from "@/lib/control/monitor/shared";
import { verifyReauth } from "@/lib/control/reauth";
import { DETACHED_ACTIONS } from "@/lib/control/devops/contract";
import { PG_DB_RE, PG_PID_RE, PG_TABLE_RE } from "@/lib/control/dbtraffic/contract";
import { invalidateMonitorSnapshot } from "@/lib/control/monitor/snapshot";
import { INFRA_PARAMS, infraPreflight } from "@/lib/control/infra/preflight";
import { ipFromHeaders } from "@/lib/login-guard";
import { DEVOPS_PARAMS } from "@/lib/control/devops/params";
import { Prisma } from "@/generated/control";

/**
 * Monitoring amallari. Panel serverga o'zi tegmaydi — faqat AgentAction navbatiga PENDING qator qo'yadi,
 * insof-agent uni oq ro'yxat bo'yicha bajaradi. Bu yerda: sessiya, tur/parametr tekshiruvi (zod + contract),
 * xavfli amallar uchun yozma tasdiq, admin bo'yicha chastota chegarasi, takror so'rovni rad etish, jurnal.
 */
export type MonitorResult = { ok?: boolean; id?: string; error?: string };

const RATE_LIMIT = 10; // daqiqada bitta admin uchun
const EMPTY = z.object({}).strict();
const PARAMS: Record<ActionType, z.ZodType<Record<string, string>>> = {
  RESTART_UNIT: z.object({ unit: z.string().regex(UNIT_RE, "Bu xizmatni panel qayta ishga tushira olmaydi") }).strict(),
  RELOAD_NGINX: EMPTY,
  RUN_BACKUP: EMPTY,
  RENEW_CERT: EMPTY,
  FIX_SECRET_PERMS: EMPTY,
  BLOCK_IP: z.object({ ip: z.string().regex(IPV4_RE, "IPv4 manzil noto'g'ri") }).strict(),
  UNBLOCK_IP: z.object({ ip: z.string().regex(IPV4_RE, "IPv4 manzil noto'g'ri") }).strict(),
  RUN_HEALTH_CHECK: EMPTY,
  RUN_SECURITY_SCAN: EMPTY,
  RUN_AI_ANALYSIS: EMPTY,
  ...DEVOPS_PARAMS,
  // Baza amallari: qiymatlar agentda bazadan qayta tekshiriladi (o'z roli, holat, pg_class)
  PG_CANCEL: z.object({ db: z.string().regex(PG_DB_RE, "Baza nomi noto'g'ri"), pid: z.string().regex(PG_PID_RE, "pid noto'g'ri") }).strict(),
  PG_TERMINATE: z.object({ db: z.string().regex(PG_DB_RE, "Baza nomi noto'g'ri"), pid: z.string().regex(PG_PID_RE, "pid noto'g'ri") }).strict(),
  VACUUM_ANALYZE: z.object({ db: z.string().regex(PG_DB_RE, "Baza nomi noto'g'ri"), table: z.string().regex(PG_TABLE_RE, "Jadval nomi noto'g'ri").optional() }).strict() as z.ZodType<Record<string, string>>,
  ...INFRA_PARAMS,
};
const ID = z.string().regex(/^[a-z0-9]{10,40}$/i);

/**
 * `password` — faqat REAUTH_ACTIONS (DEPLOY, ROLLBACK, REBOOT, TENANT_UP, PG_TERMINATE) uchun: superadmin joriy paroli.
 * U alohida argument: `params` ga (AgentAction.params, jurnal) hech qachon tushmaydi.
 */
export async function enqueueAction(type: string, params: unknown, incidentId?: string | null, confirm?: string | null, password?: string | null): Promise<MonitorResult> {
  const a = await requireAdmin();
  if (typeof type !== "string" || !isActionType(type)) return { error: "Noma'lum amal turi" };
  const parsed = PARAMS[type].safeParse(params ?? {});
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Parametr noto'g'ri" };
  const p = parsed.data;

  if (type === "BLOCK_IP") {
    // O'zini (yoki serverni) bloklab qo'ymaslik
    if (/^(127\.|0\.)/.test(p.ip)) return { error: "Lokal manzilni bloklab bo'lmaydi" };
    let mine = "";
    try { mine = ipFromHeaders(await headers()); } catch { /* so'rov yo'q */ }
    if (mine && mine.replace(/^::ffff:/, "") === p.ip) return { error: "Bu sizning joriy IP manzilingiz — o'zingizni bloklab qo'yasiz" };
  }
  const phrase = confirmPhrase(type, p);
  if (phrase !== null && (confirm ?? "").trim() !== phrase) return { error: `Tasdiqlash uchun «${phrase}» deb yozing` };
  if (needsReauth(type)) {
    let ip = "unknown";
    try { ip = ipFromHeaders(await headers()); } catch { /* so'rov yo'q */ }
    const row = await control.superAdmin.findUnique({ where: { id: a.id }, select: { passwordHash: true, isActive: true } });
    const bad = await verifyReauth({ login: a.login, hash: row?.isActive ? row.passwordHash : null, password, ip });
    if (bad) return { error: bad };
  }
  const pre = await infraPreflight(type, p);
  if (pre) return { error: pre };

  let incident: string | null = null;
  if (incidentId) {
    if (!ID.safeParse(incidentId).success) return { error: "Hodisa topilmadi" };
    const i = await control.incident.findUnique({ where: { id: incidentId }, select: { id: true } });
    if (!i) return { error: "Hodisa topilmadi" };
    incident = i.id;
  }

  // Chastota va takrorni tekshirish + yozish — bitta tranzaksiyada, global qulf bilan (ikki tez bosish poygasi yo'q)
  const res = await control.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('insof:agent-action-enqueue'))`;
    const recent = await tx.agentAction.count({ where: { requestedById: a.id, requestedAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent >= RATE_LIMIT) return { error: "Juda ko'p so'rov: daqiqasiga 10 tadan ortiq amal qo'yib bo'lmaydi. Birozdan keyin urinib ko'ring." };
    const dup = await tx.agentAction.findFirst({
      where: { type, status: { in: ["PENDING", "RUNNING"] }, params: { equals: p as Prisma.InputJsonValue } },
      select: { id: true },
    });
    if (dup) return { error: "Xuddi shu amal navbatda yoki bajarilmoqda — natijasini kuting", id: dup.id };
    // DEPLOY va ROLLBACK bir-birini ham istisno qiladi (bir vaqtda bitta) — shu qulf ichida, yaratish bilan bir tranzaksiyada
    if ((DETACHED_ACTIONS as readonly string[]).includes(type)) {
      const busy = await tx.agentAction.findFirst({ where: { type: { in: [...DETACHED_ACTIONS] }, status: { in: ["PENDING", "RUNNING"] } }, select: { id: true } });
      if (busy) return { error: "Boshqa deploy/qaytarish hozir bajarilmoqda — tugashini kuting", id: busy.id };
    }
    const row = await tx.agentAction.create({ data: { type, params: p as Prisma.InputJsonValue, requestedById: a.id, incidentId: incident } });
    return { ok: true, id: row.id };
  });
  if (res.error) return res;

  await logEvent(a.id, "AGENT_ACTION", null, { actionId: res.id, type, label: actionLabel(type), params: p, incidentId: incident });
  invalidateMonitorSnapshot();
  return res;
}

export async function ackIncident(id: string): Promise<MonitorResult> {
  const a = await requireAdmin();
  if (!ID.safeParse(id).success) return { error: "Hodisa topilmadi" };
  const i = await control.incident.findUnique({ where: { id }, select: { id: true, status: true, title: true, tenantId: true } });
  if (!i) return { error: "Hodisa topilmadi" };
  if (i.status === "RESOLVED") return { error: "Hodisa allaqachon yopilgan" };
  if (i.status === "OPEN") {
    await control.incident.updateMany({ where: { id, status: "OPEN" }, data: { status: "ACKED", ackedById: a.id, ackedAt: new Date() } });
    await logEvent(a.id, "INCIDENT_ACK", await tenantRef(i.tenantId), { incidentId: id, title: i.title });
  }
  invalidateMonitorSnapshot();
  return { ok: true };
}

const NOTE = z.string().trim().min(3, "Izoh kamida 3 belgi").max(1000, "Izoh juda uzun");

export async function resolveIncident(id: string, note: string): Promise<MonitorResult> {
  const a = await requireAdmin();
  if (!ID.safeParse(id).success) return { error: "Hodisa topilmadi" };
  const nt = NOTE.safeParse(note);
  if (!nt.success) return { error: nt.error.issues[0].message };
  const i = await control.incident.findUnique({ where: { id }, select: { id: true, status: true, detail: true, title: true, tenantId: true } });
  if (!i) return { error: "Hodisa topilmadi" };
  if (i.status === "RESOLVED") return { error: "Hodisa allaqachon yopilgan" };
  const base = i.detail && typeof i.detail === "object" && !Array.isArray(i.detail) ? (i.detail as Record<string, unknown>) : i.detail == null ? {} : { original: i.detail };
  const now = new Date();
  const detail = { ...base, resolution: { note: nt.data, by: a.login, byName: a.fullName, at: now.toISOString(), manual: true } };
  await control.incident.update({
    where: { id },
    data: { status: "RESOLVED", resolvedAt: now, detail: detail as Prisma.InputJsonValue, ...(i.status === "OPEN" ? { ackedById: a.id, ackedAt: now } : {}) },
  });
  await logEvent(a.id, "INCIDENT_RESOLVE", await tenantRef(i.tenantId), { incidentId: id, title: i.title, note: nt.data });
  invalidateMonitorSnapshot();
  return { ok: true };
}

/** Incident.tenantId agent yozgan qiymat — jurnal FK'si buzilmasin (korxona o'chirilgan bo'lishi mumkin). */
async function tenantRef(id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await control.tenant.count({ where: { id } })) > 0 ? id : null;
}
