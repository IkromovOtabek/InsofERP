import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileStaffDay } from "@/lib/mobile/staff-attendance";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/attendance/day?date=YYYY-MM-DD — barcha xodimlar davomati bir kunda (keldi/ketdi/soat/kechikish). */
export async function GET(req: Request) {
  return handle(async () => mobileStaffDay(await requireMobileUser(req), new URL(req.url).searchParams.get("date")));
}

export const OPTIONS = preflight;
