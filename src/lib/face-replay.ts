import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { ListError } from "@/lib/mobile/list";
import { type LivenessTask, isTask, livenessRequired, pickTask, taskPayload } from "@/lib/face-liveness";

/**
 * Mobil yuz skaneri (ECO: "Keldim/Ketdim" va rahbarning `att.face`) — qayta yuborishga (replay) qarshi ikki qatlam:
 *
 *   1. Bir martalik challenge: ilova kadr olishdan oldin `GET /api/mobile/attendance/challenge` dan `nonce` oladi va
 *      so'rov bilan yuboradi. Nonce login egasiga bog'langan, `NONCE_TTL_MS` (2 daqiqa) yashaydi, bir marta ishlatiladi.
 *      Nonce yuborilsa — har doim tekshiriladi; yuborilmasa — `MOBILE_FACE_NONCE_REQUIRED=true` bo'lgandagina rad
 *      (sukut false: challenge'ni bilmaydigan eski ilova versiyalari ishlashda davom etsin).
 *      Challenge jonlilik topshirig'ini ham beradi (`lib/face-liveness.ts`, nonce bilan bog'lanib saqlanadi);
 *      `MOBILE_FACE_LIVENESS_REQUIRED=true` bo'lsa nonce ham majburiy.
 *   2. Kadr xeshi (sha256): yuz tekshiruviga yetib kelgan har bir kadrning xeshi saqlanadi; aynan o'sha kadr qayta
 *      kelsa (tutib olingan so'rov, avvalgi kadr) — har doim rad. Kamera har safar yangi kadr oladi, shuning uchun
 *      halol foydalanuvchiga ta'sir qilmaydi.
 */

export const NONCE_TTL_MS = 2 * 60_000;

export const nonceRequired = () => (process.env.MOBILE_FACE_NONCE_REQUIRED ?? "false").trim().toLowerCase() === "true";

/**
 * Yangi challenge: nonce + jonlilik topshirig'i (`lib/face-liveness.ts`, nonce bilan birga saqlanadi — so'rovda ilova
 * boshqa topshiriqni "tanlay" olmaydi). Eski ilova `task` ni e'tiborsiz qoldiradi va bitta kadr yuboradi (bayroq
 * o'chiq bo'lsa qabul qilinadi). Eskirgan nonce'lar (1 kundan eski) shu yerda tozalanadi — jadval o'smaydi.
 */
export async function issueFaceNonce(userId: string) {
  if (!hit(`face-nonce:${userId}`, 30, 60_000)) throw new ListError("RATE_LIMITED", "Juda ko'p urinish. Bir daqiqadan keyin qayta urinib ko'ring", 429);
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  const task = pickTask();
  await db.faceNonce.create({ data: { nonce, userId, expiresAt, task } });
  // Arzon tozalash (har chaqiruvda emas)
  if (Math.random() < 0.05) await db.faceNonce.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } }).catch(() => undefined);
  return { nonce, expiresAt: expiresAt.toISOString(), ttlSec: NONCE_TTL_MS / 1000, task: taskPayload(task), livenessRequired: livenessRequired() };
}

/** `task` — nonce'ga bog'langan topshiriq (nonce yuborilmagan yoki eski nonce bo'lsa null). */
export type NonceCheck = { ok: true; task: LivenessTask | null } | { ok: false; code: "NONCE_REQUIRED" | "NONCE_INVALID"; error: string };

/**
 * So'rovdagi nonce'ni tekshiradi va "ishlatildi" qiladi (atomar: bir nonce bilan ikki parallel so'rovdan faqat bittasi o'tadi).
 * `raw` — so'rovdagi qiymat (bo'lmasligi mumkin). Jonlilik majburiy bo'lsa nonce ham majburiy (topshiriq undan olinadi).
 */
export async function consumeFaceNonce(userId: string, raw: unknown): Promise<NonceCheck> {
  if (raw === undefined || raw === null || raw === "") {
    return nonceRequired() || livenessRequired() ? { ok: false, code: "NONCE_REQUIRED", error: "Ilovani yangilang — yuz skaneri yangi xavfsizlik tekshiruvini talab qiladi" } : { ok: true, task: null };
  }
  if (typeof raw !== "string" || raw.length > 100) return { ok: false, code: "NONCE_INVALID", error: "Tekshiruv kodi noto'g'ri — qayta skaner qiling" };
  const used = await db.faceNonce.updateManyAndReturn({
    where: { nonce: raw, userId, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() }, select: { task: true },
  });
  if (used.length !== 1) return { ok: false, code: "NONCE_INVALID", error: "Tekshiruv kodi eskirgan yoki ishlatilgan — qayta skaner qiling" };
  const task = used[0]!.task;
  return { ok: true, task: isTask(task) ? task : null };
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
