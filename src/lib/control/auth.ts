import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { authSecret, JWT_ALGS } from "../secret";
import { ipFromHeaders } from "../login-guard";
import { control } from "./db";
import { roleDeniedText, type AdminRoleT } from "./roles";

/**
 * Superadmin (IT) sessiyasi — faqat markaziy panelda (INSOF_MODE=control).
 * Korxona sessiyasidan alohida: boshqa cookie, tokenda `typ: "admin"` (korxona `getSession` uni rad etadi).
 *
 * Har kirish — `AdminSession` qatori (tokendagi `jti`): faol qurilmalar ro'yxati, bitta qurilmani yoki hammasini
 * masofadan yopish. Token faqat qator mavjud, yopilmagan va muddati o'tmagan bo'lsa yaroqli; `sessionVersion`
 * (parol almashsa / bloklansa) ham avvalgidek tekshiriladi.
 *
 * 2FA yoqilgan adminda parol (yoki ECO) to'g'ri bo'lsa sessiya darhol berilmaydi: 5 daqiqalik «kod kutilmoqda»
 * cookie'si (`typ: "admin-2fa"`, alohida nom — middleware va getAdmin uni sessiya deb qabul qilmaydi) beriladi,
 * login sahifasi kod so'raydi (login/actions.ts → verifyTwoFactorAction).
 */
export const ADMIN_COOKIE = "insof_admin";
const PENDING_COOKIE = "insof_admin_2fa";
const TTL_SEC = 60 * 60 * 8;
const PENDING_TTL_SEC = 5 * 60;
/** lastSeenAt har so'rovda emas — shuncha vaqtda bir marta yangilanadi */
const TOUCH_MS = 5 * 60_000;

export type LoginVia = "password" | "eco";
export type AdminSession = { id: string; login: string; fullName: string; role: AdminRoleT; totp: boolean; sid: string };

type IssueInput = { id: string; login: string; fullName: string; sessionVersion: number };

async function reqMeta(): Promise<{ ip: string | null; ua: string | null }> {
  try {
    const h = await headers();
    const ip = ipFromHeaders(h);
    return { ip: ip === "unknown" ? null : ip.replace(/^::ffff:/, ""), ua: h.get("user-agent")?.slice(0, 300) ?? null };
  } catch {
    return { ip: null, ua: null };
  }
}

const cookieOpts = (maxAge: number) => ({
  httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge,
});

