import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./secret";

/**
 * Chop etilgan hujjatdagi QR havolasining kaliti (`?k=`): bazada saqlanmaydi, hujjat raqamidan HMAC bilan
 * hisoblanadi (imzo kaliti — `AUTH_SECRET`, `purpose` — hujjat turi, turlar bir-birining kalitini ocholmaydi).
 * Kalit mos kelmasa ommaviy sahifa 404 beradi — ketma-ket raqamni terib begona hujjatni ko'rib bo'lmaydi.
 * Diqqat: `AUTH_SECRET` almashtirilsa, oldin chop etilgan QR'lar ochilmay qoladi.
 */
export function qrKey(purpose: string, value: string): string {
  return createHmac("sha256", authSecret()).update(`${purpose}:${value}`).digest("base64url").slice(0, 22);
}

export function qrKeyValid(purpose: string, value: string, k: string | undefined | null): boolean {
  if (!k) return false;
  const a = Buffer.from(qrKey(purpose, value));
  const b = Buffer.from(k);
  return a.length === b.length && timingSafeEqual(a, b);
}
