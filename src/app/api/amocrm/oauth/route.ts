import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { authSecret } from "@/lib/secret";
import { redirectUrl } from "@/lib/redirect-url";
import { db } from "@/lib/db";
import { finishOAuth } from "@/lib/amocrm/connect";
import { AMO_ID, oauthHost } from "@/lib/amocrm/store";

/**
 * «amoCRM orqali ruxsat berish»: GET (kodsiz) — amoCRM ruxsat oynasiga; amoCRM shu manzilga `code`, `referer`, `state` bilan qaytaradi.
 * `state` — imzolangan (foydalanuvchi + muddat) va brauzer cookie'sidagi tasodifiy qiymatga bog'langan (CSRF).
 * amoCRM integratsiyasidagi «Redirect URI»: <APP_URL>/api/amocrm/oauth
 */
export const runtime = "nodejs";

const COOKIE = "amo_oauth";
const TTL_SEC = 15 * 60;
const sign = (v: string) => createHmac("sha256", authSecret()).update(`amo-oauth:${v}`).digest("base64url");

export async function GET(req: Request) {
  const back = (q: string) => Response.redirect(redirectUrl(req, `/amocrm?tab=sozlamalar&${q}`), 303);
  const s = await getSession();
  if (!s) return Response.redirect(redirectUrl(req, "/login"), 303);
  if (!canDo(s, "sales", "amocrm_settings")) return back("xato=ruxsat");

  const q = new URL(req.url).searchParams;
  const jar = await cookies();
  const code = q.get("code");

  if (!code) {
    if (q.get("error")) return back("xato=bekor");
    const c = await db.amoConnection.findUnique({ where: { id: AMO_ID }, select: { clientId: true, domain: true } });
    if (!c?.clientId) return back("xato=kalit");
    const nonce = randomBytes(16).toString("base64url");
    const payload = `${s.userId}.${Math.floor(Date.now() / 1000) + TTL_SEC}.${nonce}`;
    jar.set(COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/amocrm/oauth", maxAge: TTL_SEC });
    const url = new URL("/oauth", oauthHost(c.domain));
    url.searchParams.set("client_id", c.clientId);
    url.searchParams.set("state", `${payload}.${sign(payload)}`);
    return Response.redirect(url, 303);
  }

  const parts = (q.get("state") ?? "").split(".");
  const [uid, exp, nonce, sig] = parts;
  const payload = `${uid}.${exp}.${nonce}`;
  const good = parts.length === 4 && sig && Buffer.byteLength(sig) === Buffer.byteLength(sign(payload)) && timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload)));
  const cookieNonce = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: "/api/amocrm/oauth" });
  if (!good || uid !== s.userId || Number(exp) < Date.now() / 1000 || !cookieNonce || cookieNonce !== nonce) return back("xato=state");

  try {
    await finishOAuth(code, q.get("referer"), { userId: s.userId, name: s.fullName });
    return back("ulandi=1");
  } catch (e) {
    console.error("[amocrm] oauth", e instanceof Error ? e.message : e);
    return back("xato=amo");
  }
}
