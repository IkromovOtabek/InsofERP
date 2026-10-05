import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, revokeSessions } from "@/lib/auth";
import { passwordProblem } from "@/lib/password-policy";
import { normalizePhone } from "@/lib/phone";
import { hit } from "@/lib/rate-limit";
import { staffByPhone } from "@/lib/phone-lookup";
import { linkedChatId, sendResetCodeToBot } from "@/lib/telegram/notify";
import { botEnabled } from "@/lib/telegram/api";
import { gatewayEnabled, sendGatewayCode } from "@/lib/telegram/gateway";
import { devCodeAllowed, logUndelivered } from "@/lib/telegram/otp";

/**
 * Parolni xodimning o'zi tiklashi (`/login/reset`) — bir martalik kod orqali.
 *
 * Kod FAQAT Telegram orqali boradi (SMS kanali yo'q), shu tartibda:
 *  1) Insof ERP boti — xodimning hisobi botga ulangan bo'lsa (bepul, bir zumda). Botga ulash
 *     uchun parol kerak emas: botda «Telefon raqamimni yuborish» tugmasi bor (`lib/telegram/bot.ts`);
 *  2) Telegram Gateway — raqamning Telegram hisobiga to'g'ridan-to'g'ri (`TELEGRAM_GATEWAY_TOKEN`).
 *
 * Telefon `Employee` dan olinadi (`lib/phone-lookup.ts`) — `User` da telefon maydoni yo'q
 * va qo'shilsa ham ikki joyda ikki xil raqam bo'lib qolardi. Otdel kadr kartadagi raqamni
 * yangilasa — tiklash ham o'sha zahoti yangi raqam bilan ishlaydi.
 *
 * Xavfsizlik qoidalari:
 *  · kodning o'zi saqlanmaydi — faqat bcrypt xeshi;
 *  · 5 daqiqa amal qiladi, 5 marta noto'g'ri kiritilsa kuyadi;
 *  · bir raqamga soatiga 3 ta kod;
 *  · noma'lum raqam uchun ham, kod yetkazilmagan holatda ham javob bir xil ("yuborildi") — kimning
 *    raqami tizimda borligi (yoki Telegram ulanganligi) oshkor bo'lmasin. Yetkazilmagan sabab —
 *    faqat server jurnalida.
 */

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 3;

/**
 * `via` — tashqariga har doim "telegram" (kanal aniqligi raqam borligini oshkor qilmasin).
 * `devCode` — faqat dev/test rejimida: kodni ekranda ko'rsatish uchun.
 */
export type ResetVia = "telegram";
export type ResetRequest = { ok: true; sent: boolean; via?: ResetVia; devCode?: string } | { ok: false; error: string };
export type ResetConfirm = { ok: true; login: string } | { ok: false; error: string };

