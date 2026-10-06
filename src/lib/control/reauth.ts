import bcrypt from "bcryptjs";
import { checkLogin, failDelay, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";

/**
 * Xavfli amal oldidan superadmin parolini qayta tekshirish (monitor-actions.ts → enqueueAction, REAUTH_ACTIONS).
 * Urinishlar hisobi login bilan UMUMIY (`admin:<login>` kaliti, login-guard): 5 ta xato → 15 daqiqa qulf, IP bo'yicha 30.
 * Parol hech qayerga yozilmaydi (na AgentAction.params, na jurnal, na log) — faqat bcrypt.compare ga beriladi.
 * Qaytaradi: xato matni yoki null (to'g'ri).
 */
export async function verifyReauth(o: { login: string; hash: string | null | undefined; password: unknown; ip: string }): Promise<string | null> {
  const key = `admin:${o.login}`;
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
