"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { requireAdmin, revokeAdminSessions } from "@/lib/control/auth";
import { control } from "@/lib/control/db";
import { logEvent } from "@/lib/control/events";
import { verifyAdminReauth, verifyReauth } from "@/lib/control/reauth";
import {
  groupSecret, hashRecovery, matchStep, newRecoveryCodes, newTotpSecret, otpauthUrl, sealSecret, unsealSecret,
} from "@/lib/control/totp";
import { clientIp } from "@/lib/login-guard";

/**
 * «Mening hisobim» → xavfsizlik: 2FA (TOTP) yoqish/o'chirish, zaxira kodlar, o'z sessiyalari.
 * Kim — faqat sessiyadan (requireAdmin): boshqa admin uchun bu yerdan hech narsa o'zgartirib bo'lmaydi.
 */

export type TotpSetup = { error?: string; qr?: string; secret?: string };

/** 1-qadam: yangi sir (hali yoqilmagan, totpEnabledAt=null) va QR. Qayta bosilsa — yangi sir, eskisi bekor. */
export async function startTotpSetupAction(): Promise<TotpSetup> {
  const a = await requireAdmin();
  if (a.totp) return { error: "2FA allaqachon yoqilgan" };
  const secret = newTotpSecret();
  await control.superAdmin.update({ where: { id: a.id }, data: { totpSecret: sealSecret(secret), totpEnabledAt: null, totpLastStep: null } });
  const qr = await QRCode.toDataURL(otpauthUrl(secret, a.login), { margin: 1, width: 220, errorCorrectionLevel: "M" });
  return { qr, secret: groupSecret(secret) };
}

/** 2-qadam: ilovadagi birinchi kod + joriy parol → yoqiladi, 10 ta zaxira kod BIR MARTA ko'rsatiladi, boshqa sessiyalar yopiladi. */
export async function confirmTotpSetupAction(password: string, code: string): Promise<{ error?: string; codes?: string[] }> {
  const a = await requireAdmin();
  if (a.totp) return { error: "2FA allaqachon yoqilgan" };
  const ip = await clientIp();
  const row = await control.superAdmin.findUniqueOrThrow({ where: { id: a.id } });
  const bad = await verifyReauth({ adminId: a.id, hash: row.isActive ? row.passwordHash : null, password, ip });
  if (bad) return { error: bad === "Parol noto'g'ri" ? "Joriy parol noto'g'ri" : bad };
  const secret = unsealSecret(row.totpSecret);
  if (!secret) return { error: "Sozlash muddati o'tdi — «2FA ni yoqish» ni qaytadan bosing" };
  const step = matchStep(secret, String(code ?? "").replace(/\s/g, ""));
  if (step === null) return { error: "Kod mos kelmadi. Telefon soati to'g'riligini tekshiring va yangi kodni kiriting" };
  const codes = newRecoveryCodes();
  const r = await control.superAdmin.updateMany({
    where: { id: a.id, totpEnabledAt: null, totpSecret: row.totpSecret },
    data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: codes.map(hashRecovery) },
  });
  if (r.count !== 1) return { error: "Sozlash boshqa oynada o'zgardi — qaytadan boshlang" };
  await revokeAdminSessions(a.id, { except: a.sid });
  await logEvent(a.id, "ADMIN_2FA_ON", null);
  revalidatePath("/superadmin", "layout");
  return { codes };
}

export async function disableTotpAction(password: string, code: string): Promise<{ error?: string }> {
  const a = await requireAdmin();
  if (!a.totp) return { error: "2FA yoqilmagan" };
  const bad = await verifyAdminReauth({ adminId: a.id, password, code, ip: await clientIp() });
  if (bad) return { error: bad };
  await control.superAdmin.update({ where: { id: a.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
  await logEvent(a.id, "ADMIN_2FA_OFF", null);
  revalidatePath("/superadmin", "layout");
  return {};
}

/** Yangi 10 ta zaxira kod (eskilari bekor). */
export async function regenRecoveryCodesAction(password: string, code: string): Promise<{ error?: string; codes?: string[] }> {
  const a = await requireAdmin();
  if (!a.totp) return { error: "2FA yoqilmagan" };
  const bad = await verifyAdminReauth({ adminId: a.id, password, code, ip: await clientIp() });
  if (bad) return { error: bad };
  const codes = newRecoveryCodes();
  await control.superAdmin.update({ where: { id: a.id }, data: { recoveryCodes: codes.map(hashRecovery) } });
  await logEvent(a.id, "ADMIN_2FA_CODES", null);
  revalidatePath("/superadmin/adminlar");
  return { codes };
}

const SID = /^[a-z0-9]{10,40}$/i;

/** O'z sessiyalaridan birini yopish (joriysini emas — u uchun «Chiqish»). */
export async function revokeOwnSessionAction(id: string): Promise<{ error?: string }> {
  const a = await requireAdmin();
  if (typeof id !== "string" || !SID.test(id)) return { error: "Sessiya topilmadi" };
  if (id === a.sid) return { error: "Joriy sessiya — undan «Chiqish» tugmasi bilan chiqing" };
  const s = await control.adminSession.findFirst({ where: { id, adminId: a.id }, select: { ip: true, via: true } });
  if (!s) return { error: "Sessiya topilmadi" };
  await revokeAdminSessions(a.id, { only: id });
  await logEvent(a.id, "ADMIN_SESSIONS_REVOKE", null, { ip: s.ip, via: s.via });
  revalidatePath("/superadmin/adminlar");
  return {};
}

export async function revokeOtherOwnSessionsAction(): Promise<{ error?: string }> {
  const a = await requireAdmin();
  await revokeAdminSessions(a.id, { except: a.sid });
  await logEvent(a.id, "ADMIN_SESSIONS_REVOKE", null, { others: true });
  revalidatePath("/superadmin/adminlar");
  return {};
}
