import { randomInt } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { passwordProblem } from "@/lib/password-policy";
import { authSecret, JWT_ALGS } from "@/lib/secret";
import type { Role } from "@/generated/prisma";

/**
 * Vaqtinchalik parol — dispetcher haydovchiga beradi (`driverTempLoginCore`, `lib/kadr-employee.ts`).
 *
 * Maqsad: parolni bilgan dispetcher haydovchi nomidan ishlay olmasin. Shuning uchun:
 *  · parolni tizim yaratadi va u `TEMP_PASSWORD_HOURS` amal qiladi (`User.tempPasswordUntil`), keyin
 *    u bilan kirib bo'lmaydi — dispetcher yangisini beradi;
 *  · vaqtinchalik parol bilan kirilganda sessiya BERILMAYDI: avval xodim o'z parolini o'rnatadi
 *    (veb — kirish sahifasining 2-qadami, mobil — `PASSWORD_CHANGE_REQUIRED` → `/api/mobile/auth/temp-password`);
 *  · 2-qadamga qisqa muddatli imzolangan token o'tadi (parol qayta yuborilmaydi), u bir martalik:
 *    parol almashganda `sessionVersion` oshadi va token ham, eski sessiyalar ham kuyadi;
 *  · berish va almashtirish AuditLog'da, berilganda Otdel kadr va direktorga bildirishnoma.
 * Oddiy parol qo'yiladigan har joy (kadr, direktor, "Mening hisobim", Telegram tiklash) `tempPasswordUntil` ni tozalaydi.
 */

export const TEMP_PASSWORD_HOURS = 72;
const CHANGE_TTL = "15m";

export const TEMP_EXPIRED = "Vaqtinchalik parol muddati tugagan — dispetcherdan yangisini so'rang";
const RESTART = "Vaqt tugadi — login va vaqtinchalik parol bilan qayta kiring";

/** Og'zaki aytishga qulay: 4 harf + 4 raqam, adashtiradigan belgilarsiz (l/1, o/0). Parol siyosatiga mos. */
export function generateTempPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += letters[randomInt(letters.length)];
  for (let i = 0; i < 4; i++) s += digits[randomInt(digits.length)];
  return s;
}

export const tempPasswordUntil = () => new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600_000);

/** 1-qadam o'tdi (vaqtinchalik parol to'g'ri) — 2-qadam (yangi parol) uchun token. */
export async function signTempChange(u: { id: string; sessionVersion: number }): Promise<string> {
  return new SignJWT({ typ: "temp-password", sv: u.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(CHANGE_TTL)
    .sign(authSecret());
}

type ChangedUser = { id: string; login: string; fullName: string; role: Role; sessionVersion: number };
/** `restart` — 1-qadamga qaytish kerak (token eskirgan, parol muddati tugagan yoki hisob o'zgargan). */
export type TempChangeResult = { ok: true; user: ChangedUser } | { ok: false; error: string; restart?: boolean };

/** 2-qadam: token + yangi parol → parol almashadi, vaqtinchalik belgi tozalanadi, eski sessiyalar kuyadi. */
export async function completeTempPassword(token: string, password: string): Promise<TempChangeResult> {
  let userId: string;
  let sv: number;
  try {
    const r = await jwtVerify(token, authSecret(), { algorithms: JWT_ALGS });
    if (r.payload.typ !== "temp-password" || typeof r.payload.sub !== "string" || typeof r.payload.sv !== "number") throw new Error("typ");
    userId = r.payload.sub;
    sv = r.payload.sv;
  } catch {
    return { ok: false, error: RESTART, restart: true };
  }
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive || user.sessionVersion !== sv || !user.tempPasswordUntil) return { ok: false, error: RESTART, restart: true };
  if (user.tempPasswordUntil <= new Date()) return { ok: false, error: TEMP_EXPIRED, restart: true };
  if (await bcrypt.compare(password, user.passwordHash)) return { ok: false, error: "Yangi parol vaqtinchalik paroldan farq qilsin" };

  const passwordHash = await hashPassword(password);
  const changed = await db.$transaction(async (tx) => {
    // Shartli yangilash: bitta token bilan parallel ikki so'rovdan faqat bittasi o'tadi
    const n = await tx.user.updateMany({
      where: { id: user.id, sessionVersion: sv, tempPasswordUntil: { not: null } },
      data: { passwordHash, tempPasswordUntil: null, sessionVersion: { increment: 1 } },
    });
    if (n.count === 0) return null;
    await audit(tx, user.id, "UPDATE", "User", user.id, { tempPassword: true }, { tempPassword: false, passwordChanged: true, via: "vaqtinchalik-parol", login: user.login });
    return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, login: true, fullName: true, role: true, sessionVersion: true } });
  });
  if (!changed) return { ok: false, error: RESTART, restart: true };
  return { ok: true, user: changed };
}
