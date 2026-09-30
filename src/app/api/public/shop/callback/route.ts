import { jsonErr, jsonOk, preflight } from "@/lib/mobile/http";
import { ipFromHeaders } from "@/lib/login-guard";
import { publicLeadAllowed, RATE_LIMITED } from "@/lib/rate-limit";
import { createShopCallback } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/public/shop/callback — ilovadan "menga qo'ng'iroq qiling" so'rovi (mehmon ham).
 * Mahsulot tanlanmaydi; ariza `Lead` (eco-shop) bo'lib sotuv bo'limiga tushadi.
 * Spamdan himoya `lib/leads.ts` da: bitta raqamdan 2 daqiqada bitta ariza.
 */
export async function POST(req: Request) {
  if (!publicLeadAllowed(ipFromHeaders(req.headers))) return jsonErr("RATE_LIMITED", RATE_LIMITED, 429);
  let body: unknown;
  try { body = await req.json(); } catch { return jsonErr("BAD_REQUEST", "JSON kutilgan edi", 400); }
  try {
    const r = await createShopCallback(body);
    if (!r.ok) return jsonErr("VALIDATION", r.error, 400);
    return jsonOk(r);
  } catch (e) {
    console.error("[shop-callback]", e);
    return jsonErr("INTERNAL", "Server xatosi", 500);
  }
}

export const OPTIONS = preflight;
