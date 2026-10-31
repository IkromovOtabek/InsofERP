"use server";

import { redirect } from "next/navigation";
import {
  adminLogout, checkAdminPassword, clearPendingTwoFactor, getPendingTwoFactor, issueAdminSession, issuePendingTwoFactor,
} from "@/lib/control/auth";
import { control } from "@/lib/control/db";
import { ecoAdminLogin } from "@/lib/control/eco-login";
import { logEvent } from "@/lib/control/events";
import { consumeSecondFactor } from "@/lib/control/totp";
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
  const a = await checkAdminPassword(login, password);
  if (!a) {
    recordFailure(key, ip);
    await failDelay();
    return { error: "Login yoki parol noto'g'ri" };
  }
  recordSuccess(key);
  if (a.totpEnabledAt) {
    await issuePendingTwoFactor(a, "password");
    redirect("/superadmin/login");
  }
  await control.superAdmin.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
  await issueAdminSession(a, "password");
  await logEvent(a.id, "ADMIN_LOGIN", null, { via: "password" });
  redirect("/superadmin");
}

/** Insof ECO ilovasi orqali: telefon + ilova paroli (tekshiruv va qulf — eco-login.ts). */
export async function adminEcoLoginAction(_prev: { error?: string } | undefined, fd: FormData) {
  if (process.env.INSOF_MODE !== "control") return { error: "Panel bu serverda yoqilmagan" };
  const r = await ecoAdminLogin(String(fd.get("phone") ?? "").trim(), String(fd.get("password") ?? ""), await clientIp());
  if (!r.ok) return { error: r.error };
  if (r.twoFactor) {
    await issuePendingTwoFactor(r.admin, "eco");
    redirect("/superadmin/login");
  }
  await issueAdminSession(r.admin, "eco");
  redirect("/superadmin");
}

/**
 * 2-bosqich: ilovadagi 6 raqamli kod yoki zaxira kod. Birinchi bosqich (parol / ECO) 5 daqiqalik cookie'da.
 * Qulf: `admin-2fa:<id>` — 5 xato → 15 daqiqa (parolni bilgan hujumchi kodni tanlab topa olmasin).
 */
export async function verifyTwoFactorAction(_prev: { error?: string } | undefined, fd: FormData) {
  if (process.env.INSOF_MODE !== "control") return { error: "Panel bu serverda yoqilmagan" };
  const p = await getPendingTwoFactor();
  if (!p) return { error: "Kirish muddati o'tdi — login va parolni qaytadan kiriting", expired: true };
  const ip = await clientIp();
  const key = `admin-2fa:${p.id}`;
  const guard = checkLogin(key, ip);
  if (!guard.ok) return { error: lockedMessage(guard.retryAfterSec) };
  const a = await control.superAdmin.findUnique({ where: { id: p.id } });
  if (!a || !a.isActive || a.sessionVersion !== p.sv) {
    await clearPendingTwoFactor();
    return { error: "Kirish muddati o'tdi — login va parolni qaytadan kiriting", expired: true };
  }
  const factor = await consumeSecondFactor(a, String(fd.get("code") ?? ""));
  if (!factor) {
    recordFailure(key, ip);
    await logEvent(a.id, "ADMIN_2FA_FAIL", null, { via: p.via }).catch(() => {});
    await failDelay();
    return { error: "Kod noto'g'ri yoki eskirgan" };
  }
  recordSuccess(key);
  await clearPendingTwoFactor();
  await control.superAdmin.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
  await issueAdminSession(a, p.via);
  const left = factor === "recovery" ? (await control.superAdmin.findUnique({ where: { id: a.id }, select: { recoveryCodes: true } }))?.recoveryCodes.length ?? 0 : null;
  await logEvent(a.id, "ADMIN_LOGIN", null, { via: p.via, factor, ...(left !== null ? { recoveryLeft: left } : {}) });
  redirect(factor === "recovery" ? "/superadmin/adminlar?zaxira=1" : "/superadmin");
}

export async function cancelTwoFactorAction() {
  await clearPendingTwoFactor();
  redirect("/superadmin/login");
}

export async function adminLogoutAction() {
  await adminLogout();
  redirect("/superadmin/login");
}
