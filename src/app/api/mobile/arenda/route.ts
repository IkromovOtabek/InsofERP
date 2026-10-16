import { requireMobileUser } from "@/lib/mobile/auth";
import { arendaScreen } from "@/lib/mobile/arenda";
import { listAllowed } from "@/lib/mobile/list";
import { ListError } from "@/lib/mobile/list";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/arenda?oy=YYYY-MM — arenda oy varag'i (sekretar «Arenda» tabi): kassa, oylik jadval, ruxsatlar. */
export async function GET(req: Request) {
  const oy = new URL(req.url).searchParams.get("oy");
  return handle(async () => {
    const user = await requireMobileUser(req);
    if (!listAllowed(user, "arenda-jurnal")) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
    return arendaScreen(user, oy);
  });
}

export const OPTIONS = preflight;
