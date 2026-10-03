import { randomInt } from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { issueSession } from "@/lib/auth";
import { TOUR_COOKIE } from "@/lib/tour";
import { sendSms } from "@/lib/sms";
import { normalizePhone } from "@/lib/sms/phone";
import { hit } from "@/lib/rate-limit";
import { staffByPhone } from "@/lib/phone-lookup";
import { linkedChatId } from "@/lib/telegram/notify";
import { botEnabled, sendMessage } from "@/lib/telegram/api";
import { gatewayEnabled, sendGatewayCode } from "@/lib/telegram/gateway";

/**
 * SMS/Telegram kod orqali tizimga kirish — login+parolga QO'SHIMCHA yo'l.
 *
 * Maqsad: telefoni bor har qanday faol xodim (parol oldindan berilmagan bo'lsa ham)
 * bir martalik kod bilan kira olsin. Kod `lib/password-reset.ts` dagi aynan shu mexanizm
 * bilan ishlaydi — faqat oxirida parol tiklash emas, darhol sessiya beriladi.
 *
 * Kod QAYERGA boradi (shu tartibda): xodimning Telegram boti (ulangan bo'lsa) →
 * Telegram Gateway (raqamga to'g'ridan-to'g'ri) → SMS (Eskiz yoqilgan bo'lsa).
 * Test/dev rejimida hamma kanal o'chiq — kod konsolga chiqadi va `devCode` da qaytadi.
 *
 * Kod `PasswordResetCode` jadvalida saqlanadi (yangi jadval kerak emas): xuddi parol
 * tiklashdagidek — userId, phone, codeHash (bcrypt), expiresAt, attempts. Kodning o'zi
 * saqlanmaydi.
 *
 * Xavfsizlik qoidalari (parol tiklash bilan bir xil):
 *  · kodning o'zi emas, faqat bcrypt xeshi saqlanadi;
 *  · 5 daqiqa amal qiladi, 5 marta noto'g'ri kiritilsa kuyadi;
 *  · bir raqamga soatiga 3 ta kod;
 *  · faqat `isActive` xodim;
 *  · noma'lum / bir nechta kartadagi raqam uchun ham "yuborildi" deyiladi — kimning
 *    raqami tizimda borligi oshkor bo'lmasin;
 *  · sessiya FAQAT kod to'g'ri tasdiqlangach beriladi.
 */

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 3;

export type LoginVia = "telegram" | "gateway" | "sms";
/** `devCode` — faqat dev/test (real kanal yo'q): kodni ekranda ko'rsatish uchun. */
export type LoginCodeRequest =
  | { ok: true; sent: boolean; via?: LoginVia; devCode?: string }
  | { ok: false; error: string };

/** Sessiya berishdan OLDIN topilgan xodim — issueSession/mobil token uchun yetarli maydonlar. */
export type LoginCodeUser = { id: string; login: string; fullName: string; role: import("@/generated/prisma").Role; sessionVersion: number };
export type LoginCodeVerify = { ok: true; user: LoginCodeUser } | { ok: false; error: string };
export type LoginCodeConfirm = { ok: true; login: string } | { ok: false; error: string };

/** Noto'g'ri kod / noma'lum raqamda bir xil xabar — raqam tizimda bor-yo'qligi bilinmasin. */
const WRONG = "Kod noto'g'ri yoki muddati tugagan";
/** Soatlik chek xabari — mavjud va noma'lum raqam uchun bir xil. */
const RATE_LIMIT_MSG = "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring yoki Otdel kadrga murojaat qiling.";

/** Login kodini xodimning Telegram botiga yuborish (reset'dan boshqa matn: bu kirish kodi). */
async function sendCodeToBot(userId: string, code: string): Promise<{ ok: boolean }> {
  if (!botEnabled()) return { ok: false };
  const chatId = await linkedChatId(userId);
  if (!chatId) return { ok: false };
  try {
    await sendMessage(chatId, [
      "*Insof ERP — tizimga kirish*",
      "",
      `Kirish kodi: \`${code}\``,
      "",
      "Kod 5 daqiqa amal qiladi.",
      "Kodni hech kimga bermang — biz uni hech qachon so'ramaymiz. Kirishni siz boshlamagan bo'lsangiz, bu xabarga e'tibor bermang.",
    ].join("\n"));
    return { ok: true };
  } catch (e) {
    console.error("[sms-login][bot]", e);
    return { ok: false };
  }
}

