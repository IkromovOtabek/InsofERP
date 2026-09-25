/**
 * JWT imzo kaliti — veb cookie, mobil Bearer va middleware bitta kalitdan foydalanadi.
 *
 * Production'da `AUTH_SECRET` bo'lmasa yoki namunaviy qiymat bo'lsa ilova ishga tushmaydi:
 * aks holda hamma biladigan "dev-secret" bilan istalgan kishi o'ziga DIRECTOR tokeni yasab olardi.
 * Dev'da zaxira qiymat qoladi, lekin konsolga bir marta ogohlantirish chiqadi.
 *
 * Edge runtime (middleware) da ham ishlaydi: faqat process.env va TextEncoder.
 */

const PLACEHOLDERS = new Set(["", "dev-secret", "change-me-to-a-long-random-string", "secret", "changeme"]);
const MIN_LEN = 32;

let warned = false;

export function authSecret(): Uint8Array {
  const raw = (process.env.AUTH_SECRET ?? "").trim();
  const weak = PLACEHOLDERS.has(raw) || raw.length < MIN_LEN;
  if (weak) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`AUTH_SECRET sozlanmagan yoki juda qisqa (kamida ${MIN_LEN} belgi). Yarating: openssl rand -base64 48`);
    }
    if (!warned) {
      warned = true;
      console.warn(`[auth] AUTH_SECRET yo'q yoki zaif — dev zaxira kaliti ishlatilmoqda. Production'da bu xato beradi.`);
    }
    return new TextEncoder().encode(raw || "dev-secret");
  }
  return new TextEncoder().encode(raw);
}

/** jwtVerify faqat shu algoritmni qabul qiladi — algoritm almashtirish hujumi yopiq. */
export const JWT_ALGS = ["HS256"];
