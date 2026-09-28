"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";
import { looksLikePhone, loginWithAppPhone } from "@/lib/eco/app-login";
import { checkLogin, clientIp, failDelay, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const loginName = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!loginName || !password) return { error: "Login va parolni kiriting" };

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