/** 1-qadam: raqamga kod yuborish. */
export async function requestPasswordReset(rawPhone: string): Promise<ResetRequest> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri. Masalan: 90 123 45 67" };

  // Raqam yo'q / bir nechta kartada / Telegram'ga yetkazib bo'lmadi — javob bir xil ("yuborildi"):
  // aks holda begona odam istalgan raqam xodimniki ekanini sinab bilib olardi. Nima qilish kerakligi
  // sahifada har doim yozilgan (raqamni tekshirish, Telegram, administrator).
  const silent: ResetRequest = { ok: true, sent: false, via: "telegram" };
  // Soatlik chek raqam tizimda bor-yo'qligidan qat'i nazar bir xil qo'llanadi — "juda ko'p urinish"
  // faqat mavjud raqamda chiqib, uni oshkor qilmasin.
  if (!hit(`reset-code:ph:${phone}`, MAX_CODES_PER_HOUR, 3600_000)) {
    return { ok: false, error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring yoki Otdel kadrga murojaat qiling." };
  }
  const found = await staffByPhone(phone);
  if (found.kind === "ambiguous" || found.kind === "none") return silent;

  const recent = await db.passwordResetCode.count({
    where: { phone, createdAt: { gt: new Date(Date.now() - 3600_000) } },
  });
  // Bazadagi chek — neytral javob (xato faqat mavjud raqamda chiqmasin)
  if (recent >= MAX_CODES_PER_HOUR) { logUndelivered("password-reset", phone, "soatlik chek (baza)"); return silent; }

  // Hech bir kanal yetkaza olmaydigan holat (bot ulanmagan, Gateway o'chiq, prod) — kod yaratilmaydi
  const botReady = botEnabled() && !!(await linkedChatId(found.user.id));
  const gateway = gatewayEnabled();
  if (!botReady && !gateway && !devCodeAllowed()) {
    logUndelivered("password-reset", phone, "Telegram bot ulanmagan va TELEGRAM_GATEWAY_TOKEN sozlanmagan");
    return silent;
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
  if (botReady && (await sendResetCodeToBot(found.user.id, code)).ok) return { ok: true, sent: true, via: "telegram" };

  // 2) Telegram Gateway — raqamga to'g'ridan-to'g'ri (botga ulanish shart emas). Yoqilgan bo'lsa.
  if (gateway) {
    const gw = await sendGatewayCode(phone, code, { ttlSec: Math.round(CODE_TTL_MS / 1000), payload: `reset:${found.user.id}` });
    if (gw.ok) return { ok: true, sent: true, via: "telegram" };
    logUndelivered("password-reset", phone, `Gateway: ${gw.reason}${gw.error ? ` (${gw.error})` : ""}`);
  }

  // Dev/test: Telegram sozlanmagan — oqim to'xtamasin, kod ekranda ko'rinadi. Prodda yopiq.
  if (devCodeAllowed()) return { ok: true, sent: true, via: "telegram", devCode: code };

  // Prodda Telegram kanallari yetkaza olmadi — neytral javob, sabab jurnalda.
  logUndelivered("password-reset", phone, "Telegram kanallari yetkaza olmadi");
  return silent;
}

/** 2-qadam: kod + yangi parol. */
export async function confirmPasswordReset(rawPhone: string, code: string, newPassword: string): Promise<ResetConfirm> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri" };
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };

  const found = await staffByPhone(phone);
  // Noto'g'ri kod bilan bir xil xabar — raqam bor-yo'qligi (yoki bir nechta kartada ekani) bilinmasin
  const wrong = { ok: false as const, error: "Kod noto'g'ri yoki muddati tugagan. Bir necha marta xato bo'lsa — yangi kod so'rang" };
  if (found.kind !== "found") return wrong;

  const rec = await db.passwordResetCode.findFirst({
    where: { userId: found.user.id, phone, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!rec) return wrong;
  if (rec.expiresAt < new Date()) return wrong;
  // Barcha xatolarda bir xil javob — "Yana N urinish" faqat haqiqiy xodim raqamida chiqib, raqamni oshkor qilardi
  if (rec.attempts >= MAX_ATTEMPTS) return wrong;

  // Urinish taqqoslashdan OLDIN atomar hisoblanadi: parallel so'rovlar bilan 5 tadan ortiq
  // taxmin qilib bo'lmasin (o'qish → taqqoslash → yozish orasidagi poyga yopiladi).
  const slot = await db.passwordResetCode.updateMany({
    where: { id: rec.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (slot.count === 0) return wrong;

  if (!(await bcrypt.compare(code.trim(), rec.codeHash))) return wrong;

  const hash = await hashPassword(newPassword);
  const done = await db.$transaction(async (tx) => {
    // Kod faqat bir marta ishlatiladi — parallel ikkinchi so'rov shu yerda to'xtaydi
    const claim = await tx.passwordResetCode.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claim.count === 0) return false;
    await tx.user.update({ where: { id: found.user.id }, data: { passwordHash: hash } });
    await revokeSessions(tx, found.user.id); // parol almashdi — eski sessiyalar (telefonini yo'qotgan bo'lsa ham) kuyadi
    // Qolgan ochiq kodlar ham kuyadi — bittasi ishlatildi, boshqasi kerak emas
    await tx.passwordResetCode.updateMany({ where: { userId: found.user.id, usedAt: null }, data: { usedAt: new Date() } });
    await audit(tx, found.user.id, "UPDATE", "User", found.user.id, undefined, { passwordReset: "self-code", phone });
    return true;
  });
  if (!done) return wrong;

  return { ok: true, login: found.user.login };
}
