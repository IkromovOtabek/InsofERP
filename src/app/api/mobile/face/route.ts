import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { faceKioskData } from "@/lib/mobile/face-kiosk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/face — «Davomat» ekrani: ruxsat, bugungi skaner jurnali, yuzlar ro'yxati (`lib/mobile/face-kiosk.ts`). */
export async function GET(req: Request) {
  return handle(async () => faceKioskData(await requireMobileUser(req)));
}

export const OPTIONS = preflight;
