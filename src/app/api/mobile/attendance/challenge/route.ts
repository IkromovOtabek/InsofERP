import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { issueFaceNonce } from "@/lib/face-replay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/attendance/challenge — yuz skaneri uchun bir martalik challenge:
 *   `{ nonce, expiresAt, ttlSec, task: { code, text, hint, icon, steps, frames }, livenessRequired }`.
 * Ilova kadr olishdan oldin oladi va "Keldim/Ketdim" (`/attendance/self`) yoki rahbarning `att.face` so'roviga
 * `nonce` qilib qo'shadi. Login egasiga bog'langan, 2 daqiqa yashaydi, bir marta ishlatiladi (`lib/face-replay.ts`).
 * `task` — jonlilik topshirig'i (BLINK / TURN_LEFT / TURN_RIGHT, nonce bilan saqlanadi): yangi ilova uni ko'rsatib
 * 3 kadr oladi va `frames` qilib yuboradi (`lib/face-liveness.ts`); eski ilova e'tiborsiz qoldiradi.
 */
export async function GET(req: Request) {
  return handle(async () => issueFaceNonce((await requireMobileUser(req)).id));
}

export const OPTIONS = preflight;
