import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { makeVault } from "@/lib/smm/vault";
import { control } from "./db";

/**
 * Ikki bosqichli kirish (TOTP, RFC 6238): Google Authenticator, Microsoft Authenticator, 1Password va h.k.
 * 30 soniyalik qadam, 6 raqam, HMAC-SHA1 (ilovalar standarti). Soat farqi uchun ±1 qadam qabul qilinadi.
 *
 * Xavfsizlik:
 *  · sir bazada AES-256-GCM bilan shifrlangan (AUTH_SECRET dan alohida kalit) — baza nusxasi tushsa ham kod yasab bo'lmaydi;
 *  · bitta kod ikki marta o'tmaydi: `totpLastStep` shartli `updateMany` bilan oshiriladi (ikki parallel so'rov poygasi yo'q);
 *  · zaxira kodlar (10 ta, bir martalik) faqat sha256 xeshi bilan saqlanadi, ishlatilgani `array_remove` bilan atomar o'chadi.
 * AUTH_SECRET almashtirilsa sirlar o'qilmaydi — adminlar 2FA ni `npm run control:admin -- <login> --reset-2fa` bilan qayta yoqadi.
 */
const vault = makeVault("insof-control-totp", "admin-totp-secret-v1");
const STEP_SEC = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_ISSUER = "Insof IT panel";

function b32encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function b32decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("base32 noto'g'ri");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SEC);

/** Kod qaysi qadamga mos (±1) — topilmasa null. Taqqoslash doimiy vaqtda. */
export function matchStep(secretB32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = b32decode(secretB32);
  const step = currentStep(now);
  let hit: number | null = null;
  for (const s of [step - 1, step, step + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(code)) && hit === null) hit = s;
  }
  return hit;
}

/** Yangi sir: 20 bayt (160 bit), base32. */
export const newTotpSecret = () => b32encode(randomBytes(20));
export const sealSecret = (b32: string) => vault.seal(b32);
export const unsealSecret = (sealed: string | null | undefined) => vault.unseal(sealed);

/** Ilova QR kodi uchun manzil (otpauth://totp/...). */
export function otpauthUrl(secretB32: string, login: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${login}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}

/** Ko'rsatish uchun: "ABCD EFGH IJKL ..." */
export const groupSecret = (b32: string) => b32.replace(/(.{4})/g, "$1 ").trim();

/* ───────── Zaxira kodlar ───────── */

const RC_ALPHA = "abcdefghjkmnpqrstuvwxyz23456789"; // o'xshash belgilarsiz (0/o, 1/l/i)
export const RECOVERY_COUNT = 10;

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => RC_ALPHA[x % RC_ALPHA.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

const normRecovery = (code: string) => code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashRecovery = (code: string) => createHash("sha256").update(`insof-rc:${normRecovery(code)}`).digest("hex");

/* ───────── Tekshiruv (bazaga yozadi) ───────── */

type TotpRow = { id: string; totpSecret: string | null; totpEnabledAt: Date | null; totpLastStep: number | null };

/**
 * Ikkinchi omil: 6 raqamli kod yoki zaxira kod. To'g'ri bo'lsa ishlatilgani qayd etiladi (takror o'tmaydi).
 * Qaytaradi: "totp" | "recovery" | null (noto'g'ri, takroriy yoki 2FA yoqilmagan).
 */
export async function consumeSecondFactor(row: TotpRow, codeRaw: unknown): Promise<"totp" | "recovery" | null> {
  if (!row.totpEnabledAt || typeof codeRaw !== "string") return null;
  const code = codeRaw.replace(/\s/g, "");
  if (!code || code.length > 40) return null;
  if (/^\d{6}$/.test(code)) {
    const secret = unsealSecret(row.totpSecret);
    if (!secret) return null;
    const step = matchStep(secret, code);
    if (step === null) return null;
    const r = await control.superAdmin.updateMany({
      where: { id: row.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return r.count === 1 ? "totp" : null;
  }
  const h = hashRecovery(code);
  const n = await control.$executeRaw`
    UPDATE "SuperAdmin" SET "recoveryCodes" = array_remove("recoveryCodes", ${h})
    WHERE "id" = ${row.id} AND ${h} = ANY("recoveryCodes")`;
  return n === 1 ? "recovery" : null;
}
