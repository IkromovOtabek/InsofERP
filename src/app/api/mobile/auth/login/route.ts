import { z } from "zod";
import { mobileLogin, MobileAuthError } from "@/lib/mobile/auth";
import { handle, jsonErr, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ login: z.string().min(1, "Login kiriting"), password: z.string().min(1, "Parol kiriting") });

/** POST /api/mobile/auth/login — {login, password} → {accessToken, refreshToken, user}. */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const p = Body.safeParse(raw);
  if (!p.success) return jsonErr("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot to'liq emas", 400);
  return handle(async () => {
    try {
      return await mobileLogin(p.data.login, p.data.password);
    } catch (e) {
      // Parolni taxmin qilishni sekinlashtirish (oddiy, lekin bepul himoya)
      if (e instanceof MobileAuthError) await new Promise((r) => setTimeout(r, 400));
      throw e;
    }
  });
}

export const OPTIONS = preflight;
