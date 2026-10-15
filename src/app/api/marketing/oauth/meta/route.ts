import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { authSecret } from "@/lib/secret";
import { SITE_URL } from "@/lib/site";
import { redirectUrl } from "@/lib/redirect-url";
import { metaAppReady } from "@/lib/smm/config";
import { exchangeCode, oauthUrl } from "@/lib/smm/meta";
import { connectMeta } from "@/lib/smm/accounts";

/**
 * «Meta bilan ulash»: GET (kodsiz) — Meta ruxsat oynasiga yo'naltiradi; Meta shu manzilga `code` bilan qaytaradi.
 * `state` — imzolangan (foydalanuvchi + muddat) va brauzer cookie'sidagi tasodifiy qiymatga bog'langan (CSRF).
 * Qaytish manzili Meta ilovasida «Valid OAuth Redirect URIs» ro'yxatida bo'lishi shart: <APP_URL>/api/marketing/oauth/meta
 */
export const runtime = "nodejs";

const COOKIE = "smm_oauth";
const TTL_SEC = 15 * 60;
const callbackUri = () => `${SITE_URL.replace(/\/$/, "")}/api/marketing/oauth/meta`;
const sign = (v: string) => createHmac("sha256", authSecret()).update(`smm-oauth:${v}`).digest("base64url");

export async function GET(req: Request) {
  const back = (q: string) => Response.redirect(redirectUrl(req, `/marketing/sozlamalar?${q}`), 303);
  const s = await getSession();
  if (!s) return Response.redirect(redirectUrl(req, "/login"), 303);
  if (!canDo(s, "marketing", "settings")) return back("xato=ruxsat");
  if (!metaAppReady()) return back("xato=ilova");

  const q = new URL(req.url).searchParams;
  const jar = await cookies();
  const code = q.get("code");

  if (!code) {
    if (q.get("error")) return back("xato=bekor");
    const nonce = randomBytes(16).toString("base64url");
    const payload = `${s.userId}.${Math.floor(Date.now() / 1000) + TTL_SEC}.${nonce}`;
    jar.set(COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/marketing/oauth", maxAge: TTL_SEC });
    return Response.redirect(oauthUrl(callbackUri(), `${payload}.${sign(payload)}`), 303);
  }

  // Qaytish: state imzosi, muddati, foydalanuvchi va cookie mosligi
  const parts = (q.get("state") ?? "").split(".");
  const [uid, exp, nonce, sig] = parts;
  const payload = `${uid}.${exp}.${nonce}`;
  const good = parts.length === 4 && sig && Buffer.byteLength(sig) === Buffer.byteLength(sign(payload)) && timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload)));
  const cookieNonce = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: "/api/marketing/oauth" });
  if (!good || uid !== s.userId || Number(exp) < Date.now() / 1000 || !cookieNonce || cookieNonce !== nonce) return back("xato=state");

  try {
    const t = await exchangeCode(code, callbackUri());
    const r = await connectMeta(t.token, "OAUTH", { userId: s.userId, name: s.fullName }, t.expiresAt);
    return back(`ulandi=${r.instagram}-${r.facebook}`);
  } catch (e) {
    console.error("[smm] oauth", e instanceof Error ? e.message : e);
    return back("xato=meta");
  }
}
