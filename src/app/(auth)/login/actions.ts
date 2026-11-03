"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, issueSession, login, logout } from "@/lib/auth";
import { completeTempPassword, signTempChange, TEMP_EXPIRED } from "@/lib/temp-password";
import { TOUR_COOKIE } from "@/lib/tour";
import { ARENDA_DENIED, ARENDA_PATH, isArendaHost } from "@/lib/arenda-host";
import { OWN_PAGE_ONLY, moduleForPath, pathAllowed } from "@/lib/nav";
import { pathOff } from "@/lib/platform-modules";
import { looksLikePhone, loginWithAppPhone } from "@/lib/eco/app-login";
import { checkLogin, clientIp, failDelay, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";
import { confirmLoginCode, requestLoginCode } from "@/lib/code-login";
import { hit } from "@/lib/rate-limit";
import { isTestMode } from "@/lib/test-mode";

/** Kod so'rash: bitta IP'dan soatiga (raqamdan qat'i nazar). */
const CODE_REQ_PER_IP_HOUR = 10;
const CODE_REQ_LIMITED = "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring yoki Otdel kadrga murojaat qiling.";
import { companySuspension, SUSPENDED_MESSAGE } from "@/lib/tenant";

/**
 * Kirgandan keyingi sahifa. Arenda domenida (lib/arenda-host.ts) — /arenda; u yerga ruxsati yo'q hisob kiritilmaydi:
 * yangi sessiya darhol yopiladi va forma sababini ko'rsatadi (aks holda arenda domenida ERP sahifasi ochilardi).
 */
async function homeAfterLogin(): Promise<{ to: string } | { error: string }> {
  if (!isArendaHost(await headers())) return { to: "/dashboard" };
  const s = await getSession();
  const own = s ? OWN_PAGE_ONLY[s.role] : undefined;
  if (s && (!own || own === ARENDA_PATH) && !pathOff(ARENDA_PATH, moduleForPath(ARENDA_PATH)) && pathAllowed(ARENDA_PATH, s.role, s.perms)) {
    return { to: ARENDA_PATH };
  }
  await logout();
  return { error: ARENDA_DENIED };
}

/** `tempToken` — parol to'g'ri, lekin vaqtinchalik: forma 2-qadamni (yangi parol) ko'rsatadi. */
export type LoginState = { error?: string; tempToken?: string } | undefined;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const loginName = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!loginName || !password) return { error: "Login va parolni kiriting" };
  // Platforma korxonani to'xtatgan — hech kim kira olmaydi (sabab aniq ko'rsatiladi)
  if (await companySuspension()) return { error: SUSPENDED_MESSAGE };

  // Qo'pol kuch himoyasi: qulflangan login/IP parol tekshiruvigacha ham yetmaydi
  // Telefon har xil yozilishi mumkin (+998…, 90…) — qulf bitta raqamga tushsin
  const phone = looksLikePhone(loginName);
  const key = phone ?? loginName;
  const ip = await clientIp();
  const guard = checkLogin(key, ip);
  if (!guard.ok) return { error: lockedMessage(guard.retryAfterSec) };

  // Telefon yozilgan bo'lsa — Insof ECO ilovasi hisobi: parolni ECO tekshiradi, ERP ruxsatini direktor beradi
  if (phone) {
    const r = await loginWithAppPhone(phone, password);
    if (!r.ok) {
      if (r.reason === "bad_credentials") { recordFailure(key, ip); await failDelay(); }
      return { error: r.message };
    }
    recordSuccess(key);
    const home = await homeAfterLogin();
    if ("error" in home) return home;
    redirect(home.to);
  }

  const s = await login(loginName, password);
  if (!s) {
    recordFailure(loginName, ip);
    await failDelay();
    return { error: "Login yoki parol noto'g'ri" };
  }
  recordSuccess(loginName);
  // Vaqtinchalik parol (dispetcher bergan): sessiya yo'q — avval xodim o'z parolini o'rnatadi
  if ("temp" in s) return s.temp.expired ? { error: TEMP_EXPIRED } : { tempToken: await signTempChange(s.temp) };
  const home = await homeAfterLogin();
  if ("error" in home) return home;
  redirect(home.to);
}

