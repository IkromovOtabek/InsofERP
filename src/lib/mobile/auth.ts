import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/nav";
import type { Role } from "@/generated/prisma";
import { authSecret, JWT_ALGS } from "@/lib/secret";

/**
 * Mobil ilova (Insof ECO) uchun autentifikatsiya — ERP login/paroli bo'yicha.
 *
 * Veb ERP cookie bilan ishlaydi (`lib/auth.ts`), mobil ilovada cookie yo'q:
 * shuning uchun Bearer token. Ikkalasi bitta `AUTH_SECRET` bilan imzolanadi,
 * lekin `typ` da ajraladi — veb tokeni mobil API'ga, mobil tokeni veb sahifaga o'tmaydi.
 *
 * Refresh token bazada saqlanmaydi (ERP'da Session jadvali yo'q): u ham JWT,
 * lekin uzoq muddatli va faqat yangi juftlik olish uchun. Xodim `isActive`
 * bo'lmay qolsa — yangilashda ham, har so'rovda ham darhol rad etiladi.
 * Tokenda `sv` (User.sessionVersion) bor: parol almashsa yoki hisob yopilsa
 * eski access va refresh tokenlar birdaniga kuyadi — 30 kun kutilmaydi.
 */

const ACCESS_TTL = "12h";
const REFRESH_TTL = "30d";

export type MobileUser = { id: string; login: string; fullName: string; role: Role; roleLabel: string };
export type MobileTokens = { accessToken: string; refreshToken: string };

export class MobileAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 401) { super(message); }
}

const toUser = (u: { id: string; login: string; fullName: string; role: Role }): MobileUser => ({
  id: u.id, login: u.login, fullName: u.fullName, role: u.role, roleLabel: ROLE_LABELS[u.role],
});

type DbUser = { id: string; login: string; fullName: string; role: Role; sessionVersion: number };

async function sign(user: DbUser, typ: "access" | "refresh") {
  return new SignJWT({ sub: user.id, login: user.login, role: user.role, typ, sv: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(typ === "access" ? ACCESS_TTL : REFRESH_TTL)
    .sign(authSecret());
}

async function issue(u: DbUser): Promise<MobileTokens & { user: MobileUser }> {
  const [accessToken, refreshToken] = await Promise.all([sign(u, "access"), sign(u, "refresh")]);
  return { accessToken, refreshToken, user: toUser(u) };
}

/** Login + parol. Xato xabari bir xil — login bor/yo'qligi oshkor qilinmaydi. */
export async function mobileLogin(loginName: string, password: string) {
  const user = await db.user.findUnique({ where: { login: loginName.trim() } });
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new MobileAuthError("BAD_CREDENTIALS", "Login yoki parol noto'g'ri");
  }
  return issue(user);
}

/** Refresh → yangi juftlik. Xodim o'chirilgan bo'lsa sessiya tugaydi. */
export async function mobileRefresh(refreshToken: string) {
  const payload = await verify(refreshToken, "refresh");
  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw new MobileAuthError("USER_DISABLED", "Hisob faol emas");
  if ((payload.sv ?? 0) !== user.sessionVersion) throw new MobileAuthError("TOKEN_INVALID", "Qayta kiring");
  return issue(user);
}

async function verify(token: string, typ: "access" | "refresh") {
  try {
    const { payload } = await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS });
    if (payload.typ !== typ) throw new Error("wrong typ");
    return payload as unknown as { sub: string; login: string; role: Role; typ: string; sv?: number };
  } catch {
    throw new MobileAuthError("TOKEN_INVALID", typ === "refresh" ? "Qayta kiring" : "Sessiya muddati tugagan");
  }
}

/** Har bir himoyalangan mobil endpoint boshida. `Authorization: Bearer <access>`. */
export async function requireMobileUser(req: Request): Promise<MobileUser> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new MobileAuthError("NO_TOKEN", "Token yo'q");
  const payload = await verify(token, "access");
  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw new MobileAuthError("USER_DISABLED", "Hisob faol emas");
  if ((payload.sv ?? 0) !== user.sessionVersion) throw new MobileAuthError("TOKEN_INVALID", "Sessiya muddati tugagan");
  return toUser(user);
}
