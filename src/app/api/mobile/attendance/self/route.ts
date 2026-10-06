import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { markSelfAttendance, myAttendanceMonth } from "@/lib/self-attendance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/attendance/self?month=YYYY-MM — xodimning o'z davomati: bugungi holat va oy ("Mening davomatim").
 * Faqat login egasiniki — boshqa xodim id'si qabul qilinmaydi.
 */
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month");
  return handle(async () => myAttendanceMonth(await requireMobileUser(req), month));
}

/**
 * POST /api/mobile/attendance/self — "Keldim" / "Ketdim" (ilova ichidagi yuz skaneridan keyin).
 * Body: { kind: "in"|"out", lat, lng, accuracy, photo: "data:image/jpeg;base64,...", deviceId, at, mocked? }.
 * Geofence, takror, soat va yuz (profil surati bilan) tekshiruvi serverda — `lib/self-attendance.ts`.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handle(async () => markSelfAttendance(await requireMobileUser(req), body));
}

export const OPTIONS = preflight;
