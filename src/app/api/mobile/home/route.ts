import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileHome } from "@/lib/mobile/home";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/home — rolga mos ko'rsatkichlar va ro'yxatlar. */
export async function GET(req: Request) {
  // Karta filtrlari (masalan `?revenue=week`) — ilova karta ostidagi tugma bosilganda yuboradi
  const sp = new URL(req.url).searchParams;
  const opt = (k: string) => sp.get(k) ?? undefined;
  return handle(async () => mobileHome(await requireMobileUser(req), { revenue: opt("revenue"), from: opt("from"), to: opt("to") }));
}

export const OPTIONS = preflight;
