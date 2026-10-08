import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, revokeSessions } from "@/lib/auth";
import { passwordProblem } from "@/lib/password-policy";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { hit } from "@/lib/rate-limit";
import { linkedChatId, sendAccountChangeCodeToBot } from "@/lib/telegram/notify";
import { botEnabled } from "@/lib/telegram/api";
import { gatewayEnabled, sendGatewayCode } from "@/lib/telegram/gateway";
import { devCodeAllowed, logUndelivered } from "@/lib/telegram/otp";

/**
 * "Mening hisobim" — xodim o'z loginini va parolini o'zi o'zgartiradi.
 *
 * Tasdiq — bir martalik kod, xodim kartasidagi (Employee.phone) raqamga Telegram orqali:
 * avval Insof ERP boti (hisob ulangan bo'lsa), keyin Telegram Gateway. SMS yo'q.
 * Ochiq qolgan kompyuterda begona odam kodsiz parolni almashtira olmasin — shuning uchun
 * sessiyaning o'zi yetarli emas.
 *
 * Kartada raqam yo'q bo'lsa (masalan direktorning xodim kartasi yo'q) — joriy parol bilan
 * tasdiqlanadi. Kod `PasswordResetCode` jadvalida (parol tiklash bilan bir xil qoidalar):
 * faqat bcrypt xeshi, 5 daqiqa, 5 urinish, soatiga 3 ta kod.
 */

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 3;
/** Login qoidasi — `lib/access-request.ts` bilan bir xil. */
export const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const LOGIN_HINT = "3–32 belgi: lotin harf, raqam, nuqta, chiziq";

export type SelfAccount = {
  login: string;
  fullName: string;
  /** Kod shu raqamga boradi (ekranda to'liq ko'rsatiladi — o'z raqami). */
  phone: string | null;
  /** Insof ECO ilovasi hisobi: paroli ilovada, ERP'da login/parol yo'q. */
  eco: boolean;
};

export async function selfAccount(userId: string): Promise<SelfAccount | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { login: true, fullName: true, ecoUserId: true, employee: { select: { phone: true, isActive: true } } },
  });
  if (!u) return null;
  const phone = u.employee?.isActive ? normalizePhone(u.employee.phone) : null;
  return { login: u.login, fullName: u.fullName, phone: phone ? formatPhone(phone) : null, eco: !!u.ecoUserId };
}

export type SelfCodeRequest = { ok: true; devCode?: string } | { ok: false; error: string };

