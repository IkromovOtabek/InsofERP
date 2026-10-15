/**
 * Maydon xotirasi — qo'lda yozilgan qiymatlarni eslab qolib, keyingi safar taklif qilish
 * (Google Sheets'dagi avto-to'ldirish kabi). Qoidalar bitta joyda: brauzer ham, API ham shundan foydalanadi.
 */

export const MEMORY_KEY_MAX = 160;
export const MEMORY_VALUE_MAX = 200;
/** Bitta maydon uchun nechta taklif qaytariladi. */
export const MEMORY_SUGGEST_LIMIT = 40;

/**
 * Eslab qolinmaydigan maydonlar: maxfiy (parol, kod), qidiruv va yangi yozuvning
 * o'ziga xos belgilari (nom, kod, INN) — eski qiymatni taklif qilish dublikatga olib keladi.
 */
const SKIP_NAME = /(pass|parol|pin|otp|token|secret|card|karta|passport|^q$|query|search|qidir|^name$|fullname|^code$|^kod$|^inn$|stir|login|docno|clienttoken)/i;

/** Faqat raqam/sana — summa, miqdor, sana: ularni taklif qilish foydasiz. */
const NUMERIC = /^[\d\s.,:/+\-%]+$/;

/** URL dagi id'lar (cuid, uuid, raqam) va "new/edit" — bitta formaning yaratish va tahrir sahifasi bitta xotira. */
function isIdSegment(s: string): boolean {
  return /^\d+$/.test(s) || /^c[a-z0-9]{20,}$/.test(s) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s) || ["new", "edit", "yangi", "tahrir"].includes(s);
}

export function memoryKey(pathname: string, field: string): string {
  const scope = pathname.split("/").filter((s) => s && !isIdSegment(s)).join("/") || "root";
  return `${scope}:${field}`.slice(0, MEMORY_KEY_MAX);
}

export function memoryFieldAllowed(name: string): boolean {
  return !!name && !SKIP_NAME.test(name);
}

/** Saqlashga yaroqli qiymat (bo'shliqlari tozalangan) yoki null. */
export function memoryValue(raw: string): string | null {
  const v = raw.replace(/\s+/g, " ").trim();
  if (v.length < 2 || v.length > MEMORY_VALUE_MAX || NUMERIC.test(v)) return null;
  return v;
}
