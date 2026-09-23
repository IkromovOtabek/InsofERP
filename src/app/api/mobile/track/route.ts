import { requireMobileUser } from "@/lib/mobile/auth";
import { recordTrack } from "@/lib/mobile/track";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/mobile/track — {tripId, points[]} → reys izini saqlaydi (haydovchi ilovasi). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handle(async () => recordTrack(await requireMobileUser(req), body));
}

export const OPTIONS = preflight;
