import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";
import type { Prisma, Role } from "@/generated/prisma";
import { TOUR_COOKIE } from "./tour";
import { authSecret, JWT_ALGS } from "./secret";
import { companySuspension, effectiveRole } from "./tenant";

const COOKIE = "insof_session";
const SESSION_TTL_SEC = 60 * 60 * 12;

/** Modul (asosiy bo'lim) bo'yicha ruxsat darajasi — direktor User.perms da taqsimlaydi. */
export type PermLevel = "none" | "view" | "write";
/**
 * `{ "<modul>": "none" | "view" | "write" | ["<amal>", ...] }` — massiv: ko'radi + faqat shu amallar
 * (amallar katalogi `lib/permissions.ts`). Satr qiymatlar — eski (modul darajali) format, o'zgarishsiz ishlaydi.
 */
export type PermValue = PermLevel | string[];
export type Perms = Record<string, PermValue>;

export type Session = {
  userId: string; login: string; fullName: string; role: Role;
  /** Direktor bergan modul ruxsatlari (rol ustiga ishlaydi). Token ichida saqlanmaydi — bazadan o'qiladi. */
  perms?: Perms;
  /** IT superadmin (markaziy paneldan SSO). `role` bunda "DIRECTOR" — korxona ichida to'liq huquq. */
  superadmin?: boolean;
};

/** Tokendagi maydonlar: `sv` — User.sessionVersion; parol almashsa/hisob yopilsa eski tokenlar kuyadi.
 *  `perms` tokenga yozilmaydi: direktor ruxsatni o'zgartirsa, foydalanuvchini qayta kirishga majburlamay,
 *  har so'rovda bazadagi yangi qiymat o'qiladi. */
type Claims = Omit<Session, "perms" | "superadmin"> & { sv: number };

type SessionUser = { id: string; login: string; fullName: string; role: Role; sessionVersion: number };

const VALID_LEVELS: PermLevel[] = ["none", "view", "write"];

/** User.perms (Json) ni xavfsiz o'qish: daraja satri yoki amallar massivi qoladi, buzuq qiymat tashlanadi. */
export function parsePerms(raw: unknown): Perms | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Perms = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && (VALID_LEVELS as string[]).includes(v)) out[k] = v as PermLevel;
    else if (Array.isArray(v)) out[k] = [...new Set(v.filter((a): a is string => typeof a === "string" && /^[a-z_]{1,32}$/.test(a)))];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Cookie'ga yangi imzolangan sessiya yozadi (login va parol o'zgarganda qayta berish uchun). */
export async function issueSession(user: SessionUser): Promise<Session> {
  // Superadmin tokenda ham "DIRECTOR" — middleware (Edge, bazasiz) yo'l ruxsatini shu bo'yicha hisoblaydi
  const session: Session = { userId: user.id, login: user.login, fullName: user.fullName, role: effectiveRole(user.role), superadmin: user.role === "SUPERADMIN" || undefined };
  const { superadmin: _sa, ...base } = session; void _sa;
  const claims: Claims = { ...base, sv: user.sessionVersion };
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
  // Superadmin login/parol bilan kirmaydi — faqat markaziy paneldan SSO (`/api/control/sso`)
  if (!user || !user.isActive || user.role === "SUPERADMIN") return null;
  if (await companySuspension()) return null; // sabab login sahifasida alohida ko'rsatiladi
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
  // Mobil token (`typ` bor, `userId` yo'q) veb sessiya emas
  if ((claims as { typ?: unknown }).typ !== undefined || typeof claims.userId !== "string") return null;
  const user = await db.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, login: true, fullName: true, role: true, isActive: true, sessionVersion: true, perms: true },
  });
  if (!user || !user.isActive) return null;
  if ((claims.sv ?? 0) !== user.sessionVersion) return null;
  const superadmin = user.role === "SUPERADMIN";
  // To'xtatilgan korxonada faqat IT superadmin ishlay oladi (ma'lumotni ko'rish, eksport, qayta yoqish)
  if (!superadmin && (await companySuspension())) return null;
  return { userId: user.id, login: user.login, fullName: user.fullName, role: effectiveRole(user.role), perms: parsePerms(user.perms), superadmin: superadmin || undefined };
});

/**
 * Amal huquqi — `userId` (sessiya emas) bilan, shuning uchun `lib/orders.ts` kabi domen funksiyalari
 * (veb va mobil bitta joydan o'tadi) ham chaqira oladi. Qoida — `lib/permissions.ts` → `canDo`.
 */
export async function canDoByUserId(userId: string, module: string, action: string): Promise<boolean> {
  const { canDo } = await import("./permissions");
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true, perms: true, isActive: true } });
  if (!u || !u.isActive) return false;
  return canDo({ role: u.role, perms: parsePerms(u.perms) }, module, action);
}

/**
 * Server action uchun: amal ruxsati bo'lmasa xato. Direktor bergan ruxsat rol cheklovidan ustun.
 * `fallbackRoles` — katalogda (`MODULE_ACTIONS`) yo'q amal uchun.
 */
export async function requireAction(module: string, action: string, fallbackRoles?: readonly Role[]): Promise<Session> {
  const { canDo } = await import("./permissions");
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  if (!canDo(s, module, action, fallbackRoles)) throw new Error("Bu amal uchun sizda ruxsat yo'q — direktordan ruxsat so'rang");
  return s;
}

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
  // Eski telefonlar push olishda davom etmasin — ilova qayta kirganda qurilmani yana ro'yxatdan o'tkazadi
  await tx.mobileDevice.deleteMany({ where: { userId } });
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
