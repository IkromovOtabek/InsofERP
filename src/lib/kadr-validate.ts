import { z } from "zod";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/sms/phone";

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
 * Telefon va PINFL takrorlanmasin: telefon — SMS va haydovchi ilovasi (ECO) uchun yagona kalit,
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
