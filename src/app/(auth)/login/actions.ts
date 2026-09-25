"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";
import { checkLogin, clientIp, failDelay, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const loginName = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!loginName || !password) return { error: "Login va parolni kiriting" };

  // Qo'pol kuch himoyasi: qulflangan login/IP parol tekshiruvigacha ham yetmaydi
  const ip = await clientIp();
  const guard = checkLogin(loginName, ip);
  if (!guard.ok) return { error: lockedMessage(guard.retryAfterSec) };

  const s = await login(loginName, password);
  if (!s) {
    recordFailure(loginName, ip);
    await failDelay();
    return { error: "Login yoki parol noto'g'ri" };
  }
  recordSuccess(loginName);
  redirect("/dashboard");
}
