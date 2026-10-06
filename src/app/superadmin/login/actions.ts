"use server";

import { redirect } from "next/navigation";
import { adminLogin, adminLogout, issueAdminSession } from "@/lib/control/auth";
import { ecoAdminLogin } from "@/lib/control/eco-login";
import { logEvent } from "@/lib/control/events";
import { checkLogin, clientIp, failDelay, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";

export async function adminLoginAction(_prev: { error?: string } | undefined, fd: FormData) {
  if (process.env.INSOF_MODE !== "control") return { error: "Panel bu serverda yoqilmagan" };
  const login = String(fd.get("login") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!login || !password) return { error: "Login va parolni kiriting" };
  const key = `admin:${login}`;
  const ip = await clientIp();
  const guard = checkLogin(key, ip);
  if (!guard.ok) return { error: lockedMessage(guard.retryAfterSec) };
  const a = await adminLogin(login, password);
  if (!a) {
    recordFailure(key, ip);
    await failDelay();
    return { error: "Login yoki parol noto'g'ri" };
  }
  recordSuccess(key);
  await logEvent(a.id, "ADMIN_LOGIN", null);
  redirect("/superadmin");
}

/** Insof ECO ilovasi orqali: telefon + ilova paroli (tekshiruv va qulf — eco-login.ts). */
export async function adminEcoLoginAction(_prev: { error?: string } | undefined, fd: FormData) {
  if (process.env.INSOF_MODE !== "control") return { error: "Panel bu serverda yoqilmagan" };
  const r = await ecoAdminLogin(String(fd.get("phone") ?? "").trim(), String(fd.get("password") ?? ""), await clientIp());
  if (!r.ok) return { error: r.error };
  await issueAdminSession(r.admin);
  redirect("/superadmin");
}

export async function adminLogoutAction() {
  await adminLogout();
  redirect("/superadmin/login");
}
