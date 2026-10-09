import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileTripTrack } from "@/lib/mobile/trip-track";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/trip-track?id=... — reys izi (soddalashtirilgan), km, vaqt, tezlik, oxirgi nuqta, rejadagi yo'l. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return handle(async () => mobileTripTrack(await requireMobileUser(req), q.get("id") ?? ""));
}

export const OPTIONS = preflight;
