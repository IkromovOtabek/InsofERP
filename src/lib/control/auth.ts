import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { authSecret, JWT_ALGS } from "../secret";
import { control } from "./db";

/**
 * Superadmin (IT) sessiyasi — faqat markaziy panelda (INSOF_MODE=control).
 * Korxona sessiyasidan alohida: boshqa cookie, tokenda `typ: "admin"` (korxona `getSession` uni rad etadi).
 */
export const ADMIN_COOKIE = "insof_admin";
const TTL_SEC = 60 * 60 * 8;

export type AdminSession = { id: string; login: string; fullName: string };

export async function issueAdminSession(a: { id: string; login: string; fullName: string; sessionVersion: number }) {
  const token = await new SignJWT({ sub: a.id, login: a.login, typ: "admin", sv: a.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SEC}s`)
    .sign(authSecret());
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_SEC,
  });
}

export async function adminLogin(login: string, password: string): Promise<AdminSession | null> {
  const a = await control.superAdmin.findUnique({ where: { login } });
  if (!a || !a.isActive || !(await bcrypt.compare(password, a.passwordHash))) return null;
  await control.superAdmin.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
  await issueAdminSession(a);
  return { id: a.id, login: a.login, fullName: a.fullName };
}

export async function adminLogout() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export const getAdmin = cache(async (): Promise<AdminSession | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS });
    if (payload.typ !== "admin" || typeof payload.sub !== "string") return null;
    const a = await control.superAdmin.findUnique({ where: { id: payload.sub } });
    if (!a || !a.isActive || (payload.sv ?? 0) !== a.sessionVersion) return null;
    return { id: a.id, login: a.login, fullName: a.fullName };
  } catch {
    return null;
  }
});

/** Panel sahifasi / action boshida. Rejim control bo'lmasa sahifa umuman yo'q. */
export async function requireAdmin(): Promise<AdminSession> {
  if (process.env.INSOF_MODE !== "control") redirect("/");
  const a = await getAdmin();
  if (!a) redirect("/superadmin/login");
  return a;
}
