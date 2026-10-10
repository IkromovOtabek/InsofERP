import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { faceKioskEnroll } from "@/lib/mobile/face-kiosk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/mobile/face/enroll — `{ employeeId, consent: true, nonce, frames }`: xodim yuzini ro'yxatga olish. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handle(async () => faceKioskEnroll(await requireMobileUser(req), body));
}

export const OPTIONS = preflight;
