import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { ListError } from "@/lib/mobile/list";

/**
 * Mobil yuz skaneri (ECO: "Keldim/Ketdim" va rahbarning `att.face`) — qayta yuborishga (replay) qarshi ikki qatlam:
 *
 *   1. Bir martalik challenge: ilova kadr olishdan oldin `GET /api/mobile/attendance/challenge` dan `nonce` oladi va
 *      so'rov bilan yuboradi. Nonce login egasiga bog'langan, `NONCE_TTL_MS` (2 daqiqa) yashaydi, bir marta ishlatiladi.
 *      Nonce yuborilsa — har doim tekshiriladi; yuborilmasa — `MOBILE_FACE_NONCE_REQUIRED=true` bo'lgandagina rad
 *      (sukut false: challenge'ni bilmaydigan eski ilova versiyalari ishlashda davom etsin).
 *   2. Kadr xeshi (sha256): yuz tekshiruviga yetib kelgan har bir kadrning xeshi saqlanadi; aynan o'sha kadr qayta
 *      kelsa (tutib olingan so'rov, avvalgi kadr) — har doim rad. Kamera har safar yangi kadr oladi, shuning uchun
 *      halol foydalanuvchiga ta'sir qilmaydi.
 */

export const NONCE_TTL_MS = 2 * 60_000;

export const nonceRequired = () => (process.env.MOBILE_FACE_NONCE_REQUIRED ?? "false").trim().toLowerCase() === "true";

/** Yangi challenge. Eskirgan nonce'lar (1 kundan eski) shu yerda tozalanadi — jadval o'smaydi. */
export async function issueFaceNonce(userId: string) {
  if (!hit(`face-nonce:${userId}`, 30, 60_000)) throw new ListError("RATE_LIMITED", "Juda ko'p urinish. Bir daqiqadan keyin qayta urinib ko'ring", 429);
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await db.faceNonce.create({ data: { nonce, userId, expiresAt } });
  // Arzon tozalash (har chaqiruvda emas)
  if (Math.random() < 0.05) await db.faceNonce.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } }).catch(() => undefined);
  return { nonce, expiresAt: expiresAt.toISOString(), ttlSec: NONCE_TTL_MS / 1000 };
}

export type NonceCheck = { ok: true } | { ok: false; code: "NONCE_REQUIRED" | "NONCE_INVALID"; error: string };

/**
 * So'rovdagi nonce'ni tekshiradi va "ishlatildi" qiladi (atomar: bir nonce bilan ikki parallel so'rovdan faqat bittasi o'tadi).
 * `raw` — so'rovdagi qiymat (bo'lmasligi mumkin).
 */
export async function consumeFaceNonce(userId: string, raw: unknown): Promise<NonceCheck> {
  if (raw === undefined || raw === null || raw === "") {
    return nonceRequired() ? { ok: false, code: "NONCE_REQUIRED", error: "Ilovani yangilang — yuz skaneri yangi xavfsizlik tekshiruvini talab qiladi" } : { ok: true };
  }
  if (typeof raw !== "string" || raw.length > 100) return { ok: false, code: "NONCE_INVALID", error: "Tekshiruv kodi noto'g'ri — qayta skaner qiling" };
  const r = await db.faceNonce.updateMany({ where: { nonce: raw, userId, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (r.count !== 1) return { ok: false, code: "NONCE_INVALID", error: "Tekshiruv kodi eskirgan yoki ishlatilgan — qayta skaner qiling" };
  return { ok: true };
}

/** Nonce tekshiruvi; o'tmasa — mobil API xatosi (400). */
export async function requireFaceNonce(userId: string, raw: unknown) {
  const n = await consumeFaceNonce(userId, raw);
  if (!n.ok) throw new ListError(n.code, n.error, 400);
}

export const photoHash = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/**
 * Kadr xeshini "band" qiladi. Aynan shu kadr avval yuborilgan bo'lsa — false (rad etish kerak).
 * Unikal kalit bilan — ikki parallel so'rovda ham faqat bittasi o'tadi.
 */
export async function claimPhotoHash(buf: Buffer, employeeId: string, userId: string): Promise<boolean> {
  // ON CONFLICT DO NOTHING — yozilmagan bo'lsa (0) xesh avval bor edi
  const r = await db.facePhotoHash.createMany({ data: [{ hash: photoHash(buf), employeeId, userId }], skipDuplicates: true });
  return r.count === 1;
}
