import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { issueFaceNonce } from "@/lib/face-replay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/attendance/challenge — yuz skaneri uchun bir martalik challenge: `{ nonce, expiresAt, ttlSec }`.
 * Ilova kadr olishdan oldin oladi va "Keldim/Ketdim" (`/attendance/self`) yoki rahbarning `att.face` so'roviga
 * `nonce` qilib qo'shadi. Login egasiga bog'langan, 2 daqiqa yashaydi, bir marta ishlatiladi (`lib/face-replay.ts`).
 */
export async function GET(req: Request) {
  return handle(async () => issueFaceNonce((await requireMobileUser(req)).id));
}

export const OPTIONS = preflight;
