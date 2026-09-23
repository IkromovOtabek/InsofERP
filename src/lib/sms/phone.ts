/**
 * O'zbekiston telefon raqamlarini bitta ko'rinishga keltirish: `+998901234567`.
 *
 * Bazada raqamlar qo'lda kiritilgan — "90 123 45 67", "+998 (90) 123-45-67",
 * "998901234567" hammasi uchraydi. Eskiz esa faqat `998XXXXXXXXX` qabul qiladi,
 * shuning uchun yuborishdan oldin har doim shu yerdan o'tkaziladi.
 */

/** Raqamlardan boshqa hamma narsa olib tashlanadi. */
const digits = (v: string) => v.replace(/\D+/g, "");

/**
 * `null` — raqam yaroqsiz (bo'sh, qisqa yoki O'zbekiston raqami emas).
 * Chaqiruvchi shuni tekshirib, SMS yuborishdan voz kechadi.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = digits(raw);

  // Davlat kodini UZUNLIK bo'yicha ajratamiz, prefiks bo'yicha emas.
  // "998296002" — bu 998 + 296002 EMAS, balki 99 operator kodli 9 xonali raqam
  // (99 829 60 02). Faqat prefiksga qarab kessak, bunday raqamlar yo'qoladi.
  let local: string | null = null;
  if (d.length === 9) local = d;
  else if (d.length === 12 && d.startsWith("998")) local = d.slice(3);
  else if (d.length === 13 && d.startsWith("8998")) local = d.slice(4); // "8 998 ..." — eski odat
  if (!local) return null;

  // Operator kodi 2 raqam: 20, 33, 50, 55, 77, 88, 90, 91, 93, 94, 95, 97, 98, 99…
  if (!/^[1-9]\d{8}$/.test(local)) return null;
  return `+998${local}`;
}

/** Eskiz uchun: `998901234567` (plyussiz). */
export const toEskiz = (phone: string) => phone.replace(/\D+/g, "");

/** Ekranda/jurnalda ko'rsatish uchun: `+998 90 123 45 67`. */
export function formatPhone(phone: string): string {
  const d = digits(phone);
  if (d.length !== 12) return phone;
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
}

/** Jurnalga yozish uchun qisman yashirilgan raqam: `+99890***4567`. */
export const maskPhone = (phone: string) => (phone.length > 8 ? `${phone.slice(0, 8)}***${phone.slice(-4)}` : phone);
