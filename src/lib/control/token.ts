import { SignJWT, jwtVerify } from "jose";

/**
 * Markaziy panel ↔ korxona jarayoni orasidagi qisqa muddatli imzo (SSO kirish).
 * Kalit — CONTROL_SECRET: panelda va har korxona .env ida bir xil, kamida 32 belgi.
 * `aud` — korxona slug'i: bitta korxona uchun berilgan token boshqasida ishlamaydi.
 */
const ISS = "insof-control";

function secret(): Uint8Array {
  const raw = (process.env.CONTROL_SECRET ?? "").trim();
  if (raw.length < 32) throw new Error("CONTROL_SECRET sozlanmagan yoki juda qisqa (kamida 32 belgi): openssl rand -base64 48");
  return new TextEncoder().encode(raw);
}

export const controlSecretSet = () => (process.env.CONTROL_SECRET ?? "").trim().length >= 32;

export type SsoClaims = { adminId: string; adminLogin: string; adminName: string; jti: string };

export async function signSso(tenantSlug: string, c: Omit<SsoClaims, "jti">): Promise<string> {
  return new SignJWT({ ...c, typ: "sso" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(tenantSlug)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(secret());
}

export async function verifySso(token: string, tenantSlug: string): Promise<SsoClaims> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], issuer: ISS, audience: tenantSlug });
  if (payload.typ !== "sso" || typeof payload.adminId !== "string" || typeof payload.jti !== "string") throw new Error("Token turi noto'g'ri");
  return { adminId: payload.adminId, adminLogin: String(payload.adminLogin ?? ""), adminName: String(payload.adminName ?? ""), jti: payload.jti };
}
