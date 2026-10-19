import { qrKey, qrKeyValid } from "./qr-key";

/**
 * Zayavka hujjatidagi QR — ommaviy `/z/<№>?k=<kalit>` sahifasi (login yo'q). Kalit — `lib/qr-key.ts`
 * (maqsad «order-qr»): chop etilgan QR'lar shu kalit bilan ochiladi, maqsad nomini o'zgartirmang.
 */
export const orderQrKey = (orderNo: string) => qrKey("order-qr", orderNo);
export const orderQrValid = (orderNo: string, k: string | undefined | null) => qrKeyValid("order-qr", orderNo, k);

export const orderPublicPath = (orderNo: string, lang?: string) =>
  `/z/${encodeURIComponent(orderNo)}?k=${orderQrKey(orderNo)}${lang === "ru" ? "&lang=ru" : ""}`;
