"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";
import { looksLikePhone, loginWithAppPhone } from "@/lib/eco/app-login";
import { checkLogin, clientIp, failDelay, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";
import { confirmLoginCode, requestLoginCode, type LoginVia } from "@/lib/sms-login";
import { isTestMode } from "@/lib/test-mode";
import { companySuspension, SUSPENDED_MESSAGE } from "@/lib/tenant";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
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
    redirect("/dashboard");
  }

  const s = await login(loginName, password);
  if (!s) {
    recordFailure(loginName, ip);
    await failDelay();
    return { error: "Login yoki parol noto'g'ri" };
  }
  recordSuccess(loginName);
  redirect("/dashboard");
}

/* ─────────────── SMS (bir martalik kod) bilan kirish ─────────────── */

export type CodeRequestState = { error?: string; sent?: boolean; via?: LoginVia; devCode?: string } | undefined;

/** 1-qadam: telefon → kirish kodi (Telegram bot / Gateway / SMS). */
export async function requestLoginCodeAction(_prev: CodeRequestState, fd: FormData): Promise<CodeRequestState> {
  const phone = String(fd.get("phone") ?? "");
  if (!phone.trim()) return { error: "Telefon raqamini kiriting" };
  if (await companySuspension()) return { error: SUSPENDED_MESSAGE };
  const r = await requestLoginCode(phone);
  if (!r.ok) return { error: r.error };
  return { sent: true, via: r.via, devCode: r.devCode };
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
  redirect("/dashboard");
}

/* ─────────────── Test rejimida tez kirish (FAQAT test/dev) ─────────────── */

/** `test.*` xodim sifatida bir bosishda kirish. Production'da hech qachon ishlamaydi. */
export async function quickLoginAction(loginName: string) {
  if (!isTestMode()) return; // prod'da bu yo'l yo'q
  if (!loginName.startsWith("test.")) return;
  const password = process.env.TEST_USER_PASSWORD || "Test2026";
  const s = await login(loginName, password);
  if (!s) return;
  redirect("/dashboard");
}
