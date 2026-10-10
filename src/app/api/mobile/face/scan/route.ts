import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { faceKioskScan } from "@/lib/mobile/face-kiosk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mobile/face/scan — kiosk: `{ mode: "auto"|"in"|"out", nonce, frames: [3 ta data-URL] }`.
 * Javob — `FaceScanResult` (tanilmasa ham 200, `ok: false` va o'zbekcha matn bilan — skaner o'zida ko'rsatadi).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handle(async () => faceKioskScan(await requireMobileUser(req), body));
}

export const OPTIONS = preflight;
