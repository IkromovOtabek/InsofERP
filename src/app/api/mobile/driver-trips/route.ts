import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileDriverTrips } from "@/lib/mobile/staff-attendance";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/driver-trips?month=YYYY-MM — haydovchilar jadvali (reyslar, hajm, km, ish kunlari);
 * `&id=<employeeId|me>` — bitta haydovchining kunlari. Haydovchi faqat o'zinikini (`id=me`) oladi.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return handle(async () => mobileDriverTrips(await requireMobileUser(req), q.get("id"), q.get("month")));
}

export const OPTIONS = preflight;
