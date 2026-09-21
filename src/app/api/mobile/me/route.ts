import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/me — token egasi kim (ilova ochilganda tekshiradi). */
export async function GET(req: Request) {
  return handle(() => requireMobileUser(req));
}

export const OPTIONS = preflight;
