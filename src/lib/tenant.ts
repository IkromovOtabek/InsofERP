import { cache } from "react";
import type { Prisma, Role } from "@/generated/prisma";
import { db } from "./db";
import { setModulesOff } from "./platform-modules";

/**
 * Ko'p korxonali platforma — korxona (tenant) jarayoni tomonidagi yordamchilar.
 *
 * Har korxona shu kodning alohida jarayonida o'z bazasi bilan ishlaydi (`TENANT_SLUG`, `DATABASE_URL`).
 * Markaziy panel (`INSOF_MODE=control`) bilan aloqa — `CONTROL_SECRET` bilan imzolangan qisqa JWT:
 * SSO kirish (`/api/control/sso`), statistika (`/api/control/stats`), to'xtatish/yoqish (`/api/control/status`).
 */

/** Markaziy panel rejimi — korxona sahifalari yopiq, faqat /superadmin. */
export const isControlMode = () => process.env.INSOF_MODE === "control";

/** Shu jarayon qaysi korxona. Bitta korxonali eski o'rnatishda — "insof". */
export const tenantSlug = () => (process.env.TENANT_SLUG || "insof").trim();

/**
 * IT superadmin korxona ichida direktor huquqi bilan ishlaydi: barcha `role === "DIRECTOR"` tekshiruvlari
 * o'zgarishsiz qoladi. Haqiqiy rol `Session.superadmin` belgisida.
 */
export function effectiveRole(role: Role): Role {
  return role === "SUPERADMIN" ? "DIRECTOR" : role;
}

export type Suspension = { at: Date; reason: string | null } | null;

/**
 * Markaziy panel boshqaradigan qism (to'xtatish, CompanySettings.platform) — bitta so'rovda bazaga bir marta boriladi:
 * sessiya, banner, modullar va foydalanuvchi limiti shundan o'qiydi.
 */
const companyPlatform = cache(async () =>
  db.companySettings.findUnique({ where: { id: "main" }, select: { suspendedAt: true, suspendReason: true, platform: true } }));

type PlatformJson = { billing?: { paidUntil?: unknown; suspendOn?: unknown } | null; modulesOff?: unknown; userLimit?: unknown };
const platformJson = (v: Prisma.JsonValue | null | undefined): PlatformJson =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as PlatformJson) : {};

/** Korxona to'xtatilganmi (superadmin markaziy paneldan to'xtatgan). Bitta so'rovda bir marta o'qiladi. */
export const companySuspension = cache(async (): Promise<Suspension> => {
  const c = await companyPlatform();
  return c?.suspendedAt ? { at: c.suspendedAt, reason: c.suspendReason } : null;
});

/**
 * Platforma tarifida o'chirilgan modullarni jarayon holatiga yuklash (lib/platform-modules.ts). Har sessiya o'qilganda
 * (veb `getSession`, mobil `requireMobileUser`) chaqiriladi — panel o'zgartirsa keyingi so'rovdanoq amal qiladi.
 */
export async function loadPlatformGate(): Promise<void> {
  const p = platformJson((await companyPlatform())?.platform);
  setModulesOff(Array.isArray(p.modulesOff) ? p.modulesOff.filter((x): x is string => typeof x === "string") : []);
}

/** Faol foydalanuvchilar chegarasi (panel belgilaydi). null — cheklovsiz. IT (SUPERADMIN) va o'chiq tizim hisoblari sanalmaydi. */
export async function platformUserLimit(): Promise<number | null> {
  const v = platformJson((await companyPlatform())?.platform).userLimit;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

type Counter = { user: { count: (a: { where: Prisma.UserWhereInput }) => Promise<number> } };

/**
 * Yangi faol foydalanuvchi qo'shish yoki o'chiq hisobni yoqishdan oldin: limit to'lgan bo'lsa — o'zbekcha xato matni.
 * `tx` — tranzaksiya ichida chaqirilsa shu orqali sanaladi.
 */
export async function userLimitError(tx: Counter = db): Promise<string | null> {
  const limit = await platformUserLimit();
  if (limit === null) return null;
  const active = await tx.user.count({ where: { isActive: true, role: { not: "SUPERADMIN" } } });
  return active >= limit
    ? `Faol foydalanuvchilar chegarasi to'lgan (${active}/${limit}). Keraksiz hisobni yoping yoki tarifni kengaytirish uchun Insof administratoriga murojaat qiling`
    : null;
}

export const SUSPENDED_MESSAGE = "Korxona hisobi vaqtincha to'xtatilgan — platforma administratoriga murojaat qiling";

/**
 * Markaziy panel yozgan obuna holati (CompanySettings.platform.billing; lib/control/billing.ts → syncTenantPlatform).
 * Bosqich shu yerda bugungi sana bo'yicha hisoblanadi — panel kunlik yozuvi kechiksa ham banner to'g'ri.
 * Faqat ogohlantirish kerak bo'lganda qiymat qaytadi: tugashiga ≤ 3 kun qolgan yoki muddat o'tgan (imtiyozda).
 */
export type BillingNotice = { paidUntil: string; suspendOn: string; daysLeft: number };

export const billingNotice = cache(async (): Promise<BillingNotice | null> => {
  const b = platformJson((await companyPlatform())?.platform).billing;
  if (!b || typeof b.paidUntil !== "string" || typeof b.suspendOn !== "string") return null;
  const day = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (Number.isNaN(day(b.paidUntil)) || Number.isNaN(day(b.suspendOn))) return null;
  const daysLeft = Math.round((day(b.paidUntil) - day(today)) / 86_400_000);
  return daysLeft <= 3 ? { paidUntil: b.paidUntil, suspendOn: b.suspendOn, daysLeft } : null;
});
