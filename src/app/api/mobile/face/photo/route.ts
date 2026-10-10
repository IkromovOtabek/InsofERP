import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { faceKioskPhoto } from "@/lib/mobile/face-kiosk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/face/photo?a=<attendanceId>&k=in|out yoki ?t=<faceTemplateId> — kadr, `{ data }` (data-URL). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return handle(async () => faceKioskPhoto(await requireMobileUser(req), q));
}

export const OPTIONS = preflight;
