import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileShipment, mobileShipmentAction, mobileShipments } from "@/lib/mobile/shipments";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/shipments[?id=] — kutayotgan jo'natmalar (banner) yoki bitta jo'natma qatorlari. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  return handle(async () => {
    const u = await requireMobileUser(req);
    return id ? mobileShipment(u, id) : mobileShipments(u);
  });
}

/** POST /api/mobile/shipments — qabul qilish ({action:"accept", lines}) yoki rad etish ({action:"reject", itemIds, reason}). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handle(async () => mobileShipmentAction(await requireMobileUser(req), body));
}

export const OPTIONS = preflight;