/** Vaqtinchalik parol bilan kirishning 2-qadami: o'z paroli → sessiya. Token 1-qadamda berilgan (`lib/temp-password.ts`). */
export async function setTempPasswordAction(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { error: "Parollar mos emas", tempToken: token };
  if (await companySuspension()) return { error: SUSPENDED_MESSAGE };
  const r = await completeTempPassword(token, password);
  if (!r.ok) return r.restart ? { error: r.error } : { error: r.error, tempToken: token };
  await issueSession(r.user);
  (await cookies()).delete(TOUR_COOKIE);
  const home = await homeAfterLogin();
  if ("error" in home) return home;
  redirect(home.to);
}

/* ─────────────── Telegram (bir martalik kod) bilan kirish ─────────────── */

export type CodeRequestState = { error?: string; sent?: boolean; devCode?: string } | undefined;

/** 1-qadam: telefon → kirish kodi (faqat Telegram: bot yoki Gateway). */
export async function requestLoginCodeAction(_prev: CodeRequestState, fd: FormData): Promise<CodeRequestState> {
  const phone = String(fd.get("phone") ?? "");
  if (!phone.trim()) return { error: "Telefon raqamini kiriting" };
  if (await companySuspension()) return { error: SUSPENDED_MESSAGE };
  // IP bo'yicha chek — har qanday raqam uchun bir xil (raqamlarni ommaviy sinab chiqish sekinlashadi)
  if (!hit(`login-code:ip:${await clientIp()}`, CODE_REQ_PER_IP_HOUR, 3600_000)) return { error: CODE_REQ_LIMITED };
  const r = await requestLoginCode(phone);
  if (!r.ok) return { error: r.error };
  // Javob mavjud va noma'lum raqam uchun AYNAN bir xil: `via` (kanal) qaytarilmaydi — u faqat
  // mavjud raqamda bo'lardi va raqam tizimda borligini oshkor qilardi. devCode faqat dev/test'da.
  return { sent: true, ...(r.devCode ? { devCode: r.devCode } : {}) };
}

/** 2-qadam: kod → sessiya. Qo'pol kuch himoyasi raqam bo'yicha. */
export async function confirmLoginCodeAction(_prev: { error?: string } | undefined, fd: FormData): Promise<{ error?: string } | undefined> {
  const phone = String(fd.get("phone") ?? "");
  const code = String(fd.get("code") ?? "");
  if (!code.trim()) return { error: "Kodni kiriting" };
  if (await companySuspension()) return { error: SUSPENDED_MESSAGE };

  const key = looksLikePhone(phone) ?? phone;
  const ip = await clientIp();
  const guard = checkLogin(key, ip);
  if (!guard.ok) return { error: lockedMessage(guard.retryAfterSec) };

  const r = await confirmLoginCode(phone, code);
  if (!r.ok) {
    recordFailure(key, ip);
    await failDelay();
    return { error: r.error };
  }
  recordSuccess(key);
  const home = await homeAfterLogin();
  if ("error" in home) return home;
  redirect(home.to);
}

/* ─────────────── Test rejimida tez kirish (FAQAT test/dev) ─────────────── */

/** `test.*` xodim sifatida bir bosishda kirish. Production'da hech qachon ishlamaydi. */
export async function quickLoginAction(loginName: string) {
  if (!isTestMode()) return; // prod'da bu yo'l yo'q
  if (!loginName.startsWith("test.")) return;
  const password = process.env.TEST_USER_PASSWORD || "Test2026";
  const s = await login(loginName, password);
  if (!s || "temp" in s) return;
  const home = await homeAfterLogin();
  if ("to" in home) redirect(home.to);
}
