import { createHash } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { companySuspension, SUSPENDED_MESSAGE } from "@/lib/tenant";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/nav";
import type { Role } from "@/generated/prisma";
import { authSecret, JWT_ALGS } from "@/lib/secret";
import { verifyLoginCode } from "@/lib/sms-login";
import { DUMMY_PASSWORD_HASH, parsePerms, type Perms } from "@/lib/auth";

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

/** `perms` — direktor bergan modul/amal ruxsatlari (veb bilan bir xil, `lib/permissions.ts`); har so'rovda bazadan. */
export type MobileUser = { id: string; login: string; fullName: string; role: Role; roleLabel: string; perms?: Perms };
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
    // Noyob jti: bir soniyada berilgan ikki token bir xil bo'lmasin — aks holda refresh "yangi" juftlik
    // sifatida eskisining aynan nusxasini qaytarardi, bitta qurilmadagi logout boshqasini ham o'ldirardi
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(typ === "access" ? ACCESS_TTL : REFRESH_TTL)
    .sign(authSecret());
}

async function issue(u: DbUser): Promise<MobileTokens & { user: MobileUser }> {
  // IT superadmin mobil ilovaga kirmaydi; to'xtatilgan korxonaga hech kim kirmaydi
  if (u.role === "SUPERADMIN") throw new MobileAuthError("BAD_CREDENTIALS", "Login yoki parol noto'g'ri");
  if (await companySuspension()) throw new MobileAuthError("USER_DISABLED", SUSPENDED_MESSAGE);
  const [accessToken, refreshToken] = await Promise.all([sign(u, "access"), sign(u, "refresh")]);
  return { accessToken, refreshToken, user: toUser(u) };
}

/** Login + parol. Xato xabari bir xil — login bor/yo'qligi oshkor qilinmaydi. */
export async function mobileLogin(loginName: string, password: string) {
  const user = await db.user.findUnique({ where: { login: loginName.trim() } });
  // bcrypt har doim ishlaydi (login yo'q bo'lsa soxta xesh bilan) — javob vaqti login borligini oshkor qilmasin
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !user.isActive || !ok) {
    throw new MobileAuthError("BAD_CREDENTIALS", "Login yoki parol noto'g'ri");
  }
  return issue(user);
}

/**
 * SMS/Telegram kod bilan kirish (parolsiz) — telefoni bor har qanday faol xodim uchun.
 * Kodni `lib/sms-login.ts` yaratadi/yuboradi (`/api/mobile/auth/code`), bu yerda tekshiriladi
 * va kuydiriladi. Token FAQAT kod to'g'ri bo'lgach beriladi. Xato xabari bir xil —
 * raqam tizimda bor-yo'qligi oshkor qilinmaydi.
 */
export async function mobileLoginWithCode(phone: string, code: string) {
  const r = await verifyLoginCode(phone, code);
  if (!r.ok) throw new MobileAuthError("BAD_CODE", r.error);
  return issue(r.user);
}

/**
 * Refresh → yangi juftlik (rotatsiya). Ishlatilgan refresh token darhol rad ro'yxatiga tushadi:
 * o'g'irlangan nusxa bilan ikkinchi marta yangilab bo'lmaydi. Tekshiruv va belgilash orasida
 * `await` yo'q — parallel ikki so'rovdan faqat bittasi o'tadi. Xodim o'chirilgan bo'lsa sessiya tugaydi.
 */
export async function mobileRefresh(refreshToken: string) {
  const payload = await verify(refreshToken, "refresh");
  if (!claimToken(refreshToken, payload)) throw new MobileAuthError("TOKEN_INVALID", "Qayta kiring");
  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw new MobileAuthError("USER_DISABLED", "Hisob faol emas");
  if ((payload.sv ?? 0) !== user.sessionVersion) throw new MobileAuthError("TOKEN_INVALID", "Qayta kiring");
  return issue(user);
}

type TokenPayload = { sub: string; login: string; role: Role; typ: string; sv?: number; jti?: string; exp?: number };

async function verify(token: string, typ: "access" | "refresh") {
  let payload: TokenPayload;
  try {
    const r = await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS });
    if (r.payload.typ !== typ) throw new Error("wrong typ");
    payload = r.payload as unknown as TokenPayload;
  } catch {
    throw new MobileAuthError("TOKEN_INVALID", typ === "refresh" ? "Qayta kiring" : "Sessiya muddati tugagan");
  }
  if (isRevoked(token, payload)) throw new MobileAuthError("TOKEN_INVALID", typ === "refresh" ? "Qayta kiring" : "Sessiya muddati tugagan");
  return payload;
}

