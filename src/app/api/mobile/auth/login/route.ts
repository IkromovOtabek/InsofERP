import { z } from "zod";
import { mobileLogin, MobileAuthError } from "@/lib/mobile/auth";
import { handle, jsonErr, preflight } from "@/lib/mobile/http";
import { checkLogin, failDelay, ipFromHeaders, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ login: z.string().min(1, "Login kiriting"), password: z.string().min(1, "Parol kiriting") });

/** POST /api/mobile/auth/login — {login, password} → {accessToken, refreshToken, user}. */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const p = Body.safeParse(raw);
  if (!p.success) return jsonErr("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot to'liq emas", 400);
  const ip = ipFromHeaders(req.headers);
  const guard = checkLogin(p.data.login, ip);
  if (!guard.ok) return jsonErr("LOCKED", lockedMessage(guard.retryAfterSec), 429);
  return handle(async () => {
    try {
      const r = await mobileLogin(p.data.login, p.data.password);
      recordSuccess(p.data.login);
      return r;
    } catch (e) {
      // Qo'pol kuch himoyasi: urinish hisoblanadi (5 tadan keyin qulf) va javob kechiktiriladi
      if (e instanceof MobileAuthError) { recordFailure(p.data.login, ip); await failDelay(); }
      throw e;
    }
  });
}

export const OPTIONS = preflight;
