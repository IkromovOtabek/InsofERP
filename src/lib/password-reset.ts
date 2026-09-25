import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, revokeSessions } from "@/lib/auth";
import { passwordProblem } from "@/lib/password-policy";
import { sendSms } from "@/lib/sms";
import { normalizePhone } from "@/lib/sms/phone";
import { AMBIGUOUS_PHONE_ERROR, staffByPhone } from "@/lib/phone-lookup";
import { sendResetCodeToBot } from "@/lib/telegram/notify";

/**
 * Parolni xodimning o'zi tiklashi (`/login/reset`) — bir martalik kod orqali.
 *
 * Kod QAYERGA boradi: avval Telegram botiga (xodimning hisobi botga ulangan bo'lsa) —
 * bepul, bir zumda va operatorga bog'liq emas; ulanmagan bo'lsa SMS bilan. Botga ulash
 * uchun parol kerak emas: botda «Telefon raqamimni yuborish» tugmasi bor
 * (`lib/telegram/bot.ts`), ya'ni parolni unutgan odam ham ulay oladi.
 *
 * Telefon `Employee` dan olinadi (`lib/phone-lookup.ts`) — `User` da telefon maydoni yo'q
 * va qo'shilsa ham ikki joyda ikki xil raqam bo'lib qolardi. Otdel kadr kartadagi raqamni
 * yangilasa — tiklash ham o'sha zahoti yangi raqam bilan ishlaydi.
 *
 * Xavfsizlik qoidalari:
 *  · kodning o'zi saqlanmaydi — faqat bcrypt xeshi;
 *  · 5 daqiqa amal qiladi, 5 marta noto'g'ri kiritilsa kuyadi;
 *  · bir raqamga soatiga 3 ta kod;
 *  · noma'lum raqam uchun ham "yuborildi" deyiladi — kimning raqami tizimda borligi oshkor bo'lmasin.
 */

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 3;

/**
 * `via` — kod qayerga ketdi: ilova sahifada aynan shuni yozadi ("Telegram botga yuborildi").
 * `devCode` — faqat dev'da (SMS_PROVIDER ESKIZ emas): kodni ekranda ko'rsatish uchun.
 */
export type ResetVia = "telegram" | "sms";
export type ResetRequest = { ok: true; sent: boolean; via?: ResetVia; devCode?: string } | { ok: false; error: string };
export type ResetConfirm = { ok: true; login: string } | { ok: false; error: string };

/** 1-qadam: raqamga kod yuborish. */
export async function requestPasswordReset(rawPhone: string): Promise<ResetRequest> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri. Masalan: 90 123 45 67" };

  const found = await staffByPhone(phone);
  if (found.kind === "ambiguous") return { ok: false, error: AMBIGUOUS_PHONE_ERROR };
  // Raqam tizimda yo'q — baribir "yuborildi" deymiz, lekin hech narsa yubormaymiz
  if (found.kind === "none") return { ok: true, sent: false };

  const recent = await db.passwordResetCode.count({
    where: { phone, createdAt: { gt: new Date(Date.now() - 3600_000) } },
  });
  if (recent >= MAX_CODES_PER_HOUR) {
    return { ok: false, error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring yoki Otdel kadrga murojaat qiling." };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.passwordResetCode.create({
    data: {
      userId: found.user.id,
      phone,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  // 1) Telegram bot — hisobi ulangan bo'lsa kod shu yerga boradi
  const bot = await sendResetCodeToBot(found.user.id, code);
  if (bot.ok) return { ok: true, sent: true, via: "telegram" };

  // 2) Bot ulanmagan (yoki yubora olmadi) — eski yo'l: SMS
  const sms = await sendSms("reset_code", phone, { code }, { userId: found.user.id, maxPerHour: MAX_CODES_PER_HOUR });

  // Dev: Eskiz ulanmagan bo'lsa oqim to'xtamasin — kod ekranda va terminalda ko'rinadi.
  // Prodda bu yo'l yopiq: SMS_PROVIDER noto'g'ri sozlansa "kod yuborildi" deb aldab qo'ymaymiz.
  if (!sms.ok && sms.reason === "DISABLED" && process.env.NODE_ENV !== "production") {
    return { ok: true, sent: true, via: "sms", devCode: code };
  }

  if (!sms.ok) {
    // Bu yerda jim turish mumkin emas: odam kodni kutib o'tiraveradi.
    // Botga ulash parolsiz ham mumkin, shuning uchun chiqish yo'li sifatida taklif qilinadi.
    const useBot = " Yoki Insof ERP Telegram botini ochib, «Telefon raqamimni yuborish» tugmasini bosing — keyingi kod botga keladi.";
    const error =
      sms.reason === "DISABLED" ? `SMS xizmati hali yoqilmagan.${useBot}`
      : sms.reason === "RATE_LIMIT" ? "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring."
      : `SMS yuborilmadi. Birozdan keyin qayta urining yoki Otdel kadrga murojaat qiling.${useBot}`;
    return { ok: false, error };
  }
  return { ok: true, sent: true, via: "sms" };
}

/** 2-qadam: kod + yangi parol. */
export async function confirmPasswordReset(rawPhone: string, code: string, newPassword: string): Promise<ResetConfirm> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri" };
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };

  const found = await staffByPhone(phone);
  if (found.kind === "ambiguous") return { ok: false, error: AMBIGUOUS_PHONE_ERROR };
  // Noto'g'ri kod bilan bir xil xabar — raqam bor-yo'qligi bilinmasin
  const wrong = { ok: false as const, error: "Kod noto'g'ri yoki muddati tugagan" };
  if (found.kind === "none") return wrong;

  const rec = await db.passwordResetCode.findFirst({
    where: { userId: found.user.id, phone, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!rec) return wrong;
  if (rec.expiresAt < new Date()) return wrong;
  if (rec.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Urinishlar tugadi — yangi kod so'rang" };

  if (!(await bcrypt.compare(code.trim(), rec.codeHash))) {
    await db.passwordResetCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 } } });
    const left = MAX_ATTEMPTS - rec.attempts - 1;
    return { ok: false, error: left > 0 ? `Kod noto'g'ri. Yana ${left} urinish qoldi` : "Urinishlar tugadi — yangi kod so'rang" };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: found.user.id }, data: { passwordHash: await hashPassword(newPassword) } });
    await revokeSessions(tx, found.user.id); // parol almashdi — eski sessiyalar (telefonini yo'qotgan bo'lsa ham) kuyadi
    await tx.passwordResetCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
    // Qolgan ochiq kodlar ham kuyadi — bittasi ishlatildi, boshqasi kerak emas
    await tx.passwordResetCode.updateMany({ where: { userId: found.user.id, usedAt: null }, data: { usedAt: new Date() } });
    await audit(tx, found.user.id, "UPDATE", "User", found.user.id, undefined, { passwordReset: "self-code", phone });
  });

  return { ok: true, login: found.user.login };
}
