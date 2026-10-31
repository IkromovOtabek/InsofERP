import bcrypt from "bcryptjs";
import { checkLogin, failDelay, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";
import { control } from "./db";
import { consumeSecondFactor } from "./totp";

/**
 * Xavfli amal oldidan superadmin parolini qayta tekshirish (monitor-actions.ts → enqueueAction, REAUTH_ACTIONS).
 * Urinishlar hisobi login'dan ALOHIDA: `reauth:<adminId>` kaliti (login-guard) — 5 ta xato → 15 daqiqa qulf, IP bo'yicha 30
 * (IP hisobi umumiy). Login kaliti (`admin:<login>`) bilan umumiy bo'lsa, tashqaridagi hujumchi login'ni 5 marta xato terib
 * ishlayotgan adminning xavfli amallarini (qayta parol) bloklab qo'yardi va aksincha — shuning uchun ajratilgan.
 * Parol hech qayerga yozilmaydi (na AgentAction.params, na jurnal, na log) — faqat bcrypt.compare ga beriladi.
 * Qaytaradi: xato matni yoki null (to'g'ri).
 */
export async function verifyReauth(o: { adminId: string; hash: string | null | undefined; password: unknown; ip: string }): Promise<string | null> {
  const key = reauthKey(o.adminId);
  const guard = checkLogin(key, o.ip);
  if (!guard.ok) return lockedMessage(guard.retryAfterSec);
  const pw = typeof o.password === "string" ? o.password : "";
  if (!pw) return "Joriy parolingizni kiriting";
  if (pw.length > 200 || !o.hash || !(await bcrypt.compare(pw, o.hash))) {
    recordFailure(key, o.ip);
    await failDelay();
    return "Parol noto'g'ri";
  }
  recordSuccess(key);
  return null;
}

/** Qayta parol qulfi kaliti — login qulfidan (`admin:<login>`) alohida. */
export const reauthKey = (adminId: string) => `reauth:${adminId}`;

/**
 * Xavfli amal / hisob sozlamasi oldidan to'liq qayta tasdiq: joriy parol va (2FA yoqilgan bo'lsa) ilovadagi kod yoki
 * zaxira kod. Admin qatori shu yerda o'qiladi — chaqiruvchi faqat `requireAdmin()` dan olingan id beradi.
 * Kod xatolari ham parol bilan bitta qulf hisobida (`reauth:<adminId>`).
 */
export async function verifyAdminReauth(o: { adminId: string; password: unknown; code?: unknown; ip: string }): Promise<string | null> {
  const row = await control.superAdmin.findUnique({
    where: { id: o.adminId }, select: { id: true, isActive: true, passwordHash: true, totpSecret: true, totpEnabledAt: true, totpLastStep: true },
  });
  const bad = await verifyReauth({ adminId: o.adminId, hash: row?.isActive ? row.passwordHash : null, password: o.password, ip: o.ip });
  if (bad || !row?.totpEnabledAt) return bad;
  const key = reauthKey(o.adminId);
  if (typeof o.code !== "string" || !o.code.trim()) return "Ilovadagi 6 raqamli kodni kiriting";
  if (!(await consumeSecondFactor(row, o.code))) {
    recordFailure(key, o.ip);
    await failDelay();
    return "Kod noto'g'ri yoki eskirgan";
  }
  return null;
}
