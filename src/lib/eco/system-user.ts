import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export const ECO_SYSTEM_LOGIN = "eco-integration";

/**
 * Haydovchi ilovasidan (webhook) kelgan o'zgarishlar audit jurnalida kimdir nomidan yozilishi kerak.
 * Bu foydalanuvchi tizimga kira olmaydi (isActive=false, tasodifiy parol) — faqat audit uchun.
 */
export async function ecoSystemUserId(): Promise<string> {
  const u = await db.user.findUnique({ where: { login: ECO_SYSTEM_LOGIN }, select: { id: true } });
  if (u) return u.id;
  const created = await db.user.create({
    data: { login: ECO_SYSTEM_LOGIN, fullName: "Insof ECO (haydovchi ilovasi)", role: "LOGISTICS", isActive: false, passwordHash: await hashPassword(randomBytes(24).toString("hex")) },
    select: { id: true },
  });
  return created.id;
}
