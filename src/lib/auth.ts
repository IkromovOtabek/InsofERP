import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";
import type { Prisma, Role } from "@/generated/prisma";
import { TOUR_COOKIE } from "./tour";
import { authSecret, JWT_ALGS } from "./secret";

const COOKIE = "insof_session";
const SESSION_TTL_SEC = 60 * 60 * 12;

export type Session = { userId: string; login: string; fullName: string; role: Role };

/** Tokendagi maydonlar: `sv` — User.sessionVersion; parol almashsa/hisob yopilsa eski tokenlar kuyadi. */
type Claims = Session & { sv: number };

type SessionUser = { id: string; login: string; fullName: string; role: Role; sessionVersion: number };

/** Cookie'ga yangi imzolangan sessiya yozadi (login va parol o'zgarganda qayta berish uchun). */
export async function issueSession(user: SessionUser): Promise<Session> {
  const session: Session = { userId: user.id, login: user.login, fullName: user.fullName, role: user.role };
  const claims: Claims = { ...session, sv: user.sessionVersion };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(authSecret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return session;
}

export async function hashPassword(p: string) {
  return bcrypt.hash(p, 10);
}

export async function login(loginName: string, password: string): Promise<Session | null> {
  const user = await db.user.findUnique({ where: { login: loginName } });
  if (!user || !user.isActive) return null;
  if (!(await bcrypt.compare(password, user.passwordHash))) return null;

  const session = await issueSession(user);
  // Instruksiya har kirishda boshidan ko'rsatiladi: oldingi sessiyada "o'tkazib yuborildi"
  // deb belgilangan bo'lsa ham, yangi kirishda belgi o'chadi.
  (await cookies()).delete(TOUR_COOKIE);
  return session;
}

export async function logout() {
  const c = await cookies();
  c.delete(COOKIE);
  c.delete(TOUR_COOKIE);
}

/**
 * Joriy sessiya. Token imzosi tekshirilgach hisob bazadan ham tekshiriladi:
 * o'chirilgan xodim yoki paroli almashgan (sessionVersion oshgan) hisobning eski
 * tokeni darhol yaroqsiz — 12 soat kutilmaydi. Rol va F.I.O. ham bazadagi yangi qiymat.
 * `cache` — bitta so'rov ichida necha marta chaqirilsa ham bazaga bir marta boriladi.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let claims: Claims;
  try {
    claims = (await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS })).payload as unknown as Claims;
  } catch {
    return null;
  }
  const user = await db.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, login: true, fullName: true, role: true, isActive: true, sessionVersion: true },
  });
  if (!user || !user.isActive) return null;
  if ((claims.sv ?? 0) !== user.sessionVersion) return null;
  return { userId: user.id, login: user.login, fullName: user.fullName, role: user.role };
});

/**
 * Hisobning barcha sessiyalarini (veb cookie + mobil access/refresh) bekor qiladi.
 * Parol almashganda, hisob yopilganda chaqiriladi. `keepCurrent` — amalni bajarayotgan
 * odam o'z parolini almashtirgan bo'lsa, unga shu zahoti yangi cookie beriladi.
 */
export async function revokeSessions(tx: Prisma.TransactionClient | typeof db, userId: string, opts?: { keepCurrent?: boolean }) {
  const u = await tx.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { id: true, login: true, fullName: true, role: true, sessionVersion: true },
  });
  if (opts?.keepCurrent) await issueSession(u);
}

/** Server action / page ichida: sessiya yo'q bo'lsa xato, rol mos kelmasa xato. */
export async function requireSession(allowed?: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  if (allowed && !allowed.includes(s.role) && s.role !== "DIRECTOR") {
    throw new Error("FORBIDDEN");
  }
  return s;
}