/* ───────────── Chiqish va rotatsiya: tokenni server tomonda bekor qilish ─────────────
 *
 * Veb'dagi kabi (`lib/auth.ts` revokeToken) xotiradagi rad ro'yxati: kalit — jti (eski, jti'siz
 * tokenlarda — token xeshi), qiymat — token muddati. ERP bitta jarayonda ishlaydi; restart'da ro'yxat
 * tozalanadi — maqbul: access 12 soatda o'ladi, xavfli holatda direktor parolni almashtiradi (sessionVersion).
 * `globalThis` — route modullari alohida yuklansa ham ro'yxat bitta bo'lsin.
 */
const g = globalThis as unknown as { __insofMobileRevoked?: Map<string, number> };
const revoked = (g.__insofMobileRevoked ??= new Map<string, number>());
const revokeKey = (token: string, p: { jti?: string }) => (p.jti ? `j:${p.jti}` : `h:${createHash("sha256").update(token).digest("base64url")}`);

function isRevoked(token: string, p: TokenPayload): boolean {
  const k = revokeKey(token, p);
  const exp = revoked.get(k);
  if (exp === undefined) return false;
  if (exp <= Date.now()) { revoked.delete(k); return false; }
  return true;
}

/** Tokenni rad ro'yxatiga qo'yadi. Allaqachon ro'yxatda bo'lsa false (sinxron — poyga yo'q). */
function claimToken(token: string, p: TokenPayload): boolean {
  const now = Date.now();
  const k = revokeKey(token, p);
  const exp = revoked.get(k);
  if (exp !== undefined && exp > now) return false;
  revoked.set(k, (p.exp ?? 0) * 1000 || now + 30 * 86400_000);
  if (revoked.size > 5000) for (const [key, e] of revoked) if (e <= now) revoked.delete(key);
  return true;
}

/**
 * Mobil "Chiqish": berilgan access va refresh tokenlarni muddati tugaguncha bekor qiladi.
 * Faqat SHU qurilma — boshqa qurilmalardagi sessiyalar qoladi. Yaroqsiz/eskirgan token — e'tiborsiz.
 * Refresh token faqat access token egasiniki bo'lsa bekor qilinadi (begona tokenni "chiqarib" bo'lmasin).
 * Qaytaradi: access token egasi (topilsa) — qurilmaning push manzilini o'chirish uchun.
 */
export async function mobileLogout(accessToken: string, refreshToken: string): Promise<{ userId: string | null }> {
  let userId: string | null = null;
  if (accessToken) {
    try {
      const p = await verify(accessToken, "access");
      claimToken(accessToken, p);
      userId = p.sub;
    } catch { /* yaroqsiz yoki allaqachon bekor qilingan */ }
  }
  if (refreshToken) {
    try {
      const p = await verify(refreshToken, "refresh");
      if (!userId || p.sub === userId) claimToken(refreshToken, p);
    } catch { /* yaroqsiz */ }
  }
  return { userId };
}

/** `Authorization: Bearer …` sarlavhasidan token (bo'lmasa bo'sh satr). */
export function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/** Har bir himoyalangan mobil endpoint boshida. `Authorization: Bearer <access>`. */
export async function requireMobileUser(req: Request): Promise<MobileUser> {
  const token = bearerToken(req);
  if (!token) throw new MobileAuthError("NO_TOKEN", "Token yo'q");
  const payload = await verify(token, "access");
  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw new MobileAuthError("USER_DISABLED", "Hisob faol emas");
  if ((payload.sv ?? 0) !== user.sessionVersion) throw new MobileAuthError("TOKEN_INVALID", "Sessiya muddati tugagan");
  if (user.role === "SUPERADMIN") throw new MobileAuthError("USER_DISABLED", "Hisob faol emas");
  if (await companySuspension()) throw new MobileAuthError("USER_DISABLED", SUSPENDED_MESSAGE);
  // Ruxsatlar tokenga yozilmaydi — direktor o'zgartirsa keyingi so'rovdanoq amal qiladi (`can()` — detail.ts)
  return { ...toUser(user), perms: parsePerms(user.perms) };
}
