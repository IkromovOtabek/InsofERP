import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";
import type { Role } from "@/generated/prisma";
import { TOUR_COOKIE } from "./tour";

const COOKIE = "insof_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret");

export type Session = { userId: string; login: string; fullName: string; role: Role };

export async function hashPassword(p: string) {
  return bcrypt.hash(p, 10);
}

export async function login(loginName: string, password: string): Promise<Session | null> {
  const user = await db.user.findUnique({ where: { login: loginName } });
  if (!user || !user.isActive) return null;
  if (!(await bcrypt.compare(password, user.passwordHash))) return null;

  const session: Session = { userId: user.id, login: user.login, fullName: user.fullName, role: user.role };
  const token = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("12h")
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
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

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as Session;
  } catch {
    return null;
  }
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
