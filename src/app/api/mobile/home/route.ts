import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileHome } from "@/lib/mobile/home";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/home — rolga mos ko'rsatkichlar va ro'yxatlar. */
export async function GET(req: Request) {
  return handle(async () => mobileHome(await requireMobileUser(req)));
}

export const OPTIONS = preflight;
