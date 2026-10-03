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
  // Qulf kaliti mobileLogin qidiradigan login bilan bir xil (trim) — " ali" va "ali" alohida
  // hisob bo'lib, qulfni bo'shliq qo'shib aylanib o'tish mumkin bo'lmasin (katta-kichik harf guard'da).
  const login = p.data.login.trim();
  if (!login) return jsonErr("BAD_REQUEST", "Login kiriting", 400);
  const guard = checkLogin(login, ip);
  if (!guard.ok) return jsonErr("LOCKED", lockedMessage(guard.retryAfterSec), 429);
  return handle(async () => {
    try {
      const r = await mobileLogin(login, p.data.password);
      recordSuccess(login);
      return r;
    } catch (e) {
      // Qo'pol kuch himoyasi: urinish hisoblanadi (5 tadan keyin qulf) va javob kechiktiriladi
      if (e instanceof MobileAuthError) { recordFailure(login, ip); await failDelay(); }
      throw e;
    }
  });
}

export const OPTIONS = preflight;