/** 1-qadam: raqamga kirish kodini yuborish. */
export async function requestLoginCode(rawPhone: string): Promise<LoginCodeRequest> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri. Masalan: 90 123 45 67" };

  // Raqam bo'yicha soatlik chek — raqam tizimda bor-yo'qligidan QAT'I NAZAR bir xil qo'llanadi,
  // aks holda "juda ko'p urinish" faqat mavjud raqamlarda chiqib, ularni oshkor qilardi.
  if (!hit(`login-code:ph:${phone}`, MAX_CODES_PER_HOUR, 3600_000)) return { ok: false, error: RATE_LIMIT_MSG };

  // Raqam yo'q / bir nechta kartada bo'lsa — javob bir xil ("yuborildi"): begona odam istalgan
  // raqam xodimniki ekanini sinab bilib olmasin. Kod ham yaratilmaydi (limit behuda yeyilmasin).
  // Chaqiruvchilar `sent`/`via` ni tashqariga chiqarmaydi — javob har doim bir xil `{sent:true}`.
  const silent: LoginCodeRequest = { ok: true, sent: false };
  const found = await staffByPhone(phone);
  if (found.kind !== "found") return silent;

  const recent = await db.passwordResetCode.count({
    where: { phone, createdAt: { gt: new Date(Date.now() - 3600_000) } },
  });
  if (recent >= MAX_CODES_PER_HOUR) return { ok: false, error: RATE_LIMIT_MSG };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.passwordResetCode.create({
    data: {
      userId: found.user.id,
      phone,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  // 1) Telegram bot — hisobi ulangan bo'lsa kod shu yerga boradi (bepul, bir zumda)
  if ((await sendCodeToBot(found.user.id, code)).ok) return { ok: true, sent: true, via: "telegram" };

  // 2) Telegram Gateway — raqamga to'g'ridan-to'g'ri (botga ulanish shart emas). Yoqilgan bo'lsa.
  if (gatewayEnabled()) {
    const gw = await sendGatewayCode(phone, code, { ttlSec: Math.round(CODE_TTL_MS / 1000), payload: `login:${found.user.id}` });
    if (gw.ok) return { ok: true, sent: true, via: "gateway" };
    if (gw.reason === "RATE_LIMIT") return { ok: false, error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring." };
  }

  // 3) SMS — Eskiz yoqilgan bo'lsa. (reset_code shabloni qayta ishlatiladi: matn "kod" haqida.)
  const sms = await sendSms("reset_code", phone, { code }, { userId: found.user.id, maxPerHour: MAX_CODES_PER_HOUR });
  if (sms.ok) return { ok: true, sent: true, via: "sms" };

  // Dev/test: hech bir kanal yo'q — oqim to'xtamasin, kod ekranda ko'rinadi. Prodda yopiq.
  if (process.env.NODE_ENV !== "production") return { ok: true, sent: true, devCode: code };

  if (sms.reason === "RATE_LIMIT") return { ok: false, error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring." };
  // Prodda birorta ham kanal ishlamadi: parol bilan kirishni taklif qilamiz.
  return { ok: false, error: "Kod yuborilmadi. Login va parolingiz bilan kiring yoki Otdel kadrga murojaat qiling." };
}

/**
 * Kodni tekshiradi va KODNI KUYDIRADI (sessiya BERMAYDI) — veb va mobil o'rtasida umumiy qism.
 * Veb `confirmLoginCode` buning ustiga cookie sessiya qo'yadi, mobil endpoint esa token beradi.
 */
export async function verifyLoginCode(rawPhone: string, code: string): Promise<LoginCodeVerify> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: WRONG };

  const found = await staffByPhone(phone);
  if (found.kind !== "found") return { ok: false, error: WRONG };

  const rec = await db.passwordResetCode.findFirst({
    where: { userId: found.user.id, phone, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!rec) return { ok: false, error: WRONG };
  if (rec.expiresAt < new Date()) return { ok: false, error: WRONG };
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

  // Kod to'g'ri — xodim hali faolligini bazadan tasdiqlaymiz (kod yaratilgandan keyin yopilgan bo'lishi mumkin)
  const user = await db.user.findUnique({
    where: { id: found.user.id },
    select: { id: true, login: true, fullName: true, role: true, isActive: true, sessionVersion: true },
  });
  if (!user || !user.isActive) return { ok: false, error: WRONG };

  const done = await db.$transaction(async (tx) => {
    // Kod faqat bir marta ishlatiladi — parallel ikkinchi so'rov shu yerda to'xtaydi
    const claim = await tx.passwordResetCode.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claim.count === 0) return false;
    // Qolgan ochiq kodlar ham kuyadi — bittasi ishlatildi, boshqasi kerak emas
    await tx.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await audit(tx, user.id, "UPDATE", "User", user.id, undefined, { login: "sms-code", phone });
    return true;
  });
  if (!done) return { ok: false, error: WRONG };

  return { ok: true, user };
}

/** 2-qadam (veb): kod → cookie sessiya. */
export async function confirmLoginCode(rawPhone: string, code: string): Promise<LoginCodeConfirm> {
  const r = await verifyLoginCode(rawPhone, code);
  if (!r.ok) return r;
  await issueSession(r.user);
  // Instruksiya har kirishda boshidan ko'rsatiladi (login() bilan bir xil).
  (await cookies()).delete(TOUR_COOKIE);
  return { ok: true, login: r.user.login };
}
