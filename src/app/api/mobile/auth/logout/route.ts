import { bearerToken, mobileLogout } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mobile/auth/logout — `Authorization: Bearer <access>`, body `{refreshToken?, deviceId?}`.
 * Shu qurilmaning access va refresh tokenlari server tomonda bekor qilinadi (o'g'irlangan nusxa ham
 * ishlamaydi); `deviceId` berilsa — bu telefonga push ham yuborilmaydi. Boshqa qurilmalar chiqarilmaydi.
 * Har doim `{ok:true}` — token yaroqsiz/eskirgan bo'lsa ham (ilova baribir lokal tokenni o'chiradi).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { refreshToken?: unknown; deviceId?: unknown } | null;
  const refresh = typeof body?.refreshToken === "string" ? body.refreshToken.trim() : "";
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim().slice(0, 200) : "";
  return handle(async () => {
    const { userId } = await mobileLogout(bearerToken(req), refresh);
    if (userId && deviceId) await db.mobileDevice.deleteMany({ where: { userId, deviceId } });
    return { ok: true };
  });
}

export const OPTIONS = preflight;
