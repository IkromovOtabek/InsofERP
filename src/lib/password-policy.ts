/**
 * Parol qoidasi — hamma joyda bitta: Sozlamalar (direktor), Otdel kadr, SMS orqali tiklash, seed.
 *  · kamida 8 belgi;
 *  · harf ham, raqam ham bo'lsin;
 *  · keng tarqalgan/standart parollar rad etiladi (seed'dagi admin123, parol123 shular jumlasidan).
 */
export const MIN_PASSWORD = 8;

const BANNED = new Set([
  "admin123", "parol123", "password", "password1", "12345678", "123456789", "1234567890",
  "qwerty123", "insof123", "insof2024", "insof2025", "insof2026", "11111111", "00000000",
]);

export const PASSWORD_HINT = `Kamida ${MIN_PASSWORD} belgi, harf va raqam aralash`;

/** Xato bo'lsa o'zbekcha sabab, yaxshi bo'lsa null. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Parol kamida ${MIN_PASSWORD} belgi bo'lsin`;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Parolda harf ham, raqam ham bo'lsin";
  if (BANNED.has(pw.toLowerCase())) return "Bu parol juda oddiy — boshqasini tanlang";
  return null;
}

/** Seed'dagi standart parollar — `npm run security:check` shularni qidiradi. */
export const DEFAULT_PASSWORDS = ["admin123", "parol123"];
