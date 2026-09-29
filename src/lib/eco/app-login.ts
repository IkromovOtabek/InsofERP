import { randomBytes } from "crypto";
import type { Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, issueSession, revokeSessions, type Session } from "@/lib/auth";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { TOUR_COOKIE } from "@/lib/tour";
import { cookies } from "next/headers";
import { eco, ecoEnabled, EcoError, normalizePhone } from "./client";

/**
 * Insof ECO ilovasida ro'yxatdan o'tgan foydalanuvchining ERP'ga kirishi.
 *
 * Parol bitta — ilovadagi. ERP login sahifasiga telefon yozilsa, parolni ECO tekshiradi
 * (`POST /v1/erp/auth/verify`), ERP esa faqat "bu odamga ruxsat berilganmi" ni hal qiladi:
 * `User.ecoUserId` bo'yicha faol hisob bo'lsa — kiradi, bo'lmasa direktor tasdig'ini kutadi.
 *
 * Ruxsatni direktor "Ilova foydalanuvchilari" sahifasida rol tanlab beradi (`grantAppAccess`).
 * Ilova hisobi ochiq ro'yxatdan o'tish bilan yaratiladi — tasdiqsiz ERP ma'lumoti ko'rinmaydi.
 */

/**
 * Direktor bera oladigan rollar. Direktor roli ilova orqali berilmaydi; eski (qo'shilib ketgan) rollar ham.
 * Haydovchi/brigadir ham yo'q: ularning sahifasi xodim kartasiga bog'langan — ular Otdel kadr orqali.
 */
