import { eco, ecoEnabled, EcoError, normalizePhone } from "@/lib/eco/client";
import { checkLogin, failDelay, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";
import { control } from "./db";
import { logEvent } from "./events";
import { verifyReauth } from "./reauth";

/**
 * IT panelga Insof ECO ilovasi orqali kirish (telefon + ilova paroli).
 *
 * ERP'dagi `loginWithAppPhone` bilan bir xil sxema: parolni ECO tekshiradi (`POST /v1/erp/auth/verify`,
 * `eco.verifyCredentials`), panel esa faqat "bu ECO hisobi qaysi superadminga ulangan" ni hal qiladi
 * (`SuperAdmin.ecoUserId`). Farqi — panel hech qachon hisob yaratmaydi va rol bermaydi: ECO hisobini faqat
 * superadminning O'ZI, joriy panel paroli bilan ("Mening hisobim") ulaydi.
 *
 * Xavfsizlik:
 *  · qulf (login-guard) `admin-eco:<telefon>` + IP bo'yicha, ECO'ga so'rovdan OLDIN tekshiriladi;
 *  · xato parol, ulanmagan hisob, bloklangan admin — hammasida bir xil javob va bir xil kechikish:
 *    raqam panelga ulangan-ulanmagani oshkor bo'lmaydi (sabab faqat jurnalda);
 *  · ECO sozlanmagan / javob bermasa — aniq xabar, login/parol bilan kirish ta'sirlanmaydi;
 *  · parollar hech qayerga yozilmaydi, jurnalga telefon faqat maskalangan holda tushadi.
 */

export const ECO_LOGIN_FAIL = "Telefon yoki parol noto'g'ri";
export const ECO_UNAVAILABLE = "Insof ECO serveri javob bermayapti — login va parol bilan kiring";

/** ECO sozlanganmi (control.env: ECO_API_URL + ECO_API_KEY). Yo'q bo'lsa login sahifasida telefon tabi ko'rinmaydi. */
export const adminEcoEnabled = () => ecoEnabled();

/** +998901234567 → "+998 90 *** ** 67" (jurnal va "Mening hisobim" uchun). */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length !== 12) return "***";
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} *** ** ${d.slice(10)}`;
}

export const ECO_RATE_LIMITED = "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring.";

/**
 * ECO javobi "telefon/parol noto'g'ri" mi. ECO (`erp.service.verifyCredentials`) hisob yo'q / parolsiz / o'chirilgan /
 * zavodga aloqasiz / parol xato — hammasida 401 AUTH_BAD_CREDENTIALS. 401 AUTH_TOKEN_INVALID esa — panelning
 * ECO_API_KEY yaroqsiz (bu foydalanuvchi xatosi emas, qulfga sanalmaydi).
 */
const isBadCredentials = (e: unknown) => e instanceof EcoError && e.status === 401 && e.code !== "AUTH_TOKEN_INVALID";
const isRateLimited = (e: unknown) => e instanceof EcoError && e.status === 429;
const ecoErrLog = (e: unknown) =>
  e instanceof EcoError ? (e.code === "AUTH_TOKEN_INVALID" ? "ECO_API_KEY yaroqsiz (control.env)" : `${e.code} ${e.status}`) : e;

export type EcoAdmin = { id: string; login: string; fullName: string; sessionVersion: number };
export type EcoLoginResult = { ok: true; admin: EcoAdmin } | { ok: false; error: string };

/**
 * Telefon + ECO paroli → superadmin. Sessiyani (cookie) chaqiruvchi beradi (`issueAdminSession`).
 * `ip` — `clientIp()` (server action'da).
 */
export async function ecoAdminLogin(phoneRaw: string, password: string, ip: string): Promise<EcoLoginResult> {
  if (!adminEcoEnabled()) return { ok: false, error: "Telefon bilan kirish sozlanmagan — login va parol bilan kiring" };
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri: +998 XX XXX XX XX" };
  if (!password) return { ok: false, error: "Parolni kiriting" };

  const key = `admin-eco:${phone}`;
  const guard = checkLogin(key, ip);
  if (!guard.ok) return { ok: false, error: lockedMessage(guard.retryAfterSec) };

  const fail = async (reason: string | null, extra?: Record<string, unknown>): Promise<EcoLoginResult> => {
    recordFailure(key, ip);
    if (reason) await logEvent(null, "ADMIN_LOGIN_ECO_FAIL", null, { reason, phone: maskPhone(phone), ...extra }).catch(() => {});
    await failDelay();
    return { ok: false, error: ECO_LOGIN_FAIL };
  };

  let eu: { userId: string; phone: string; fullName: string | null };
  try {
    if (password.length > 200) return fail(null);
    eu = await eco.verifyCredentials(phone, password);
  } catch (e) {
    if (isBadCredentials(e)) return fail(null);
    // ECO'ning o'z limiti (telefon bo'yicha 10 / 15 daq) — ulangan-ulanmaganidan qat'i nazar bir xil
    if (isRateLimited(e)) { recordFailure(key, ip); await failDelay(); return { ok: false, error: ECO_RATE_LIMITED }; }
    console.error("[admin-eco-login]", ecoErrLog(e));
    return { ok: false, error: ECO_UNAVAILABLE };
  }

  // ECO paroli to'g'ri — endi panel ruxsati. Javob xato parol bilan AYNAN bir xil, sabab faqat jurnalda.
  const a = await control.superAdmin.findUnique({ where: { ecoUserId: eu.userId } });
  if (!a) return fail("bog'lanmagan ECO hisobi bilan urinish", { ecoUserId: eu.userId });
  if (!a.isActive) return fail("bloklangan admin", { adminId: a.id, login: a.login });

  recordSuccess(key);
  await control.superAdmin.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
  await logEvent(a.id, "ADMIN_LOGIN", null, { via: "eco", phone: maskPhone(phone) });
  return { ok: true, admin: { id: a.id, login: a.login, fullName: a.fullName, sessionVersion: a.sessionVersion } };
}

type LinkInput = { phone: string; ecoPassword: string; currentPassword: unknown };

/**
 * ECO hisobini O'Z superadmin hisobiga ulash. `adminId` — faqat `requireAdmin()` dan (forma maydonidan emas):
 * boshqa admin uchun ulab bo'lmaydi. Avval joriy panel paroli (reauth), keyin ECO paroli tekshiriladi.
 */
export async function linkOwnEco(adminId: string, input: LinkInput, ip: string): Promise<{ error?: string; phone?: string }> {
  if (!adminEcoEnabled()) return { error: "ECO sozlanmagan (control.env: ECO_API_URL, ECO_API_KEY)" };
  const me = await control.superAdmin.findUnique({ where: { id: adminId } });
  if (!me || !me.isActive) return { error: "Hisob topilmadi" };
  const reauth = await verifyReauth({ login: me.login, hash: me.passwordHash, password: input.currentPassword, ip });
  if (reauth) return { error: reauth === "Parol noto'g'ri" ? "Joriy panel paroli noto'g'ri" : reauth };

  const phone = normalizePhone(input.phone);
  if (!phone) return { error: "Telefon raqami noto'g'ri: +998 XX XXX XX XX" };
  if (!input.ecoPassword) return { error: "ECO ilovasi parolini kiriting" };
  // ECO parolini taxmin qilish uchun ham shu forma ishlatilmasin — kirish bilan umumiy qulf
  const key = `admin-eco:${phone}`;
  const guard = checkLogin(key, ip);
  if (!guard.ok) return { error: lockedMessage(guard.retryAfterSec) };

  let eu: { userId: string; phone: string };
  try {
    if (input.ecoPassword.length > 200) throw new EcoError("BAD", "uzun parol", 401);
    eu = await eco.verifyCredentials(phone, input.ecoPassword);
  } catch (e) {
    if (isBadCredentials(e)) {
      recordFailure(key, ip);
      await failDelay();
      return { error: "ECO telefoni yoki paroli noto'g'ri" };
    }
    if (isRateLimited(e)) return { error: ECO_RATE_LIMITED };
    console.error("[admin-eco-link]", ecoErrLog(e));
    return { error: ECO_UNAVAILABLE.replace(" — login va parol bilan kiring", ", birozdan keyin urinib ko'ring") };
  }
  recordSuccess(key);

  const owner = await control.superAdmin.findUnique({ where: { ecoUserId: eu.userId }, select: { id: true } });
  if (owner && owner.id !== me.id) {
    await logEvent(me.id, "ADMIN_ECO_LINK_DENIED", null, { phone: maskPhone(phone), reason: "boshqa adminga ulangan" });
    return { error: "Bu ECO hisobi boshqa administratorga ulangan" };
  }
  const masked = maskPhone(eu.phone || phone);
  try {
    await control.superAdmin.update({ where: { id: me.id }, data: { ecoUserId: eu.userId, ecoPhone: masked } });
  } catch (e) {
    if (String(e).includes("Unique")) return { error: "Bu ECO hisobi boshqa administratorga ulangan" };
    throw e;
  }
  await logEvent(me.id, "ADMIN_ECO_LINK", null, { phone: masked, previous: me.ecoPhone ?? null });
  return { phone: masked };
}

/** O'z hisobidan ECO'ni uzish (joriy panel paroli bilan). */
export async function unlinkOwnEco(adminId: string, currentPassword: unknown, ip: string): Promise<{ error?: string }> {
  const me = await control.superAdmin.findUnique({ where: { id: adminId } });
  if (!me || !me.isActive) return { error: "Hisob topilmadi" };
  if (!me.ecoUserId) return { error: "ECO hisobi ulanmagan" };
  const reauth = await verifyReauth({ login: me.login, hash: me.passwordHash, password: currentPassword, ip });
  if (reauth) return { error: reauth === "Parol noto'g'ri" ? "Joriy panel paroli noto'g'ri" : reauth };
  await control.superAdmin.update({ where: { id: me.id }, data: { ecoUserId: null, ecoPhone: null } });
  await logEvent(me.id, "ADMIN_ECO_UNLINK", null, { phone: me.ecoPhone });
  return {};
}