/** 1-qadam: xodimning o'z raqamiga kod. */
export async function requestSelfChangeCode(userId: string): Promise<SelfCodeRequest> {
  const acc = await selfAccount(userId);
  if (!acc) return { ok: false, error: "Hisob topilmadi" };
  if (acc.eco) return { ok: false, error: "Siz Insof ECO ilovasi hisobi bilan kirasiz — parolni ilovaning o'zida o'zgartiring" };
  const phone = normalizePhone(acc.phone);
  if (!phone) return { ok: false, error: "Xodim kartangizda telefon raqami yo'q — joriy parol bilan tasdiqlang yoki Otdel kadrga murojaat qiling" };

  if (!hit(`self-code:u:${userId}`, MAX_CODES_PER_HOUR, 3600_000)) return { ok: false, error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring" };
  const recent = await db.passwordResetCode.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent >= MAX_CODES_PER_HOUR) return { ok: false, error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring" };

  const botReady = botEnabled() && !!(await linkedChatId(userId));
  const gateway = gatewayEnabled();
  if (!botReady && !gateway && !devCodeAllowed()) {
    logUndelivered("self-account", phone, "Telegram bot ulanmagan va TELEGRAM_GATEWAY_TOKEN sozlanmagan");
    return { ok: false, error: "Kod yuborib bo'lmadi: Telegram ulanmagan. Joriy parol bilan tasdiqlang yoki administratorga murojaat qiling" };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.passwordResetCode.create({
    data: { userId, phone, codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });

  if (botReady && (await sendAccountChangeCodeToBot(userId, code)).ok) return { ok: true };
  if (gateway) {
    const gw = await sendGatewayCode(phone, code, { ttlSec: Math.round(CODE_TTL_MS / 1000), payload: `self:${userId}` });
    if (gw.ok) return { ok: true };
    logUndelivered("self-account", phone, `Gateway: ${gw.reason}${gw.error ? ` (${gw.error})` : ""}`);
  }
  if (devCodeAllowed()) return { ok: true, devCode: code };
  return { ok: false, error: "Kod yetkazilmadi. Raqamingizda Telegram borligini tekshiring yoki joriy parol bilan tasdiqlang" };
}

export type SelfChange = { login?: string; password?: string; code?: string; currentPassword?: string };
export type SelfChangeResult = { ok: true; login: string; passwordChanged: boolean } | { ok: false; error: string };

const WRONG_CODE = "Kod noto'g'ri yoki muddati tugagan. Bir necha marta xato bo'lsa — yangi kod so'rang";

/**
 * 2-qadam: kod (yoki raqam yo'q bo'lsa — joriy parol) + yangi login va/yoki parol.
 * Parol almashsa boshqa qurilmalardagi sessiyalar kuyadi, joriy brauzer kirgan holda qoladi.
 */
export async function confirmSelfChange(userId: string, input: SelfChange): Promise<SelfChangeResult> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { login: true, passwordHash: true, ecoUserId: true, isActive: true } });
  if (!user || !user.isActive) return { ok: false, error: "Hisob topilmadi" };
  if (user.ecoUserId) return { ok: false, error: "Siz Insof ECO ilovasi hisobi bilan kirasiz — parolni ilovaning o'zida o'zgartiring" };

  const login = input.login?.trim().toLowerCase() || undefined;
  const password = input.password || undefined;
  const newLogin = login && login !== user.login ? login : undefined;
  if (!newLogin && !password) return { ok: false, error: "Yangi login yoki yangi parolni kiriting" };
  if (newLogin && !LOGIN_RE.test(newLogin)) return { ok: false, error: `Login: ${LOGIN_HINT}` };
  if (password) {
    const problem = passwordProblem(password);
    if (problem) return { ok: false, error: problem };
  }
  if (newLogin && (await db.user.findUnique({ where: { login: newLogin }, select: { id: true } }))) return { ok: false, error: "Bu login band — boshqasini tanlang" };

  const acc = await selfAccount(userId);
  const phone = normalizePhone(acc?.phone);
  let codeId: string | null = null;

  if (phone) {
    const code = input.code?.trim() ?? "";
    if (!/^\d{6}$/.test(code)) return { ok: false, error: "Telegram'ga kelgan 6 xonali kodni kiriting" };
    const rec = await db.passwordResetCode.findFirst({ where: { userId, phone, usedAt: null }, orderBy: { createdAt: "desc" } });
    if (!rec || rec.expiresAt < new Date() || rec.attempts >= MAX_ATTEMPTS) return { ok: false, error: WRONG_CODE };
    // Urinish taqqoslashdan OLDIN atomar hisoblanadi — parallel so'rovlar bilan 5 tadan ortiq taxmin qilib bo'lmasin
    const slot = await db.passwordResetCode.updateMany({ where: { id: rec.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    if (slot.count === 0 || !(await bcrypt.compare(code, rec.codeHash))) return { ok: false, error: WRONG_CODE };
    codeId = rec.id;
  } else {
    // Kartada raqam yo'q — joriy parol bilan tasdiq (urinishlar soni cheklangan)
    if (!hit(`self-pw:u:${userId}`, 5, 15 * 60_000)) return { ok: false, error: "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring" };
    if (!input.currentPassword || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) return { ok: false, error: "Joriy parol noto'g'ri" };
  }

  const hash = password ? await hashPassword(password) : null;
  try {
    const done = await db.$transaction(async (tx) => {
      if (codeId) {
        // Kod faqat bir marta — parallel ikkinchi so'rov shu yerda to'xtaydi; qolgan ochiq kodlar ham kuyadi
        const claim = await tx.passwordResetCode.updateMany({ where: { id: codeId, usedAt: null }, data: { usedAt: new Date() } });
        if (claim.count === 0) return false;
        await tx.passwordResetCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
      }
      await tx.user.update({ where: { id: userId }, data: { ...(newLogin ? { login: newLogin } : {}), ...(hash ? { passwordHash: hash } : {}) } });
      await audit(tx, userId, "UPDATE", "User", userId, newLogin ? { login: user.login } : undefined, {
        ...(newLogin ? { login: newLogin } : {}),
        ...(hash ? { passwordChanged: true } : {}),
        selfService: phone ? "telegram-code" : "current-password",
      });
      // Parol yoki login almashdi — boshqa qurilmalar chiqib ketadi, shu brauzer yangi cookie oladi
      await revokeSessions(tx, userId, { keepCurrent: true });
      return true;
    });
    if (!done) return { ok: false, error: WRONG_CODE };
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { ok: false, error: "Bu login band — boshqasini tanlang" };
    throw e;
  }
  return { ok: true, login: newLogin ?? user.login, passwordChanged: !!hash };
}
