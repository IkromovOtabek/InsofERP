import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { faceKioskDelete } from "@/lib/mobile/face-kiosk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/mobile/face/delete — `{ employeeId }`: xodimning yuz ma'lumotini o'chirish (otdel kadr darajasi). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handle(async () => faceKioskDelete(await requireMobileUser(req), body));
}

export const OPTIONS = preflight;
