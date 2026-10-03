import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileFleet } from "@/lib/mobile/fleet";
import { liveTrucks } from "@/lib/mobile/home";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/fleet — faol reyslar xaritasi (direktor, logistika, mexanik); ilova 10–15 s da so'raydi. */
export async function GET(req: Request) {
  return handle(async () => mobileFleet(await requireMobileUser(req), liveTrucks));
}

export const OPTIONS = preflight;
