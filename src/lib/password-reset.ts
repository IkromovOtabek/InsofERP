import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { sendSms } from "@/lib/sms";
import { normalizePhone } from "@/lib/sms/phone";

/**
 * Parolni xodimning o'zi tiklashi (`/login/reset`) — SMS kodi orqali.
 *
 * Nega telefon `Employee` dan olinadi: `User` da telefon maydoni yo'q va qo'shilsa ham
 * ikki joyda ikki xil raqam bo'lib qolardi. Otdel kadr xodim kartasidagi raqamni
 * yangilasa — tiklash ham o'sha zahoti yangi raqamga ishlaydi.
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
export const MIN_PASSWORD = 6;

/** `devCode` — faqat dev'da (SMS_PROVIDER ESKIZ emas): kodni ekranda ko'rsatish uchun. */
export type ResetRequest = { ok: true; sent: boolean; devCode?: string } | { ok: false; error: string };
export type ResetConfirm = { ok: true; login: string } | { ok: false; error: string };

type PhoneLookup =
  | { kind: "found"; employeeId: string; fullName: string; user: { id: string; login: string } }
  | { kind: "none" }
  /** Bitta raqam bir nechta faol loginga tegishli — kimning paroli ekanini bilib bo'lmaydi. */
  | { kind: "ambiguous" };

/**
 * Normallashtirilgan raqam bo'yicha tizimga kiradigan xodimni topish.
 * Raqamlar bazada qo'lda kiritilgan ("90 123 45 67", "+998901234567"…) — SQL'da
 * solishtirib bo'lmaydi, shuning uchun ro'yxat olinib JS'da normallashtiriladi.
 * Zavod xodimlari soni kichik, bu arzon.
 *
 * `Employee.phone` noyob emas: amalda bitta raqam ikki kartaga yozilib qolishi mumkin.
 * Bunday holda tasodifiy birovning parolini almashtirib yuborish mumkin emas — to'xtaymiz.
 */
async function employeeByPhone(phone: string): Promise<PhoneLookup> {
  const rows = await db.employee.findMany({
    where: { isActive: true, userId: { not: null }, phone: { not: null } },
    select: { id: true, phone: true, fullName: true, user: { select: { id: true, login: true, isActive: true } } },
  });
  const hits = rows.filter((e) => normalizePhone(e.phone) === phone && e.user?.isActive);
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous" };
  const hit = hits[0];
  return { kind: "found", employeeId: hit.id, fullName: hit.fullName, user: { id: hit.user!.id, login: hit.user!.login } };
}

const AMBIGUOUS_ERROR = "Bu raqam bir nechta xodim kartasida yozilgan — parolni Otdel kadr almashtirib beradi.";

/** 1-qadam: raqamga kod yuborish. */
export async function requestPasswordReset(rawPhone: string): Promise<ResetRequest> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri. Masalan: 90 123 45 67" };

  const found = await employeeByPhone(phone);
  if (found.kind === "ambiguous") return { ok: false, error: AMBIGUOUS_ERROR };
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

  const sms = await sendSms("reset_code", phone, { code }, { userId: found.user.id, maxPerHour: MAX_CODES_PER_HOUR });

  // Dev: Eskiz ulanmagan bo'lsa oqim to'xtamasin — kod ekranda va terminalda ko'rinadi.
  // Prodda bu yo'l yopiq: SMS_PROVIDER noto'g'ri sozlansa "kod yuborildi" deb aldab qo'ymaymiz.
  if (!sms.ok && sms.reason === "DISABLED" && process.env.NODE_ENV !== "production") {
    return { ok: true, sent: true, devCode: code };
  }

  if (!sms.ok) {
    // Bu yerda jim turish mumkin emas: odam kodni kutib o'tiraveradi
    const error =
      sms.reason === "DISABLED" ? "SMS xizmati hali yoqilmagan. Otdel kadrga murojaat qiling."
      : sms.reason === "RATE_LIMIT" ? "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring."
      : "SMS yuborilmadi. Birozdan keyin qayta urining yoki Otdel kadrga murojaat qiling.";
    return { ok: false, error };
  }
  return { ok: true, sent: true };
}

/** 2-qadam: kod + yangi parol. */
export async function confirmPasswordReset(rawPhone: string, code: string, newPassword: string): Promise<ResetConfirm> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri" };
  if (newPassword.length < MIN_PASSWORD) return { ok: false, error: `Parol kamida ${MIN_PASSWORD} belgi bo'lsin` };

  const found = await employeeByPhone(phone);
  if (found.kind === "ambiguous") return { ok: false, error: AMBIGUOUS_ERROR };
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
    await tx.passwordResetCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
    // Qolgan ochiq kodlar ham kuyadi — bittasi ishlatildi, boshqasi kerak emas
    await tx.passwordResetCode.updateMany({ where: { userId: found.user.id, usedAt: null }, data: { usedAt: new Date() } });
    await audit(tx, found.user.id, "UPDATE", "User", found.user.id, undefined, { passwordReset: "self-sms", phone });
  });

  return { ok: true, login: found.user.login };
}
