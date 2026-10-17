import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { eco, ecoEnabled, EcoError, normalizePhone } from "@/lib/eco/client";
import { pushEmployeeToEco } from "@/lib/eco/people";

/**
 * Haydovchi ilovasi (Insof ECO) boshqaruvi: xodimni ECO'ga ulash va ilovada o'zi ro'yxatdan
 * o'tganini tasdiqlash. Veb (`app/(app)/drivers/actions.ts`) ham, mobil ilova ham shu yerdan.
 * Ruxsat (`trips` → `drivers`) chaqiruvchida tekshiriladi.
 */

export type DriverLinkResult = { ok: true } | { error: string };

const msg = (e: unknown) => (e instanceof EcoError ? e.message : String((e as Error)?.message ?? e));
export const ECO_OFF = "ECO ulanmagan — .env da ECO_API_URL va ECO_API_KEY ni bering";

/** ERP xodimi (Haydovchi) → ECO'da foydalanuvchi + haydovchi a'zoligi. Telefon +998… bo'lishi shart. */
export async function linkDriverToEco(employeeId: string, userId: string): Promise<DriverLinkResult> {
  if (!ecoEnabled()) return { error: ECO_OFF };
  const e = await db.employee.findUnique({ where: { id: employeeId } });
  if (!e) return { error: "Xodim topilmadi" };
  const phone = normalizePhone(e.phone);
  if (!phone) return { error: `"${e.fullName}" telefoni +998XXXXXXXXX formatida emas — Xodimlar sahifasida tuzating` };
  const r = await pushEmployeeToEco(employeeId);
  if (!r.ok) return { error: r.error ?? "ECO'ga ulanmadi" };
  const after = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  await audit(db, userId, "UPDATE", "Employee", employeeId, { ecoUserId: e.ecoUserId }, { ecoUserId: after.ecoUserId, eco: "linked" });
  return { ok: true };
}

/** Ilovada o'zi ro'yxatdan o'tgan haydovchini ERP'dan tasdiqlash — Tadbirkor telefonisiz. */
export async function approveDriverInEco(employeeId: string, userId: string): Promise<DriverLinkResult> {
  if (!ecoEnabled()) return { error: ECO_OFF };
  const e = await db.employee.findUnique({ where: { id: employeeId } });
  if (!e) return { error: "Xodim topilmadi" };
  if (!e.ecoUserId) return { error: "Avval ECO'ga ulang" };
  try {
    const r = await eco.approveDriver(e.ecoUserId);
    await db.employee.update({ where: { id: employeeId }, data: { ecoActive: r.isActive, ecoSyncedAt: new Date(), ecoError: null } });
    await audit(db, userId, "UPDATE", "Employee", employeeId, { ecoActive: e.ecoActive }, { ecoActive: r.isActive, eco: "approved" });
  } catch (err) { return { error: msg(err) }; }
  return { ok: true };
}
