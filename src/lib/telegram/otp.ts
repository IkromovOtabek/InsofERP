import { maskPhone } from "@/lib/phone";
import { isTestMode } from "@/lib/test-mode";

/**
 * Bir martalik kodlar (kirish, parol tiklash, ro'yxatdan o'tish) uchun umumiy qoidalar.
 *
 * Kod FAQAT Telegram orqali yetkaziladi: xodimning Insof ERP boti (hisob ulangan bo'lsa) yoki
 * Telegram Gateway (raqamning Telegram hisobiga to'g'ridan-to'g'ri). SMS kanali yo'q.
 */

/** Foydalanuvchiga ko'rsatiladigan tushuntirish — kod kelmasa nima qilish kerak. */
export { CODE_DELIVERY_HINT } from "./otp-text";

/** Kod ekranda ko'rsatiladimi: dev yoki test rejimi (test serveri `next start` — NODE_ENV=production). Prodda hech qachon. */
export const devCodeAllowed = () => process.env.NODE_ENV !== "production" || isTestMode();

/** Kod yetkazilmadi — faqat server jurnaliga (raqam qisman yashirilgan, kodning o'zi yozilmaydi). */
export function logUndelivered(scope: string, phone: string, reason: string) {
  console.warn(`[${scope}] kod yetkazilmadi ${maskPhone(phone)}: ${reason}`);
}
