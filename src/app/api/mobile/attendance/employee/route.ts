import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileEmployeeMonth } from "@/lib/mobile/staff-attendance";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/attendance/employee?id=&month=YYYY-MM — xodimning oylik davomati (ish haqi asosi). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return handle(async () => mobileEmployeeMonth(await requireMobileUser(req), q.get("id"), q.get("month")));
}

export const OPTIONS = preflight;