export const APP_GRANTABLE_ROLES: Role[] = ["SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "HR", "CASHIER"];

/** Login maydoniga telefon yozilganmi (harfsiz, 9+ raqam). Harfli bo'lsa — oddiy ERP login. */
export function looksLikePhone(input: string): string | null {
  if (/[a-z]/i.test(input)) return null;
  return normalizePhone(input);
}

export type AppLoginResult =
  | { ok: true; session: Session }
  | { ok: false; reason: "bad_credentials" | "pending" | "closed" | "unavailable"; message: string };

export async function loginWithAppPhone(phone: string, password: string): Promise<AppLoginResult> {
  if (!ecoEnabled()) return { ok: false, reason: "unavailable", message: "Telefon bilan kirish hozir ishlamaydi — login va parolingiz bilan kiring" };
  let eu: { userId: string; phone: string; fullName: string | null };
  try {
    eu = await eco.verifyCredentials(phone, password);
  } catch (e) {
    if (e instanceof EcoError && e.status === 401) return { ok: false, reason: "bad_credentials", message: "Telefon yoki parol noto'g'ri" };
    console.error("[app-login]", e);
    return { ok: false, reason: "unavailable", message: "Ilova serveriga ulanib bo'lmadi, birozdan keyin urinib ko'ring" };
  }

  // Parol to'g'ri — endi ERP ruxsati. Bu xabarlar parol tekshirilgandan KEYIN chiqadi, raqam haqida hech narsa oshkor bo'lmaydi.
  const user = await db.user.findUnique({ where: { ecoUserId: eu.userId } });
  if (!user) {
    await askDirector(eu);
    return { ok: false, reason: "pending", message: "Parol to'g'ri, lekin ERP'ga kirish uchun direktor ruxsati kerak. So'rovingiz direktorga yuborildi." };
  }
  if (!user.isActive) return { ok: false, reason: "closed", message: "ERP'ga kirish ruxsatingiz yopilgan — direktorga murojaat qiling" };

  const session = await issueSession(user);
  (await cookies()).delete(TOUR_COOKIE);
  return { ok: true, session };
}

/** Ruxsatsiz odam kirmoqchi bo'ldi — direktorga xabar (bir kunda bir marta, har urinishda emas). */
async function askDirector(eu: { userId: string; phone: string; fullName: string | null }) {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const already = await db.notification.findFirst({ where: { type: "APP_USER_ERP_REQUEST", createdAt: { gte: dayAgo }, body: { contains: eu.phone } }, select: { id: true } });
  if (already) return;
  notifyAfter(() => notifyRoles(["DIRECTOR"], {
    type: "APP_USER_ERP_REQUEST",
    title: "ERP'ga kirish so'rovi",
    body: `${eu.fullName ?? "Ilova foydalanuvchisi"} (${eu.phone}) ERP'ga kirmoqchi. Ruxsat: Ilova foydalanuvchilari sahifasi.`,
    channel: "oddiy",
  }));
}

/**
 * Direktor ruxsat beradi (yoki rolni almashtiradi).
 * Odam allaqachon xodim bo'lsa (ECO id xodim kartasida, kartada ERP logini bor) — yangi hisob ochilmaydi,
 * o'sha loginga telefon bilan kirish qo'shiladi.
 */
export async function grantAppAccess(byUserId: string, ecoUserId: string, phone: string, role: Role): Promise<{ error?: string }> {
  if (!APP_GRANTABLE_ROLES.includes(role)) return { error: "Bu rolni ilova orqali berib bo'lmaydi" };
  // Qidiruv telefon bo'yicha (ro'yxat 500 ta bilan cheklangan), keyin id aniq mos kelishi shart
  const eu = (await eco.appUsers(phone)).find((u) => u.userId === ecoUserId);
  if (!eu) return { error: "Ilova foydalanuvchisi topilmadi" };

  const own = await db.user.findUnique({ where: { ecoUserId } });
  const employeeUser = own ? null : (await db.employee.findFirst({ where: { ecoUserId, userId: { not: null } }, select: { user: true } }))?.user ?? null;

  if (employeeUser) {
    // Zavod xodimi: roli lavozimidan, hisobini Otdel kadr boshqaradi — bu yerdan faqat telefon bilan kirish ulanadi
    if (!employeeUser.isActive) return { error: "Xodimning ERP hisobi yopiq — Otdel kadrda oching" };
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: employeeUser.id }, data: { ecoUserId } });
      await audit(tx, byUserId, "UPDATE", "User", employeeUser.id, { ecoUserId: null }, { ecoUserId, source: "eco-app" });
    });
    return {};
  }

  if (own) {
    if (own.role === "DIRECTOR") return { error: "Direktor hisobini bu yerdan o'zgartirib bo'lmaydi" };
    const data = { role, isActive: true };
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: own.id }, data });
      if (own.role !== role) await revokeSessions(tx, own.id);
      await audit(tx, byUserId, "UPDATE", "User", own.id, { role: own.role, isActive: own.isActive }, data);
    });
    return {};
  }

  if (await db.user.findUnique({ where: { login: eu.phone }, select: { id: true } })) return { error: `"${eu.phone}" logini band — Otdel kadrda tekshiring` };
  // Tasodifiy parol: bu hisobga login/parol bilan kirib bo'lmaydi, faqat telefon + ilova paroli bilan
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  await db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { login: eu.phone, fullName: eu.fullName ?? eu.phone, role, passwordHash, ecoUserId } });
    await audit(tx, byUserId, "CREATE", "User", u.id, undefined, { login: u.login, role, ecoUserId, source: "eco-app" });
  });
  return {};
}

/**
 * Ruxsatni yopish. Ilova orqali ochilgan hisob — nofaol (tarix uchun o'chmaydi).
 * Xodim hisobi — faqat telefon bilan kirish uziladi, login/parol bilan ishlashda davom etadi.
 * Ikkala holda ham ochiq sessiyalar darhol kuyadi.
 */
export async function revokeAppAccess(byUserId: string, ecoUserId: string): Promise<{ error?: string }> {
  const u = await db.user.findUnique({ where: { ecoUserId }, include: { employee: { select: { id: true } } } });
  if (!u) return { error: "Bu foydalanuvchida ERP ruxsati yo'q" };
  if (u.role === "DIRECTOR") return { error: "Direktor hisobini bu yerdan yopib bo'lmaydi" };
  const data = u.employee ? { ecoUserId: null } : { isActive: false };
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data });
    await revokeSessions(tx, u.id);
    await audit(tx, byUserId, "STATUS_CHANGE", "User", u.id, { isActive: u.isActive, ecoUserId }, { ...data, source: "eco-app" });
  });
  return {};
}
