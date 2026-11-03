import { z } from "zod";
import { mobileSetTempPassword } from "@/lib/mobile/auth";
import { handle, jsonErr, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  changeToken: z.string().min(1, "Qayta kiring"),
  password: z.string().min(1, "Yangi parolni kiriting"),
});

/**
 * POST /api/mobile/auth/temp-password — {changeToken, password} → {accessToken, refreshToken, user}.
 * `changeToken` login javobidan (`PASSWORD_CHANGE_REQUIRED`, vaqtinchalik parol): imzolangan, qisqa muddatli
 * va bir martalik (`lib/temp-password.ts`) — qo'pol kuch uchun qulf kerak emas.
 */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return jsonErr("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot to'liq emas", 400);
  return handle(() => mobileSetTempPassword(p.data.changeToken, p.data.password));
}

export const OPTIONS = preflight;
