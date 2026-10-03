import { z } from "zod";
import { mobileLoginWithCode, MobileAuthError } from "@/lib/mobile/auth";
import { handle, jsonErr, preflight } from "@/lib/mobile/http";
import { checkLogin, failDelay, ipFromHeaders, lockedMessage, recordFailure, recordSuccess } from "@/lib/login-guard";
import { normalizePhone } from "@/lib/sms/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  phone: z.string().min(1, "Telefon raqamini kiriting"),
  code: z.string().min(1, "Kodni kiriting"),
});

/**
 * POST /api/mobile/auth/code-login — {phone, code} → {accessToken, refreshToken, user}.
 * Token FAQAT kod to'g'ri bo'lgach beriladi. Kodni qo'pol kuch bilan topishdan himoya:
 * raqam bo'yicha urinish hisoblanadi (login-guard) va javob kechiktiriladi.
 */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return jsonErr("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot to'liq emas", 400);
  const ip = ipFromHeaders(req.headers);
  // Qulf kaliti normallashgan raqam: "+998 90…", "90…", "998…" — hammasi bitta hisobga tushadi,
  // aks holda yozilishini o'zgartirib qulfni aylanib o'tish mumkin edi.
  const key = normalizePhone(p.data.phone) ?? p.data.phone.trim();
  const guard = checkLogin(key, ip);
  if (!guard.ok) return jsonErr("LOCKED", lockedMessage(guard.retryAfterSec), 429);
  return handle(async () => {
    try {
      const r = await mobileLoginWithCode(p.data.phone, p.data.code);
      recordSuccess(key);
      return r;
    } catch (e) {
      if (e instanceof MobileAuthError) { recordFailure(key, ip); await failDelay(); }
      throw e;
    }
  });
}

export const OPTIONS = preflight;
