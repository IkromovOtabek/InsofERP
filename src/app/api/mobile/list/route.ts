import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileList } from "@/lib/mobile/list";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/list?key=orders&q=matn&filter=soon — rolning ishchi ro'yxati. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  return handle(async () => mobileList(await requireMobileUser(req), url.searchParams.get("key") ?? "", url.searchParams.get("q") ?? undefined, url.searchParams.get("filter") ?? undefined));
}

export const OPTIONS = preflight;
