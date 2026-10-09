import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileTripTrackSummary } from "@/lib/mobile/trip-track";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/trip-track/summary?ids=a,b,c — bir nechta reys yakuni (km, vaqt, tezlik), chiziqsiz; ko'pi 100 ta. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return handle(async () => mobileTripTrackSummary(await requireMobileUser(req), q.get("ids") ?? ""));
}

/** POST /api/mobile/trip-track/summary — {ids: [...]} (uzun ro'yxat URL'ga sig'masa). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  return handle(async () => mobileTripTrackSummary(await requireMobileUser(req), Array.isArray(body?.ids) ? body.ids : null));
}

export const OPTIONS = preflight;
