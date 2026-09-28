import { handle, preflight } from "@/lib/mobile/http";
import { shopCatalog } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/public/shop — do'kon vitrinasi. Login talab qilmaydi: ilova ochilishi bilan shu yuklanadi. */
export async function GET() {
  return handle(shopCatalog);
}

export const OPTIONS = preflight;
