import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileScanReceipt } from "@/lib/mobile/scan";
import { handle, jsonErr, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Model hujjatni 20–40 soniya o'qiydi
export const maxDuration = 90;

/** POST /api/mobile/scan/receipt — {images: dataUrl[]} → «Yangi kirim» formasi uchun to'ldirilgan qiymatlar. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonErr("BAD_REQUEST", "So'rov o'qilmadi", 400);
  return handle(async () => mobileScanReceipt(await requireMobileUser(req), body));
}

export const OPTIONS = preflight;
