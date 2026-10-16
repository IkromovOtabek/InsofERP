import { z } from "zod";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import type { Prisma } from "@/generated/prisma";

/**
 * Xodim kartasidagi telefon va PINFL qoidasi — Xodimlar (tezkor forma, karta tahriri) va
 * Otdel kadr (yangi karta) bir xil tekshiradi.
 */

/** Telefon: bo'sh — null; yozilgan bo'lsa +998XXXXXXXXX ga keltiriladi, keltirib bo'lmasa — xato. */
export const zPhone = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  const p = normalizePhone(v);
  if (!p) { ctx.addIssue({ code: "custom", message: "Telefon raqami noto'g'ri — +998 XX XXX XX XX ko'rinishida yozing" }); return z.NEVER; }
  return p;
});

/** PINFL — 14 raqam (bo'shliqlar olib tashlanadi). */
export const zPinfl = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  const d = v.replace(/\s+/g, "");
  if (!/^\d{14}$/.test(d)) { ctx.addIssue({ code: "custom", message: "PINFL 14 ta raqamdan iborat bo'lsin" }); return z.NEVER; }
  return d;
});

/**
 * Telefon va PINFL takrorlanmasin: telefon — Telegram kod bilan kirish va haydovchi ilovasi (ECO) uchun yagona kalit,
 * PINFL — bitta odam. Boshqa (telefon uchun — faol) xodimda shu qiymat bo'lsa — rad, kimdaligi aytiladi.
 * `selfId` — tahrirlanayotgan xodim (o'zi bilan solishtirilmaydi).
 */
export async function duplicateProblem(selfId: string | null, phone: string | null, pinfl?: string | null): Promise<string | null> {
  if (phone) {
    const o = await db.employee.findFirst({ where: { phone, isActive: true, ...(selfId ? { id: { not: selfId } } : {}) }, select: { fullName: true } });
    if (o) return `Bu telefon raqami boshqa xodimda bor: ${o.fullName}`;
  }
  if (pinfl) {
    const o = await db.employee.findFirst({ where: { pinfl, ...(selfId ? { id: { not: selfId } } : {}) }, select: { fullName: true } });
    if (o) return `Bu PINFL boshqa xodim kartasida bor: ${o.fullName}`;
  }
  return null;
}

/** Haydovchining ochiq reysi bo'lsa — bo'shatish rad etiladi (reys egasiz qolmasin). */
export async function openTripsProblem(employeeId: string, tx: Prisma.TransactionClient = db): Promise<string | null> {
  const open = await tx.trip.findMany({ where: { driverId: employeeId, status: { in: ["PLANNED", "LOADED", "ON_ROAD"] } }, select: { deliveryNoteNo: true } });
  return open.length ? `Haydovchida ochiq reys bor: ${open.map((t) => t.deliveryNoteNo).join(", ")} — avval yakunlang yoki bekor qiling` : null;
}

/**
 * Ishdan bo'shatishda xodimdan bo'shatiladigan narsalar (tugma, karta va Excel import bir xil):
 * biriktirilgan texnika bo'shaydi va brigadirligi olinadi — aks holda brigada bo'shatilgan odamni boshliq deb
 * ko'rsatib, "Keldi" xabarlari unga ketaverardi. Qaytaradi: bo'shagan texnika id (ECO ga jo'natish uchun).
 */
export async function releaseOnDismiss(tx: Prisma.TransactionClient, employeeId: string): Promise<{ vehicleId: string | null; brigades: string[] }> {
  const e = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { vehicleId: true } });
  if (e.vehicleId) await tx.employee.update({ where: { id: employeeId }, data: { vehicleId: null } });
  const led = await tx.brigade.findMany({ where: { leaderId: employeeId }, select: { id: true, name: true } });
  if (led.length) await tx.brigade.updateMany({ where: { leaderId: employeeId }, data: { leaderId: null } });
  return { vehicleId: e.vehicleId, brigades: led.map((b) => b.name) };
}
