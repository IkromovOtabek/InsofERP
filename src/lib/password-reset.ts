import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, revokeSessions } from "@/lib/auth";
import { passwordProblem } from "@/lib/password-policy";
import { sendSms } from "@/lib/sms";
import { normalizePhone } from "@/lib/sms/phone";
import { hit } from "@/lib/rate-limit";
import { staffByPhone } from "@/lib/phone-lookup";
import { linkedChatId, sendResetCodeToBot } from "@/lib/telegram/notify";
import { botEnabled } from "@/lib/telegram/api";
import { gatewayEnabled, sendGatewayCode } from "@/lib/telegram/gateway";
import { isTestMode } from "@/lib/test-mode";

/** Kod ekranda ko'rsatiladimi: dev yoki test rejimi (test serveri `next start` — NODE_ENV=production). Prodda hech qachon. */
const devCodeAllowed = () => process.env.NODE_ENV !== "production" || isTestMode();

/**
 * Parolni xodimning o'zi tiklashi (`/login/reset`) — bir martalik kod orqali.
 *
 * Kod QAYERGA boradi: Telegram botiga (xodimning hisobi botga ulangan bo'lsa) —
 * bepul, bir zumda va operatorga bog'liq emas. SMS zaxirasi hozircha o'chiq
 * (`RESET_SMS_FALLBACK=1` bilan qaytadi): bot ulanmagan bo'lsa xodimga qanday ulash aytiladi. Botga ulash
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
/** SMS zaxirasi — hozircha o'chiq, kod faqat Telegram botga boradi. */
const SMS_FALLBACK = process.env.RESET_SMS_FALLBACK === "1";
const NOT_LINKED_ERROR =
  "Telegram botga hali ulanmagansiz. Insof ERP botini oching → /start → «Telefon raqamimni yuborish» tugmasini bosing, so'ng shu yerda qayta «Kodni Telegramga yuborish»ni bosing.";

/**
 * `via` — kod qayerga ketdi: ilova sahifada aynan shuni yozadi ("Telegram botga yuborildi").
 * `devCode` — faqat dev'da (SMS_PROVIDER ESKIZ emas): kodni ekranda ko'rsatish uchun.
 */
export type ResetVia = "telegram" | "gateway" | "sms";
export type ResetRequest = { ok: true; sent: boolean; via?: ResetVia; devCode?: string } | { ok: false; error: string };
export type ResetConfirm = { ok: true; login: string } | { ok: false; error: string };

/** 1-qadam: raqamga kod yuborish. */
export async function requestPasswordReset(rawPhone: string): Promise<ResetRequest> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri. Masalan: 90 123 45 67" };

  // Raqam yo'q / bir nechta kartada / bot ulanmagan — javob bir xil ("yuborildi"): aks holda begona
  // odam istalgan raqam xodimniki ekanini (va Telegram ulanganini) sinab bilib olardi. Nima qilish
  // kerakligi sahifada har doim yozilgan (raqamni tekshirish, botga ulanish, Otdel kadr).
  const silent: ResetRequest = { ok: true, sent: false, via: SMS_FALLBACK ? undefined : "telegram" };
  // Soatlik chek raqam tizimda bor-yo'qligidan qat'i nazar bir xil qo'llanadi — "juda ko'p urinish"
  // faqat mavjud raqamda chiqib, uni oshkor qilmasin.
  if (!hit(`reset-code:ph:${phone}`, MAX_CODES_PER_HOUR, 3600_000)) {
    return { ok: false, error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring yoki Otdel kadrga murojaat qiling." };
  }
  const found = await staffByPhone(phone);
  if (found.kind === "ambiguous" || found.kind === "none") return silent;

  // Kod kanallari: Telegram bot (ulangan bo'lsa) → Telegram Gateway (raqamga to'g'ridan-to'g'ri) → SMS.
  // Bot ulanmagan va Gateway ham o'chiq, SMS ham o'chiq bo'lsagina kod yaratmaymiz (limit behuda yeyilmasin).
  const botReady = botEnabled();
  const gateway = gatewayEnabled();
  if (!SMS_FALLBACK && !gateway && botReady && !(await linkedChatId(found.user.id))) return silent;

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

  // 2) Telegram Gateway — raqamga to'g'ridan-to'g'ri (botga ulanish shart emas). Yoqilgan bo'lsa.
  if (gateway) {
    const gw = await sendGatewayCode(phone, code, { ttlSec: Math.round(CODE_TTL_MS / 1000), payload: `reset:${found.user.id}` });
    if (gw.ok) return { ok: true, sent: true, via: "gateway" };
    if (gw.reason === "RATE_LIMIT") return { ok: false, error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring." };
    // yuborilmadi — SMS zaxirasiga o'tamiz (yoqilgan bo'lsa), aks holda quyida xato/devCode
  }

  if (!SMS_FALLBACK) {
    // Dev: bot tokeni sozlanmagan bo'lsa oqim to'xtamasin — kod ekranda ko'rinadi. Prodda yopiq.
    if (!botReady && devCodeAllowed()) return { ok: true, sent: true, via: "telegram", devCode: code };
    return {
      ok: false,
      error: bot.reason === "NOT_LINKED" ? NOT_LINKED_ERROR
        : bot.reason === "NO_BOT" ? "Telegram bot sozlanmagan — parolni tiklash uchun Otdel kadrga murojaat qiling."
        : "Kod Telegramga yuborilmadi. Birozdan keyin qayta urining yoki Otdel kadrga murojaat qiling.",
    };
  }

  // 2) Bot ulanmagan (yoki yubora olmadi) — eski yo'l: SMS (RESET_SMS_FALLBACK=1 bo'lsagina)
  const sms = await sendSms("reset_code", phone, { code }, { userId: found.user.id, maxPerHour: MAX_CODES_PER_HOUR });

  // Dev: Eskiz ulanmagan bo'lsa oqim to'xtamasin — kod ekranda va terminalda ko'rinadi.
  // Prodda bu yo'l yopiq: SMS_PROVIDER noto'g'ri sozlansa "kod yuborildi" deb aldab qo'ymaymiz.
  if (!sms.ok && sms.reason === "DISABLED" && devCodeAllowed()) {
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
  // Noto'g'ri kod bilan bir xil xabar — raqam bor-yo'qligi (yoki bir nechta kartada ekani) bilinmasin
  const wrong = { ok: false as const, error: "Kod noto'g'ri yoki muddati tugagan" };
  if (found.kind !== "found") return wrong;

  const rec = await db.passwordResetCode.findFirst({
    where: { userId: found.user.id, phone, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!rec) return wrong;
  if (rec.expiresAt < new Date()) return wrong;
  if (rec.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Urinishlar tugadi — yangi kod so'rang" };

  // Urinish taqqoslashdan OLDIN atomar hisoblanadi: parallel so'rovlar bilan 5 tadan ortiq
  // taxmin qilib bo'lmasin (o'qish → taqqoslash → yozish orasidagi poyga yopiladi).
  const slot = await db.passwordResetCode.updateMany({
    where: { id: rec.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (slot.count === 0) return { ok: false, error: "Urinishlar tugadi — yangi kod so'rang" };

  if (!(await bcrypt.compare(code.trim(), rec.codeHash))) {
    const left = MAX_ATTEMPTS - rec.attempts - 1;
    return { ok: false, error: left > 0 ? `Kod noto'g'ri. Yana ${left} urinish qoldi` : "Urinishlar tugadi — yangi kod so'rang" };
  }

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