/** To'liq tasdiqlangan admin uchun yangi sessiya (qator + cookie). Yangi IP bo'lsa — hodisa (Telegram). */
export async function issueAdminSession(a: IssueInput, via: LoginVia = "password"): Promise<string> {
  const { ip, ua } = await reqMeta();
  const now = new Date();
  const seenIp = ip ? await control.adminSession.count({ where: { adminId: a.id, ip } }) : 1;
  const anyBefore = seenIp === 0 ? await control.adminSession.count({ where: { adminId: a.id } }) : 0;
  // Uzoq eskirgan qatorlar (30 kundan oshgan) — ro'yxat cheksiz o'smasin
  await control.adminSession.deleteMany({ where: { adminId: a.id, expiresAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
  const s = await control.adminSession.create({
    data: { adminId: a.id, via, ip, userAgent: ua, expiresAt: new Date(now.getTime() + TTL_SEC * 1000) },
  });
  const token = await new SignJWT({ sub: a.id, login: a.login, typ: "admin", sv: a.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(s.id)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SEC}s`)
    .sign(authSecret());
  (await cookies()).set(ADMIN_COOKIE, token, cookieOpts(TTL_SEC));
  // Birinchi kirish (hali hech qanday sessiya yo'q) — xabar bermaymiz; keyingi har yangi IP — hodisa
  if (ip && seenIp === 0 && anyBefore > 0) await noteNewIp(a, ip, ua, via).catch((e) => console.error("[admin-new-ip]", e));
  return s.id;
}

/**
 * Yangi IP'dan kirish → Incident (source "panel", HIGH): insof-agent uni IT guruhiga Telegram orqali yuboradi
 * (notifyIncidents — panel manbali hodisa birinchi ko'rishdayoq). Admin o'zi bo'lsa «Hodisalar»da yopadi.
 */
async function noteNewIp(a: IssueInput, ip: string, ua: string | null, via: LoginVia) {
  const key = `auth:new-ip:${a.id}`;
  const title = `IT panelga yangi IP'dan kirildi: ${a.login} (${ip})`;
  const detail = { adminId: a.id, login: a.login, ip, userAgent: ua, via, at: new Date().toISOString() };
  const open = await control.incident.findFirst({ where: { key, status: { in: ["OPEN", "ACKED"] } }, select: { id: true } });
  if (open) {
    await control.incident.update({ where: { id: open.id }, data: { count: { increment: 1 }, lastSeenAt: new Date(), title, detail, status: "OPEN", notifiedAt: null } });
  } else {
    await control.incident.create({ data: { key, source: "panel", category: "auth", severity: "HIGH", title, detail } });
  }
}

/** Login + parol tekshiruvi (sessiya bermaydi). Noto'g'ri / bloklangan — null. */
export async function checkAdminPassword(login: string, password: string) {
  const a = await control.superAdmin.findUnique({ where: { login } });
  if (!a || !a.isActive || !(await bcrypt.compare(password, a.passwordHash))) return null;
  return a;
}

/** Sessiya qatorlarini yopish (o'zi chiqqanda, parol almashganda, bloklanganda, «boshqa qurilmalardan chiqish»). */
export async function revokeAdminSessions(adminId: string, opts: { only?: string; except?: string } = {}) {
  await control.adminSession.updateMany({
    where: { adminId, revokedAt: null, ...(opts.only ? { id: opts.only } : {}), ...(opts.except ? { id: { not: opts.except } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export async function adminLogout() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS });
      if (typeof payload.sub === "string" && typeof payload.jti === "string") await revokeAdminSessions(payload.sub, { only: payload.jti });
    } catch { /* yaroqsiz token — faqat cookie o'chadi */ }
  }
  jar.delete(ADMIN_COOKIE);
  jar.delete(PENDING_COOKIE);
}

/* ───────── 2FA: «kod kutilmoqda» bosqichi ───────── */

export type PendingTwoFactor = { id: string; sv: number; via: LoginVia };

export async function issuePendingTwoFactor(a: { id: string; sessionVersion: number }, via: LoginVia) {
  const token = await new SignJWT({ sub: a.id, typ: "admin-2fa", sv: a.sessionVersion, via })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SEC}s`)
    .sign(authSecret());
  (await cookies()).set(PENDING_COOKIE, token, cookieOpts(PENDING_TTL_SEC));
}

export async function getPendingTwoFactor(): Promise<PendingTwoFactor | null> {
  const token = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS });
    if (payload.typ !== "admin-2fa" || typeof payload.sub !== "string") return null;
    return { id: payload.sub, sv: Number(payload.sv ?? 0), via: payload.via === "eco" ? "eco" : "password" };
  } catch {
    return null;
  }
}

export async function clearPendingTwoFactor() {
  (await cookies()).delete(PENDING_COOKIE);
}

/* ───────── Joriy sessiya ───────── */

/** Token bilan birga: sessionVersion (sv) va muddati (exp, unix soniya) — uzoq ulanishlar (SSE) davriy qayta tekshirishi uchun. */
export type AdminSessionFull = AdminSession & { sv: number; exp: number | null };

const getAdminFull = cache(async (): Promise<AdminSessionFull | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS });
    if (payload.typ !== "admin" || typeof payload.sub !== "string" || typeof payload.jti !== "string") return null;
    const sv = (payload.sv ?? 0) as number;
    const s = await control.adminSession.findUnique({ where: { id: payload.jti }, include: { admin: true } });
    const now = Date.now();
    if (!s || s.adminId !== payload.sub || s.revokedAt || s.expiresAt.getTime() <= now) return null;
    const a = s.admin;
    if (!a.isActive || sv !== a.sessionVersion) return null;
    if (now - s.lastSeenAt.getTime() > TOUCH_MS) {
      control.adminSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date(now) } }).catch(() => {});
    }
    return {
      id: a.id, login: a.login, fullName: a.fullName, role: a.role, totp: !!a.totpEnabledAt, sid: s.id,
      sv, exp: typeof payload.exp === "number" ? payload.exp : null,
    };
  } catch {
    return null;
  }
});

export const getAdmin = cache(async (): Promise<AdminSession | null> => {
  const a = await getAdminFull();
  return a ? { id: a.id, login: a.login, fullName: a.fullName, role: a.role, totp: a.totp, sid: a.sid } : null;
});

/**
 * Ochiq turgan sessiya hali yaroqlimi — cookie'ni qayta o'qimasdan (SSE oqimi ichida): hisob bor va faol,
 * sessionVersion o'zgarmagan (parol almashgan / bloklangan), sessiya qatori yopilmagan, token muddati o'tmagan.
 */
export async function adminSessionAlive(s: { id: string; sv: number; exp: number | null; sid: string }, now = Date.now()): Promise<boolean> {
  if (s.exp != null && now >= s.exp * 1000) return false;
  const row = await control.adminSession.findUnique({
    where: { id: s.sid }, select: { revokedAt: true, adminId: true, admin: { select: { isActive: true, sessionVersion: true } } },
  });
  return !!row && !row.revokedAt && row.adminId === s.id && row.admin.isActive && row.admin.sessionVersion === s.sv;
}

/** requireAdmin + token ma'lumoti (sv, exp) — SSE kabi uzoq ulanishlar uchun (adminSessionAlive bilan davriy tekshiriladi). */
export async function requireAdminFull(): Promise<AdminSessionFull> {
  if (process.env.INSOF_MODE !== "control") redirect("/");
  const a = await getAdminFull();
  if (!a) redirect("/superadmin/login");
  return a;
}

/** Panel sahifasi / action boshida. Rejim control bo'lmasa sahifa umuman yo'q. */
export async function requireAdmin(): Promise<AdminSession> {
  if (process.env.INSOF_MODE !== "control") redirect("/");
  const a = await getAdmin();
  if (!a) redirect("/superadmin/login");
  return a;
}

/** Rol yetmasa — rad matni (ActionState uchun), yetsa null. */
export const roleDenied = (a: AdminSession, min: AdminRoleT) => roleDeniedText(a.role, min);

/** Natija qaytarmaydigan action'lar uchun: rol yetmasa xato tashlanadi. */
export async function requireRole(min: AdminRoleT): Promise<AdminSession> {
  const a = await requireAdmin();
  const deny = roleDenied(a, min);
  if (deny) throw new Error(deny);
  return a;
}
