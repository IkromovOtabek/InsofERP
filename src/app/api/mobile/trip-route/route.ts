import { requireMobileUser } from "@/lib/mobile/auth";
import { tripRoute } from "@/lib/mobile/route";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/trip-route?id=...&lat=&lng=&line=skip — haydovchi marshrut ekrani uchun.
 * `lat`/`lng` — mashinaning hozirgi joyi: yo'l shu yerdan quriladi.
 * `line=skip` — ilovada yo'l allaqachon bor, faqat ko'rsatkichlar kerak.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return handle(async () => tripRoute(await requireMobileUser(req), q.get("id") ?? "", { lat: q.get("lat"), lng: q.get("lng"), line: q.get("line") }));
}

export const OPTIONS = preflight;
