import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileDetail } from "@/lib/mobile/detail";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/detail?key=orders&id=... — hujjat kartochkasi va mavjud amallar. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  return handle(async () => mobileDetail(await requireMobileUser(req), url.searchParams.get("key") ?? "", url.searchParams.get("id") ?? ""));
}

export const OPTIONS = preflight;
