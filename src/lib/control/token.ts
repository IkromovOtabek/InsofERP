import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * Markaziy panel ↔ korxona jarayoni orasidagi qisqa muddatli imzo (SSO kirish).
 *
 * Kalitlar:
 *  - Panelda (control.env) — `CONTROL_SECRET` (kamida 32 belgi). U HECH QACHON korxona .env iga yozilmaydi.
 *  - Har korxonaning o'z kaliti — `CONTROL_SSO_KEY = HMAC-SHA256(CONTROL_SECRET, slug)` (hex).
 *    Panel slug X uchun tokenni shu hosila kalit bilan imzolaydi; korxona faqat o'z .env idagi kalit bilan tekshiradi.
 *    Bitta korxona .env i sizib chiqsa ham boshqa korxonaga (yoki panelga) SSO token yasab bo'lmaydi.
 *  - `aud` — korxona slug'i (qo'shimcha himoya).
 *
 * Orqaga moslik: eski korxona .env ida `CONTROL_SSO_KEY` yo'q, lekin global `CONTROL_SECRET` bor bo'lsa,
 * korxona hosila kalitni o'zi hisoblaydi (TENANT_SLUG bilan) — SSO ishlashda davom etadi.
 * Tavsiya: `npm run tenant -- sso-key <slug>` chiqargan qiymatni CONTROL_SSO_KEY ga yozib, CONTROL_SECRET ni o'chirish.
 */
const ISS = "insof-control";
const MIN_LEN = 32;

/** Korxona uchun hosila SSO kaliti (hex, 64 belgi). Faqat panel tomonda (CONTROL_SECRET bor joyda) chaqiriladi. */
export function deriveTenantSsoKey(controlSecret: string, slug: string): string {
  return createHmac("sha256", controlSecret.trim()).update(`insof-sso:${slug}`).digest("hex");
}

function controlSecret(): string {
  const raw = (process.env.CONTROL_SECRET ?? "").trim();
  if (raw.length < MIN_LEN) throw new Error("CONTROL_SECRET sozlanmagan yoki juda qisqa (kamida 32 belgi): openssl rand -base64 48");
  return raw;
}

/** Korxona jarayonining tekshiruv kaliti — faqat o'z .env idan. */
function tenantVerifyKey(tenantSlug: string): string | null {
  const own = (process.env.CONTROL_SSO_KEY ?? "").trim();
  if (own.length >= MIN_LEN) return own;
  // Eski o'rnatish: global CONTROL_SECRET korxona .env ida qolgan — hosila kalitni shu yerda hisoblaymiz
  const legacy = (process.env.CONTROL_SECRET ?? "").trim();
  if (legacy.length >= MIN_LEN) return deriveTenantSsoKey(legacy, tenantSlug);
  return null;
}

/** Panel tomonda: imzolash uchun CONTROL_SECRET bormi. */
export const controlSecretSet = () => (process.env.CONTROL_SECRET ?? "").trim().length >= MIN_LEN;

/** Korxona tomonda: SSO qabul qilish uchun kalit bormi (CONTROL_SSO_KEY yoki eski CONTROL_SECRET). */
export const tenantSsoKeySet = (tenantSlug: string) => tenantVerifyKey(tenantSlug) !== null;

const enc = (s: string) => new TextEncoder().encode(s);

export type SsoClaims = { adminId: string; adminLogin: string; adminName: string; jti: string };

/** Panel: slug korxonasi uchun token — shu korxonaning hosila kaliti bilan. */
export async function signSso(tenantSlug: string, c: Omit<SsoClaims, "jti">): Promise<string> {
  return new SignJWT({ ...c, typ: "sso" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(tenantSlug)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(enc(deriveTenantSsoKey(controlSecret(), tenantSlug)));
}

/** Korxona: tokenni o'z kaliti bilan tekshiradi. */
export async function verifySso(token: string, tenantSlug: string): Promise<SsoClaims> {
  const key = tenantVerifyKey(tenantSlug);
  if (!key) throw new Error("SSO kaliti sozlanmagan (CONTROL_SSO_KEY)");
  const { payload } = await jwtVerify(token, enc(key), { algorithms: ["HS256"], issuer: ISS, audience: tenantSlug });
  if (payload.typ !== "sso" || typeof payload.adminId !== "string" || typeof payload.jti !== "string") throw new Error("Token turi noto'g'ri");
  return { adminId: payload.adminId, adminLogin: String(payload.adminLogin ?? ""), adminName: String(payload.adminName ?? ""), jti: payload.jti };
}
