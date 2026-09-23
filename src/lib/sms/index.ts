import { db } from "@/lib/db";
import { eskizSend, smsProvider, usingTestSender } from "./eskiz";
import { formatPhone, maskPhone, normalizePhone } from "./phone";
import { maskSecrets, TEMPLATES, type TemplateKey } from "./templates";

export { normalizePhone, formatPhone, maskPhone } from "./phone";
export { smsProvider, smsSender, usingTestSender, SmsError } from "./eskiz";
export { TEMPLATES, TEMPLATE_SAMPLES, type TemplateKey } from "./templates";

/** Shablonning o'zgaruvchilari — matn funksiyasidan olinadi, ikkinchi marta yozilmaydi. */
export type SmsVars<K extends TemplateKey> = Parameters<(typeof TEMPLATES)[K]["text"]>[0];

export type SmsResult =
  | { ok: true; phone: string; test: boolean }
  | { ok: false; reason: "NO_PHONE" | "RATE_LIMIT" | "DISABLED" | "FAILED"; error?: string };

/** Bir raqamga soatiga nechta SMS. Spam va tasodifiy sikldan himoya. */
const DEFAULT_MAX_PER_HOUR = 5;

async function sentLastHour(phone: string) {
  return db.smsLog.count({
    where: { phone, status: "SENT", createdAt: { gt: new Date(Date.now() - 3600_000) } },
  });
}

/**
 * Bitta SMS: normallashtiradi → matnni yig'adi → yuboradi → SmsLog'ga yozadi.
 *
 * `SMS_PROVIDER` ESKIZ bo'lmasa haqiqiy yuborish bo'lmaydi, lekin jurnalga SKIPPED
 * sifatida tushadi va matn konsolga chiqadi — dev'da oqimni to'liq sinab ko'rish uchun.
 *
 * Tashlamaydi: natija `SmsResult` da qaytadi. Chaqiruvchi o'zi hal qiladi —
 * parol tiklashda xatoni ko'rsatish kerak, xodimga login berishda esa yo'q
 * (login baribir yaratilgan, SMS ketmagani butun amalni bekor qilmasin).
 */
export async function sendSms<K extends TemplateKey>(
  key: K,
  rawPhone: string | null | undefined,
  vars: SmsVars<K>,
  opts?: { userId?: string | null; maxPerHour?: number },
): Promise<SmsResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, reason: "NO_PHONE" };

  const t = TEMPLATES[key] as unknown as { text: (v: unknown) => string; secret: (v: unknown) => readonly string[] };
  const text = t.text(vars);
  const logText = maskSecrets(text, t.secret(vars));
  const provider = smsProvider();

  const max = opts?.maxPerHour ?? DEFAULT_MAX_PER_HOUR;
  if ((await sentLastHour(phone)) >= max) {
    await db.smsLog.create({ data: { phone, template: key, text: logText, status: "FAILED", provider, error: `Soatlik chek (${max}) to'ldi`, userId: opts?.userId ?? undefined } });
    return { ok: false, reason: "RATE_LIMIT" };
  }

  if (provider !== "eskiz") {
    console.log(`[SMS · yuborilmadi] ${maskPhone(phone)}: ${text}`); // dev: kodni terminalda ko'rish uchun ochiq matn
    await db.smsLog.create({ data: { phone, template: key, text: logText, status: "SKIPPED", provider, error: "SMS_PROVIDER=ESKIZ emas", userId: opts?.userId ?? undefined } });
    return { ok: false, reason: "DISABLED" };
  }

  try {
    await eskizSend(phone, text);
    await db.smsLog.create({ data: { phone, template: key, text: logText, status: "SENT", provider, userId: opts?.userId ?? undefined } });
    return { ok: true, phone, test: usingTestSender() };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[SMS · xato] ${maskPhone(phone)} ${key}: ${error}`);
    await db.smsLog.create({ data: { phone, template: key, text: logText, status: "FAILED", provider, error: error.slice(0, 500), userId: opts?.userId ?? undefined } });
    return { ok: false, reason: "FAILED", error };
  }
}

/**
 * Javobini kutmaydigan variant — SMS asosiy amalning bir qismi bo'lmagan joylar uchun
 * (xodimga login berildi va h.k.). ECO sinxronidagi `pushEmployeeSilently` bilan bir xil uslub.
 */
export function sendSmsSilently<K extends TemplateKey>(key: K, phone: string | null | undefined, vars: SmsVars<K>, opts?: { userId?: string | null }) {
  void sendSms(key, phone, vars, opts).catch((e) => console.error("[SMS]", e));
}

/**
 * Natijani otdel kadr o'qiydigan bitta satrga aylantiradi.
 * SMS ketmasa ham amal bajarilgan bo'ladi — shuning uchun bu xato emas, eslatma:
 * kadr parolni o'zi aytishi kerakligini bilib turadi.
 */
export function smsNote(r: SmsResult): string {
  if (r.ok) {
    return r.test
      ? `SMS yuborildi (${formatPhone(r.phone)}), ammo ESKIZ_FROM sozlanmagan — sinov nomi bilan ketdi va mijozga yetib bormasligi mumkin`
      : `SMS yuborildi: ${formatPhone(r.phone)}`;
  }
  const why =
    r.reason === "NO_PHONE" ? "xodim kartasida to'g'ri telefon raqami yo'q"
    : r.reason === "DISABLED" ? "SMS xizmati yoqilmagan (SMS_PROVIDER)"
    : r.reason === "RATE_LIMIT" ? "bu raqamga soatlik chek to'ldi"
    : `xato: ${r.error ?? "noma'lum"}`;
  return `SMS yuborilmadi — ${why}. Parolni xodimga o'zingiz yetkazing.`;
}
