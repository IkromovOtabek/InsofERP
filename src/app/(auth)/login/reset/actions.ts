"use server";

import { confirmPasswordReset, requestPasswordReset, type ResetVia } from "@/lib/password-reset";
import { checkLogin, clientIp, failDelay, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";
import { passwordProblem } from "@/lib/password-policy";
import { normalizePhone } from "@/lib/sms/phone";

/** `via` — kod qayerga yuborildi (bot yoki SMS); forma shunga qarab matn yozadi. */
export type RequestState = { error?: string; sent?: boolean; via?: ResetVia; devCode?: string } | undefined;
export type ConfirmState = { error?: string; login?: string } | undefined;

/** 1-qadam: telefon → kod (Telegram bot; SMS zaxirasi RESET_SMS_FALLBACK=1 bilan). */
export async function requestCodeAction(_prev: RequestState, fd: FormData): Promise<RequestState> {
  const phone = String(fd.get("phone") ?? "");
  if (!phone.trim()) return { error: "Telefon raqamini kiriting" };
  const r = await requestPasswordReset(phone);
  if (!r.ok) return { error: r.error };
  return { sent: true, via: r.via, devCode: r.devCode };
}

/**
 * 2-qadam: kod + yangi parol.
 * Qo'pol kuch himoyasi (login-guard): normallashgan raqam va IP bo'yicha — kodni bir nechta
 * raqam/yangi kodlar bilan ketma-ket taxmin qilib bo'lmasin. Faqat KOD xatosi hisoblanadi.
 */
export async function confirmResetAction(_prev: ConfirmState, fd: FormData): Promise<ConfirmState> {
  const phone = String(fd.get("phone") ?? "");
  const code = String(fd.get("code") ?? "");
  const password = String(fd.get("password") ?? "");
  const password2 = String(fd.get("password2") ?? "");
  if (!code.trim()) return { error: "Kodni kiriting" };
  if (password !== password2) return { error: "Parollar bir xil emas" };
  // Parol talablari kodni tekshirishdan oldin — bu xato urinish sifatida hisoblanmaydi
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  const key = `reset:${normalizePhone(phone) ?? phone.trim()}`;
  const ip = await clientIp();
  const guard = checkLogin(key, ip);
  if (!guard.ok) return { error: lockedMessage(guard.retryAfterSec) };

  const r = await confirmPasswordReset(phone, code, password);
  if (!r.ok) {
    recordFailure(key, ip);
    await failDelay();
    return { error: r.error };
  }
  recordSuccess(key);
  return { login: r.login };
}
