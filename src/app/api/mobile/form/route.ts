import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileForm } from "@/lib/mobile/create";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/form?key=orders — yangi hujjat formasi (maydonlar va dolzarb tanlov ro'yxatlari). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  return handle(async () => mobileForm(await requireMobileUser(req), url.searchParams.get("key") ?? ""));
}

export const OPTIONS = preflight;
