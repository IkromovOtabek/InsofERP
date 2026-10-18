import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./secret";

/**
 * Zayavka hujjatidagi QR — ommaviy `/z/<№>?k=<kalit>` sahifasi (login yo'q).
 *
 * Raqam ketma-ket (Z-2026-00165), shuning uchun havolada kalit bor: u bazada saqlanmaydi, raqamdan
 * HMAC bilan hisoblanadi (imzo kaliti — `AUTH_SECRET`, maqsad prefiksi bilan ajratilgan). Kalit mos
 * kelmasa sahifa 404 beradi — boshqa raqamni terib, begona zayavkani ko'rib bo'lmaydi.
 * Diqqat: `AUTH_SECRET` almashtirilsa, oldin chop etilgan QR'lar ham ochilmay qoladi.
 */
export function orderQrKey(orderNo: string): string {
  return createHmac("sha256", authSecret()).update(`order-qr:${orderNo}`).digest("base64url").slice(0, 22);
}

export function orderQrValid(orderNo: string, k: string | undefined | null): boolean {
  if (!k) return false;
  const a = Buffer.from(orderQrKey(orderNo));
  const b = Buffer.from(k);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const orderPublicPath = (orderNo: string, lang?: string) =>
  `/z/${encodeURIComponent(orderNo)}?k=${orderQrKey(orderNo)}${lang === "ru" ? "&lang=ru" : ""}`;
